// Chuẩn bị hình cho Xteink X3: xám, vừa khung 528x792 (giữ tỉ lệ, phần thừa nền trắng).
// Đầu ra chính là BMP 4-bit với bảng màu 4 mức xám gốc của panel (0/85/170/255), đã dither:
// CrossInk chỉ đọc BMP làm hình chờ và ánh xạ thẳng palette này vào 4 mức xám của màn hình.
// Kèm PNG xám 8-bit (không dither) để xem hoặc dùng làm overlay.
import { UserError } from './util.js';

export const X3_WIDTH = 528;
export const X3_HEIGHT = 792;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// PNG xám thật sự (color type 0, 8-bit, không alpha, không interlace).
async function encodeGrayPng(gray, w, h) {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 0;
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  return new Blob(parts, { type: 'image/png' });
}

const LEVELS = [0, 85, 170, 255];

// Floyd–Steinberg (quét ziczac) xuống 4 mức xám; trả về chỉ số 0..3 cho mỗi pixel.
function ditherTo4(gray, w, h) {
  const idx = new Uint8Array(w * h);
  let cur = new Float32Array(w + 2), next = new Float32Array(w + 2);
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    next.fill(0);
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const v = Math.min(255, Math.max(0, gray[y * w + x] + cur[x + 1]));
      const q = Math.min(3, Math.max(0, Math.round(v / 85)));
      idx[y * w + x] = q;
      const err = v - LEVELS[q];
      const f = ltr ? 1 : -1;
      cur[x + 1 + f] += err * 7 / 16;
      next[x + 1 - f] += err * 3 / 16;
      next[x + 1] += err * 5 / 16;
      next[x + 1 + f] += err * 1 / 16;
    }
    [cur, next] = [next, cur];
  }
  return idx;
}

// BMP 4-bit có palette, BI_RGB, top-down (chiều cao âm), palette = 4 mức xám gốc.
function encodeBmp4(idx, w, h) {
  const rowBytes = Math.ceil(w * 4 / 32) * 4;
  const offset = 14 + 40 + 16;
  const out = new Uint8Array(offset + rowBytes * h);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4D;
  dv.setUint32(2, out.length, true);
  dv.setUint32(10, offset, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, -h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 4, true);
  dv.setUint32(34, rowBytes * h, true);
  dv.setUint32(38, 2835, true); dv.setUint32(42, 2835, true);
  dv.setUint32(46, 4, true); dv.setUint32(50, 4, true);
  LEVELS.forEach((l, i) => out.set([l, l, l, 0], 54 + i * 4));
  for (let y = 0; y < h; y++) {
    const row = offset + y * rowBytes;
    for (let x = 0; x < w; x++) out[row + (x >> 1)] |= x & 1 ? idx[y * w + x] : idx[y * w + x] << 4;
  }
  return new Blob([out], { type: 'image/bmp' });
}

export async function decodeImage(file) {
  if (file.type && !file.type.startsWith('image/')) throw new UserError('Tệp được chọn không phải hình ảnh.');
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UserError('Không đọc được hình. Hãy chọn tệp JPG, PNG, WebP, GIF hoặc BMP hợp lệ.');
  }
  if (!bmp.width || !bmp.height) throw new UserError('Hình không có kích thước hợp lệ.');
  return bmp;
}

// Xoay (bội của 90°) và lật ngang; trả về canvas mới là ảnh gốc đã biến đổi.
export function transformImage(bmp, rotation = 0, flip = false) {
  const turn = ((rotation % 360) + 360) % 360;
  const swap = turn === 90 || turn === 270;
  const c = document.createElement('canvas');
  c.width = swap ? bmp.height : bmp.width;
  c.height = swap ? bmp.width : bmp.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(turn * Math.PI / 180);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return c;
}

export const DEFAULT_ADJUST = { brightness: 0, contrast: 0 };

// Cắt `crop` (toạ độ pixel của `src`), thu/phóng vừa khung X3 giữ tỉ lệ, nền trắng, chuyển xám,
// rồi chỉnh sáng/tương phản (chỉ trên vùng ảnh, không đụng phần nền trắng bù thêm).
export function composeGray(src, crop, adjust = DEFAULT_ADJUST) {
  const sx = Math.max(0, Math.min(src.width - 1, Math.round(crop.x)));
  const sy = Math.max(0, Math.min(src.height - 1, Math.round(crop.y)));
  const sw = Math.max(1, Math.min(src.width - sx, Math.round(crop.w)));
  const sh = Math.max(1, Math.min(src.height - sy, Math.round(crop.h)));
  const scale = Math.min(X3_WIDTH / sw, X3_HEIGHT / sh);
  const dw = Math.max(1, Math.min(X3_WIDTH, Math.round(sw * scale)));
  const dh = Math.max(1, Math.min(X3_HEIGHT, Math.round(sh * scale)));
  const dx = Math.floor((X3_WIDTH - dw) / 2);
  const dy = Math.floor((X3_HEIGHT - dh) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = X3_WIDTH; canvas.height = X3_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, X3_WIDTH, X3_HEIGHT);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);

  const rgba = ctx.getImageData(0, 0, X3_WIDTH, X3_HEIGHT).data;
  const gray = new Uint8Array(X3_WIDTH * X3_HEIGHT);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }

  const b = adjust.brightness * 2.55, c = adjust.contrast * 2.55;
  if (b || c) {
    const f = (259 * (c + 255)) / (255 * (259 - c));
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, Math.round((v - 128) * f + 128 + b)));
    for (let y = dy; y < dy + dh; y++) {
      for (let x = dx; x < dx + dw; x++) gray[y * X3_WIDTH + x] = lut[gray[y * X3_WIDTH + x]];
    }
  }
  return gray;
}

export async function encodeOutputs(gray, baseName) {
  const base = baseName.replace(/\.[^.]+$/, '') || 'image';
  const bmp = encodeBmp4(ditherTo4(gray, X3_WIDTH, X3_HEIGHT), X3_WIDTH, X3_HEIGHT);
  const png = await encodeGrayPng(gray, X3_WIDTH, X3_HEIGHT);
  return {
    bmp: { blob: bmp, filename: `${base}-x3.bmp` },
    png: { blob: png, filename: `${base}-x3.png` },
    width: X3_WIDTH, height: X3_HEIGHT,
  };
}
