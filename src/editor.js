// Trình chỉnh sửa hình trước khi xử lý: xoay, lật, cắt (kéo khung), chỉnh sáng/tương phản.
import { X3_WIDTH, X3_HEIGHT, transformImage, composeGray, encodeOutputs } from './image.js';

const $ = id => document.getElementById(id);
const HANDLE = matchMedia('(pointer: coarse)').matches ? 28 : 16;   // bán kính vùng bắt góc (px màn hình)
const SNAP_PX = 8;    // ngưỡng hít (px màn hình)
const MIN_PX = 24;   // cạnh nhỏ nhất của khung cắt (px màn hình)
const ASPECTS = { free: null, x3: X3_WIDTH / X3_HEIGHT };

export function createEditor({ onApply, onCancel }) {
  const stage = $('edcanvas'), ctx = stage.getContext('2d');
  const result = $('edresult'), rctx = result.getContext('2d');
  result.width = X3_WIDTH; result.height = X3_HEIGHT;

  let bmp = null, name = 'image';
  let base = null;                    // ảnh đã xoay/lật
  let rotation = 0, flip = false;
  let crop = null;                    // {x,y,w,h} theo pixel của `base`
  let scale = 1;                      // pixel màn hình / pixel base
  let drag = null, raf = 0;

  const aspect = () => ASPECTS[$('edaspect').value];
  const adjust = () => ({ brightness: +$('edbright').value, contrast: +$('edcontrast').value });

  function fullCrop() { return { x: 0, y: 0, w: base.width, h: base.height }; }

  // Khung lớn nhất có tỉ lệ r, căn giữa, nằm trọn trong ảnh.
  function fitCrop(r) {
    if (!r) return fullCrop();
    let w = base.width, h = w / r;
    if (h > base.height) { h = base.height; w = h * r; }
    return { x: (base.width - w) / 2, y: (base.height - h) / 2, w, h };
  }

  function layout() {
    const maxW = Math.max(120, (stage.parentElement.clientWidth || 480) - 16);
    const maxH = Math.max(240, Math.min(window.innerHeight * 0.7, 900));
    scale = Math.min(maxW / base.width, maxH / base.height);
    const w = Math.max(1, Math.round(base.width * scale)), h = Math.max(1, Math.round(base.height * scale));
    scale = w / base.width;
    stage.width = w; stage.height = h;
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); renderResult(); }); }

  function draw() {
    if (!base) return;
    const W = stage.width, H = stage.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0, W, H);
    const x = crop.x * scale, y = crop.y * scale, w = crop.w * scale, h = crop.h * scale;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, W, y);
    ctx.fillRect(0, y + h, W, H - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, W - x - w, h);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + w * i / 3, y); ctx.lineTo(x + w * i / 3, y + h);
      ctx.moveTo(x, y + h * i / 3); ctx.lineTo(x + w, y + h * i / 3);
    }
    ctx.stroke();
    if (drag && snapOn()) {
      const g = guides();
      ctx.strokeStyle = '#ff2d95'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (const gx of g.v) { ctx.moveTo(gx * scale, 0); ctx.lineTo(gx * scale, H); }
      for (const gy of g.h) { ctx.moveTo(0, gy * scale); ctx.lineTo(W, gy * scale); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      ctx.beginPath(); ctx.rect(cx - 6, cy - 6, 12, 12); ctx.fill(); ctx.stroke();
    }
  }

  function renderResult() {
    const gray = composeGray(base, crop, adjust());
    const img = rctx.createImageData(X3_WIDTH, X3_HEIGHT);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      img.data[p] = img.data[p + 1] = img.data[p + 2] = gray[i]; img.data[p + 3] = 255;
    }
    rctx.putImageData(img, 0, 0);
  }

  function rebuildBase(resetCrop) {
    base = transformImage(bmp, rotation, flip);
    layout();
    if (resetCrop) crop = fitCrop(aspect());
    schedule();
  }

  // --- hít (snap) vào mép và đường giữa của ảnh
  const snapOn = () => $('edsnap').checked;
  // Trả về giá trị v hoặc điểm gần nhất trong `targets` nếu nằm trong ngưỡng.
  function snapValue(v, targets) {
    const th = SNAP_PX / scale;
    let best = v, bd = th;
    for (const t of targets) { const d = Math.abs(v - t); if (d <= bd) { bd = d; best = t; } }
    return best;
  }
  function snapMove() {
    const W = base.width, H = base.height;
    const pick = (start, size, total) => {
      let best = start, bd = SNAP_PX / scale;
      for (const [off, t] of [[0, 0], [size, total], [size / 2, total / 2]]) {
        const d = Math.abs(start + off - t);
        if (d <= bd) { bd = d; best = t - off; }
      }
      return best;
    };
    crop.x = pick(crop.x, crop.w, W);
    crop.y = pick(crop.y, crop.h, H);
  }
  function guides() {
    const eps = 0.5 / scale, W = base.width, H = base.height;
    const v = [], h = [];
    for (const [val, t] of [[crop.x, 0], [crop.x + crop.w, W], [crop.x + crop.w / 2, W / 2]]) if (Math.abs(val - t) <= eps) v.push(t);
    for (const [val, t] of [[crop.y, 0], [crop.y + crop.h, H], [crop.y + crop.h / 2, H / 2]]) if (Math.abs(val - t) <= eps) h.push(t);
    return { v, h };
  }

  // --- kéo khung
  const pos = e => {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) * stage.width / r.width, y: (e.clientY - r.top) * stage.height / r.height };
  };

  function hit(p) {
    const x = crop.x * scale, y = crop.y * scale, w = crop.w * scale, h = crop.h * scale;
    for (const [cx, cy, ax, ay] of [[x, y, 1, 1], [x + w, y, 0, 1], [x, y + h, 1, 0], [x + w, y + h, 0, 0]]) {
      if (Math.hypot(p.x - cx, p.y - cy) <= HANDLE) {
        // điểm neo là góc đối diện
        return { type: 'resize', ax: (ax ? crop.x + crop.w : crop.x), ay: (ay ? crop.y + crop.h : crop.y) };
      }
    }
    if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) {
      return { type: 'move', dx: p.x / scale - crop.x, dy: p.y / scale - crop.y };
    }
    return null;
  }

  function resizeTo(d, p) {
    let px = Math.max(0, Math.min(base.width, p.x / scale)), py = Math.max(0, Math.min(base.height, p.y / scale));
    if (snapOn()) {
      px = snapValue(px, [0, base.width, base.width / 2]);
      py = snapValue(py, [0, base.height, base.height / 2]);
    }
    const minS = MIN_PX / scale;
    const sx = px >= d.ax ? 1 : -1, sy = py >= d.ay ? 1 : -1;
    let w = Math.abs(px - d.ax), h = Math.abs(py - d.ay);
    const r = aspect();
    if (r) {
      if (w / r > h) h = w / r; else w = h * r;
      const k = Math.min(1, (sx > 0 ? base.width - d.ax : d.ax) / w, (sy > 0 ? base.height - d.ay : d.ay) / h);
      w *= k; h *= k;
      if (w < minS) { w = minS; h = minS / r; }
    } else {
      w = Math.max(w, minS); h = Math.max(h, minS);
      w = Math.min(w, sx > 0 ? base.width - d.ax : d.ax);
      h = Math.min(h, sy > 0 ? base.height - d.ay : d.ay);
    }
    crop = { x: sx > 0 ? d.ax : d.ax - w, y: sy > 0 ? d.ay : d.ay - h, w, h };
  }

  stage.addEventListener('pointerdown', e => {
    const p = pos(e), h = hit(p);
    if (!h) return;
    drag = h; stage.setPointerCapture(e.pointerId); e.preventDefault();
  });
  stage.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!drag) {
      const h = hit(p);
      stage.style.cursor = !h ? 'default' : h.type === 'move' ? 'move' : 'nwse-resize';
      return;
    }
    if (drag.type === 'move') {
      crop.x = Math.max(0, Math.min(base.width - crop.w, p.x / scale - drag.dx));
      crop.y = Math.max(0, Math.min(base.height - crop.h, p.y / scale - drag.dy));
      if (snapOn()) snapMove();
    } else {
      resizeTo(drag, p);
    }
    schedule();
  });
  const end = () => { drag = null; schedule(); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // --- nút điều khiển
  $('edrotl').addEventListener('click', () => { rotation = (rotation + 270) % 360; rebuildBase(true); });
  $('edrotr').addEventListener('click', () => { rotation = (rotation + 90) % 360; rebuildBase(true); });
  $('edflip').addEventListener('click', () => { flip = !flip; rebuildBase(true); });
  $('edaspect').addEventListener('change', () => { crop = fitCrop(aspect()); schedule(); });
  for (const id of ['edbright', 'edcontrast']) {
    $(id).addEventListener('input', () => { $(id + 'v').textContent = $(id).value; schedule(); });
  }
  $('edreset').addEventListener('click', () => {
    rotation = 0; flip = false;
    $('edaspect').value = 'free'; $('edbright').value = 0; $('edcontrast').value = 0;
    $('edbrightv').textContent = '0'; $('edcontrastv').textContent = '0';
    rebuildBase(true);
  });
  $('edcancel').addEventListener('click', () => { close(); onCancel(); });
  $('edapply').addEventListener('click', async () => {
    $('edapply').disabled = true;
    try {
      const gray = composeGray(base, crop, adjust());
      const out = await encodeOutputs(gray, name);
      out.srcWidth = Math.round(crop.w); out.srcHeight = Math.round(crop.h);
      close();
      onApply(out);
    } catch (err) {
      console.error(err);
      close();
      onCancel(err);
    } finally {
      $('edapply').disabled = false;
    }
  });
  window.addEventListener('resize', () => { if (base && !$('imged').hidden) { layout(); schedule(); } });

  function close() { $('imged').hidden = true; bmp?.close?.(); bmp = null; base = null; }

  return {
    getCrop: () => ({ ...crop }),   // test hook
    open(bitmap, fileName) {
      bmp = bitmap; name = fileName; rotation = 0; flip = false;
      $('edaspect').value = 'free'; $('edbright').value = 0; $('edcontrast').value = 0;
      $('edbrightv').textContent = '0'; $('edcontrastv').textContent = '0';
      $('imged').hidden = false;
      rebuildBase(true);
    },
  };
}
