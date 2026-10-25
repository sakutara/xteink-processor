// Đọc PDF có lớp văn bản bằng pdf.js: dựng dòng -> đoạn -> heading, bỏ header/footer lặp, mục lục lấy từ outline.
// PDF quét (không có văn bản) thì báo lỗi, không OCR.
import { UserError, baseName, cleanText, looksLikeChapterTitle, tick } from '../util.js';

const PDFJS_URL = new URL('../../vendor/pdf.min.js', import.meta.url).href;
const WORKER_URL = new URL('../../vendor/pdf.worker.min.js', import.meta.url).href;

let loading = null;
function loadPdfJs() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_URL;
    s.onload = () => {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      resolve(globalThis.pdfjsLib);
    };
    s.onerror = () => { loading = null; reject(new UserError('Không tải được thư viện đọc PDF.')); };
    document.head.append(s);
  });
  return loading;
}

const MIN_CHARS_PER_PAGE = 30;
const BULLET = /^[•◦▪▫‣●○■□∙·\-–—*]\s+/;
const SENTENCE_END = /[.!?…:;"'”’)\]]$/;
const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
};
const mode = (a, step) => {
  const m = new Map();
  for (const v of a) { const k = Math.round(v / step) * step; m.set(k, (m.get(k) || 0) + 1); }
  let best = 0, bc = -1;
  for (const [k, c] of m) if (c > bc) { best = k; bc = c; }
  return best;
};

/** Gom các mục chữ của một trang thành dòng {text, x0, x1, y, size}. */
function buildLines(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue;
    const t = it.transform;
    const size = Math.abs(it.height) || Math.hypot(t[2], t[3]) || 1;
    const x = t[4], y = t[5], w = it.width || 0;
    if (it.str && !it.str.trim() && !cur) continue;
    if (cur && Math.abs(y - cur.y) <= 0.5 * Math.max(size, cur.size) && x >= cur.x1 - cur.size * 2) {
      if (it.str) {
        const gap = x - cur.x1;
        const glued = /\s$/.test(cur.text) || /^\s/.test(it.str);
        if (!glued && gap > 0.12 * Math.min(size, cur.size)) cur.text += ' ';
        cur.text += it.str;
        cur.x1 = Math.max(cur.x1, x + w);
        if (size > cur.size) cur.size = size;
      }
    } else {
      cur = it.str.trim() ? { text: it.str, x0: x, x1: x + w, y, size } : null;
      if (cur) lines.push(cur);
    }
    if (it.hasEOL) cur = null;
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim();
  return lines.filter(l => l.text);
}

const PAGE_NUM = /^(?:page\s+)?(?:\d{1,5}|[ivxlcdm]{1,7})(?:\s*(?:of|\/)\s*\d{1,5})?$|^[-–—]\s*\d{1,5}\s*[-–—]$/i;

export async function readPdf(file, report = () => {}) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new UserError('PDF này được bảo vệ bằng mật khẩu nên không thể chuyển đổi.');
    throw new UserError('Tệp PDF bị hỏng hoặc không đọc được.');
  }
  const n = pdf.numPages;

  // --- 1. Dòng của từng trang
  const pages = [];
  let chars = 0;
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const lines = buildLines(tc.items);
    for (const l of lines) chars += l.text.length;
    pages.push({ lines, height: vp.height, width: vp.width });
    page.cleanup();
    if (p % 5 === 0 || p === n) { report(`Đang đọc trang PDF (${p}/${n})…`, p / n); await tick(); }
  }
  if (chars < Math.max(100, MIN_CHARS_PER_PAGE * n)) {
    await pdf.destroy();
    throw new UserError('PDF này không chứa văn bản (có thể là bản quét ảnh) nên không thể chuyển đổi.');
  }

  // --- 2. Bỏ header/footer lặp và số trang
  const margin = (pg, l) => l.y > pg.height * 0.9 || l.y < pg.height * 0.1;
  const keyCount = new Map();
  for (const pg of pages) {
    const seen = new Set();
    for (const l of pg.lines) if (margin(pg, l)) seen.add(l.text.replace(/\d+/g, '#'));
    for (const k of seen) keyCount.set(k, (keyCount.get(k) || 0) + 1);
  }
  const repeat = Math.max(3, Math.ceil(n * 0.25));
  for (const pg of pages) {
    pg.lines = pg.lines.filter(l => !(margin(pg, l) &&
      (PAGE_NUM.test(l.text) || keyCount.get(l.text.replace(/\d+/g, '#')) >= repeat)));
  }

  // --- 3. Cỡ chữ thân bài và cấp heading
  const sizeChars = new Map();
  for (const pg of pages) for (const l of pg.lines) {
    const k = Math.round(l.size * 2) / 2;
    sizeChars.set(k, (sizeChars.get(k) || 0) + l.text.length);
  }
  let body = 0, best = -1;
  for (const [k, c] of sizeChars) if (c > best) { body = k; best = c; }
  const headSizes = [...sizeChars.keys()].filter(k => k >= body * 1.15).sort((a, b) => b - a).slice(0, 3);
  const levelOf = (l) => {
    const k = Math.round(l.size * 2) / 2;
    const i = headSizes.indexOf(k);
    return i >= 0 ? i + 1 : 0;
  };

  // --- 4. Đoạn
  /** @type {{kind:'p'|'h'|'li', level?:number, text:string, page:number, x0:number, lastX1:number, right:number}[]} */
  const blocks = [];
  for (let pi = 0; pi < n; pi++) {
    const pg = pages[pi];
    const L = pg.lines;
    if (!L.length) continue;
    const left = mode(L.map(l => l.x0), 2);
    const right = L.map(l => l.x1).sort((a, b) => a - b)[Math.floor(L.length * 0.9)] ?? pg.width;
    const pitch = median(L.slice(1).map((l, i) => L[i].y - l.y).filter(d => d > 0 && d < 3 * body)) || body * 1.2;
    let prev = null; // dòng trước
    L.forEach((l, i) => {
      const lvl = levelOf(l) || (l.text.length <= 80 && l.size > body * 1.05 && looksLikeChapterTitle(l.text) ? headSizes.length + 1 : 0);
      const isHead = lvl > 0 && l.text.length <= 140;
      const bullet = !isHead && BULLET.test(l.text);
      const last = blocks[blocks.length - 1];
      let cont = false;
      if (last && !isHead && !bullet && last.kind === 'p') {
        if (prev) {
          const dy = prev.y - l.y;
          const indented = l.x0 > left + body * 0.9;
          const shortEnd = prev.x1 < right - body * 4 && SENTENCE_END.test(prev.text);
          cont = dy <= pitch * 1.6 && !indented && !shortEnd && Math.abs(prev.size - l.size) < body * 0.15 && !prev.head;
        } else {
          // đầu trang: nối tiếp đoạn dở của trang trước
          const indented = l.x0 > left + body * 0.9;
          cont = !indented && !SENTENCE_END.test(last.text) || /[-‐]$/.test(last.text);
        }
      } else if (last && isHead && last.kind === 'h' && last.level === lvl && prev && prev.y - l.y <= pitch * 1.6 && last.page === pi) {
        cont = true; // heading nhiều dòng
      }
      if (cont) {
        if (/[A-Za-zÀ-ỹ]-$/.test(last.text) && /^[a-zà-ỹ]/.test(l.text)) last.text = last.text.slice(0, -1) + l.text;
        else last.text += ' ' + l.text;
      } else if (isHead) {
        blocks.push({ kind: 'h', level: lvl, text: l.text, page: pi });
      } else if (bullet) {
        blocks.push({ kind: 'li', text: l.text.replace(BULLET, ''), page: pi });
      } else {
        blocks.push({ kind: 'p', text: l.text, page: pi });
      }
      prev = isHead ? { ...l, head: true } : l;
    });
  }

  // --- 5. Outline -> TOC
  const outline = [];
  try {
    const walkOutline = async (items, level) => {
      for (const it of items || []) {
        let idx = -1;
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await pdf.getDestination(dest);
          if (Array.isArray(dest)) idx = typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : dest[0];
        } catch { /* mục trỏ hỏng */ }
        const title = cleanText(it.title || '');
        if (title && idx >= 0 && idx < n) outline.push({ title, page: idx, level });
        await walkOutline(it.items, level + 1);
      }
    };
    await walkOutline(await pdf.getOutline(), 0);
  } catch { /* không có outline */ }

  // --- 6. Dựng DOM
  const doc = document.implementation.createHTMLDocument('');
  const toc = [];
  const outlineByPage = new Map();
  for (const o of outline) {
    if (!outlineByPage.has(o.page)) outlineByPage.set(o.page, []);
    outlineByPage.get(o.page).push(o);
  }
  const pendingPages = [...outlineByPage.keys()].sort((a, b) => a - b);
  let ul = null, id = 0;
  for (const b of blocks) {
    while (pendingPages.length && pendingPages[0] <= b.page) {
      const pg = pendingPages.shift();
      for (const o of outlineByPage.get(pg)) {
        const a = doc.createElement('span');
        a.id = `pdf-${++id}`;
        doc.body.append(a);
        toc.push({ title: o.title, href: `pdf.html#${a.id}`, level: o.level });
      }
    }
    if (b.kind === 'li') {
      if (!ul) { ul = doc.createElement('ul'); doc.body.append(ul); }
      const li = doc.createElement('li');
      li.textContent = b.text;
      ul.append(li);
      continue;
    }
    ul = null;
    const el = doc.createElement(b.kind === 'h' ? `h${b.level}` : 'p');
    el.textContent = b.text;
    doc.body.append(el);
  }
  for (const pg of pendingPages) {
    for (const o of outlineByPage.get(pg)) {
      const a = doc.createElement('span');
      a.id = `pdf-${++id}`;
      doc.body.append(a);
      toc.push({ title: o.title, href: `pdf.html#${a.id}`, level: o.level });
    }
  }

  // --- 7. Metadata
  const meta = { title: '', author: [], language: '' };
  try {
    const m = await pdf.getMetadata();
    meta.title = cleanText(m.info?.Title || '');
    const au = cleanText(m.info?.Author || '');
    if (au) meta.author = au.split(/\s*[;&]\s*|\s+and\s+/i).filter(Boolean);
    meta.language = cleanText(m.metadata?.get('dc:language') || m.info?.Language || '');
  } catch { /* bỏ qua */ }
  await pdf.destroy();

  const title = meta.title || baseName(file.name);
  return { meta, cover: null, docs: [{ href: 'pdf.html', doc }], toc, tocDocHrefs: new Set(), fallbackTitle: title };
}
