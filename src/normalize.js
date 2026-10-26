// Lõi chuyển đổi: các tài liệu đã parse + TOC gốc -> danh sách chương {title, paras[]}.
import { UserError, cleanText, looksLikeChapterTitle, tick, MK, richPlain, stripPrivate, tidyRich, MK_TAG } from './util.js';

const SKIP = new Set([
  'script', 'style', 'link', 'meta', 'title', 'head', 'noscript', 'template', 'iframe',
  'object', 'embed', 'audio', 'video', 'canvas', 'map', 'rt', 'rp', 'select', 'button',
  'input', 'textarea', 'source', 'track', 'param',
]);
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'blockquote',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th', 'caption', 'thead', 'tbody',
  'tfoot', 'pre', 'figure', 'figcaption', 'address', 'center', 'form', 'fieldset', 'legend',
  'details', 'summary', 'body', 'html', 'hgroup', 'body',
]);
const HEADING = /^h([1-6])$/;
const CLASS_CHAPTER = /(^|[\s_-])(chapter|chap|chapter-?title|chaptertitle|chapter-?heading)([\s_-]|$)/i;
const CLASS_DROPCAP = /dropcap|drop-cap|drop_cap|first-?letter|initial/i;
const TOC_TITLE = /^(mục lục|danh mục|table of contents|contents|toc)$/i;
const MAX_CHARS = 150000; // tách chương quá dài để máy đọc ít RAM không bị nghẽn

const LETTER = /^\p{L}{1,3}$/u;
const FILE_LETTER = /(?:^|[_\-/])(\p{L})\.(?:jpe?g|png|gif|svg|webp)$/iu;
const FILE_DROPCAP = /(?:dropcap|drop-cap|drop_cap|initial|first-?letter)[^\p{L}\p{N}]*(\p{L})(?![\p{L}\p{N}])/iu;

const ITALIC_TAGS = new Set(['i', 'em', 'cite', 'dfn', 'var']);
const BOLD_TAGS = new Set(['b', 'strong']);
const ITALIC_CLS = /(^|[\s_-])(italic|italics|ital|emphasis)([\s_-]|$)/i;
const BOLD_CLS = /(^|[\s_-])(bold|strong)([\s_-]|$)/i;

/** Phần tử có in nghiêng / in đậm không (theo tag, style hoặc class). */
function inlineStyle(el, name) {
  if (name === 'body' || name === 'html') return { i: false, b: false };
  const style = el.getAttribute('style') || '';
  const cls = el.getAttribute('class') || '';
  return {
    i: ITALIC_TAGS.has(name) || /font-style\s*:\s*(italic|oblique)/i.test(style) || ITALIC_CLS.test(cls),
    b: BOLD_TAGS.has(name) || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || BOLD_CLS.test(cls),
  };
}

function hrefOf(el) {
  return el.getAttribute('src') || el.getAttribute('href')
    || el.getAttribute('xlink:href') || el.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href') || '';
}

/** Duyệt một tài liệu, ghi ra luồng item {t:'p'|'h'|'a', ...}. */
function flatten(doc, docHref, targets, out) {
  let buf = [];
  let linkChars = 0, totalChars = 0;
  let inLink = 0, headingDepth = 0, pre = 0;
  let pendingCap = null; // {letter, block, loose}
  let curBlock = null;
  let flagCls = false;
  // Markup nội tuyến (i, b) và danh sách (ul/ol/li, phẳng, không lồng)
  const open = [];      // thứ tự các tag nội tuyến đang mở: 'i' | 'b'
  const depth = { i: 0, b: 0, sup: 0, sub: 0 };
  let pendingLi = null; // MK.UL | MK.OL cho đoạn kế tiếp
  let curLi = null;     // mục li đang mở: {item}
  let bqDepth = 0, centerDepth = 0;
  let listKind = [];    // ngăn xếp ul/ol đang mở

  const bufPlain = () => richPlain(buf.join(''));

  const flush = () => {
    if (headingDepth) return;
    const tail = open.slice().reverse().map(n => MK_TAG[n][1]).join('');
    const rich = tidyRich(cleanText(buf.join('') + tail));
    const plain = cleanText(richPlain(rich));
    if (plain) {
      const link = linkChars > 0 && linkChars >= totalChars * 0.9;
      if (curLi && curLi.item === out[out.length - 1] && !pendingLi) {
        // đoạn thứ hai trở đi trong cùng một li: gộp vào mục đó
        const it = curLi.item;
        it.rich += ' ' + rich; it.text += ' ' + plain;
      } else {
        const item = { t: 'p', text: plain, rich: (pendingLi || (bqDepth ? MK.BQ : centerDepth ? MK.CTR : '')) + rich, link, cls: flagCls };
        if (pendingLi && curLi) curLi.item = item;
        out.push(item);
      }
      pendingLi = null;
    }
    buf = open.map(n => MK_TAG[n][0]);
    linkChars = 0; totalChars = 0;
  };

  const openTag = (n) => {
    if (headingDepth) return;
    if (depth[n]++ === 0) { open.push(n); buf.push(MK_TAG[n][0]); }
  };
  const closeTag = (n) => {
    if (headingDepth) return;
    if (--depth[n] === 0) {
      const k = open.lastIndexOf(n);
      if (k >= 0) open.splice(k, 1);
      buf.push(MK_TAG[n][1]);
    }
  };

  const addText = (s) => {
    s = stripPrivate(s || '');
    if (!s) return;
    if (pendingCap && s.trim()) {
      if (pendingCap.loose || pendingCap.block === curBlock) s = pendingCap.letter + s.replace(/^\s+/, '');
      pendingCap = null;
    }
    buf.push(s);
    const n = s.replace(/\s+/g, '').length;
    totalChars += n;
    if (inLink) linkChars += n;
  };

  const classesAround = (el) => {
    let s = '';
    for (let n = el, i = 0; n && n.getAttribute && i < 3; n = n.parentElement, i++) {
      s += ' ' + (n.getAttribute('class') || '');
    }
    return s;
  };

  const handleImage = (el) => {
    const alt = (el.getAttribute('alt') || el.getAttribute('title') || '').trim();
    const src = hrefOf(el);
    const clsHit = CLASS_DROPCAP.test(classesAround(el)) || CLASS_DROPCAP.test(src);
    const atStart = !cleanText(bufPlain());
    if (!atStart && !clsHit) return;
    let letter = '';
    if (LETTER.test(alt)) letter = alt;
    else {
      const file = decodeURIComponentSafe(src);
      const m = FILE_LETTER.exec(file) || FILE_DROPCAP.exec(file);
      if (m) letter = m[1];
    }
    // Ảnh nằm giữa đoạn chỉ coi là drop cap khi class/tên file nói rõ; ảnh alt 1-3 chữ
    // cũng chỉ được dùng ở đầu khối.
    if (letter && atStart) pendingCap = { letter, block: curBlock, loose: clsHit };
  };

  const walk = (node) => {
    if (node.nodeType === 3) {
      let s = node.nodeValue;
      if (pre && s.includes('\n')) {
        const lines = s.split(/\r?\n/);
        lines.forEach((l, i) => { addText(l); if (i < lines.length - 1) { if (headingDepth) addText(' '); else flush(); } });
      } else addText(s);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    const name = (el.localName || '').toLowerCase();

    const id = el.getAttribute('id') || (name === 'a' ? el.getAttribute('name') : null);
    if (id && targets && targets.has(id)) {
      flush();
      out.push({ t: 'a', doc: docHref, id });
    }

    if (SKIP.has(name)) return;
    if (name === 'img') { handleImage(el); return; }
    if (name === 'svg') {
      const im = Array.from(el.getElementsByTagName('*')).find(e => e.localName === 'image');
      if (im) handleImage(im);
      return;
    }
    if (name === 'br') { if (headingDepth) addText(' '); else flush(); return; }
    if (name === 'hr') { flush(); return; }

    const hm = HEADING.exec(name);
    if (hm && !headingDepth) {
      flush();
      pendingCap = null;
      headingDepth = 1;
      for (const c of el.childNodes) walk(c);
      headingDepth = 0;
      const text = cleanText(bufPlain());
      buf = open.map(n => MK_TAG[n][0]); linkChars = 0; totalChars = 0;
      if (text) out.push({ t: 'h', level: Number(hm[1]), text });
      return;
    }

    const inl = inlineStyle(el, name);
    const isList = name === 'ul' || name === 'ol';
    const isLi = name === 'li' && !headingDepth;
    if (isLi) {
      flush();
      pendingLi = listKind[listKind.length - 1] === 'ol' ? MK.OL : MK.UL;
    }
    if (isList) listKind.push(name);
    if (name === 'blockquote' && !headingDepth) { flush(); bqDepth++; }
    if (name === 'center' && !headingDepth) { flush(); centerDepth++; }
    const sc = name === 'sup' || name === 'sub' ? name : null;
    const savedLi = curLi;
    if (isLi) curLi = { item: null };
    if (inl.i) openTag('i');
    if (inl.b) openTag('b');
    if (sc) openTag(sc);
    try {
      walkElement(el, name, hm);
    } finally {
      if (sc) closeTag(sc);
      if (inl.b) closeTag('b');
      if (inl.i) closeTag('i');
      if (isLi) { flush(); curLi = savedLi; pendingLi = null; }
      if (isList) { listKind.pop(); pendingLi = null; }
      if (name === 'blockquote' && !headingDepth) bqDepth--;
      if (name === 'center' && !headingDepth) centerDepth--;
    }
  };

  const walkElement = (el, name, hm) => {
    const href = el.getAttribute('href') || '';
    const isLink = name === 'a' && (el.hasAttribute('filepos') ||
      (href && (!/^[a-z][a-z0-9+.-]*:/i.test(href) || /^(kindle|filepos):/i.test(href))));
    if (isLink) inLink++;
    if (BLOCK.has(name) || hm) {
      const wasHeading = headingDepth;
      if (wasHeading) addText(' '); else flush();
      let setCls = false;
      if (!wasHeading && CLASS_CHAPTER.test(el.getAttribute('class') || '') &&
          !el.querySelector('p,div,section,li,h1,h2,h3,h4,h5,h6,table,blockquote')) {
        flagCls = true; setCls = true;
      }
      if (name === 'pre') pre++;
      const savedBlock = curBlock;
      curBlock = el;
      for (const c of el.childNodes) walk(c);
      curBlock = savedBlock;
      if (name === 'pre') pre--;
      if (wasHeading) addText(' '); else flush();
      if (setCls) flagCls = false;
    } else {
      for (const c of el.childNodes) walk(c);
    }
    if (isLink) inLink--;
  };

  const body = doc.body || doc.documentElement;
  if (body) walk(body);
  flush();
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const similar = (a, b) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 3 && l.includes(s);
};

function splitHref(h) {
  const i = h.indexOf('#');
  if (i < 0) return [h, ''];
  let f = h.slice(i + 1);
  try { f = decodeURIComponent(f); } catch { /* giữ */ }
  return [h.slice(0, i), f];
}

/**
 * @param {{meta, docs:{href,doc}[], toc:{title,href,level}[], tocDocHrefs:Set<string>, fallbackTitle:string}} book
 */
export async function normalize(book, report) {
  const { docs, toc } = book;
  const tocDocs = book.tocDocHrefs || new Set();

  // Đích của TOC trong từng tài liệu
  const targets = new Map();
  for (const e of toc) {
    const [h, f] = splitHref(e.href);
    if (!f) continue;
    if (!targets.has(h)) targets.set(h, new Set());
    targets.get(h).add(f);
  }

  // --- 1-3. Làm phẳng
  const stream = [];
  let n = 0;
  for (const d of docs) {
    n++;
    if (tocDocs.has(d.href)) continue; // trang mục lục trong nội dung
    const start = stream.length;
    stream.push({ t: 'doc', href: d.href, title: cleanText(d.doc.title || '') });
    flatten(d.doc, d.href, targets.get(d.href), stream);
    d.doc = null; // giải phóng bộ nhớ
    removeInlineToc(stream, start + 1);
    if (n % 5 === 0) { report && report(`Đang xử lý nội dung (${n}/${docs.length})…`, n / docs.length); await tick(); }
  }

  const docIndex = new Map();
  const anchorIndex = new Map();
  stream.forEach((it, i) => {
    if (it.t === 'doc') docIndex.set(it.href, i);
    else if (it.t === 'a') anchorIndex.set(`${it.doc}#${it.id}`, i);
  });

  // --- 4. Ranh giới chương
  let bounds = boundsFromToc(stream, toc, docIndex, anchorIndex);
  let prefaceTitle = null;
  if (bounds) prefaceTitle = bounds.prefaceTitle;
  if (!bounds) bounds = boundsFromHeadings(stream);
  if (!bounds) bounds = boundsFromDocs(stream, book);
  let list = bounds.list;

  // --- 5-6. Cắt thành chương
  const chapters = [];
  const firstPos = list.length ? list[0].pos : stream.length;
  const slice = (from, to, title, dropDupHeading, skip = 0) => {
    const paras = [];
    let first = true;
    for (let i = from; i < to; i++) {
      const it = stream[i];
      if (it.t !== 'p' && it.t !== 'h') continue;
      if (skip > 0) { skip--; first = false; continue; }
      if (first && dropDupHeading && title && (it.t === 'h' || it.cls || looksLikeChapterTitle(it.text)) && similar(title, it.text)) {
        first = false;
        continue;
      }
      first = false;
      paras.push(it.rich || it.text);
    }
    return paras;
  };

  const pre = slice(0, firstPos, null, false);
  if (pre.length) chapters.push({ title: prefaceTitle || 'Mở đầu', paras: pre });
  list.forEach((b, k) => {
    const to = k + 1 < list.length ? list[k + 1].pos : stream.length;
    const paras = slice(b.pos, to, b.title, b.skip == null, b.skip || 0);
    if (paras.length) chapters.push({ title: b.title, paras });
  });

  if (!chapters.length) throw new UserError('Không tìm thấy nội dung văn bản trong tệp này.');

  // Tách chương quá dài
  const final = [];
  for (const ch of chapters) {
    const total = ch.paras.reduce((a, p) => a + p.length, 0);
    if (total <= MAX_CHARS) { final.push(ch); continue; }
    let part = [], size = 0, k = 1;
    for (const p of ch.paras) {
      part.push(p); size += p.length;
      if (size >= MAX_CHARS / 2) {
        final.push({ title: k === 1 ? ch.title : `${ch.title} (${k})`, paras: part });
        part = []; size = 0; k++;
      }
    }
    if (part.length) final.push({ title: k === 1 ? ch.title : `${ch.title} (${k})`, paras: part });
  }
  // Sách bọc gần hết nội dung trong blockquote thì bỏ thụt lề, chỉ giữ ở nơi nó thật sự là trích dẫn
  for (const c of final) {
    let bq = 0, all = 0;
    for (const p of c.paras) { all += p.length; if (p[0] === MK.BQ) bq += p.length; }
    if (bq > all * 0.6) c.paras = c.paras.map(p => (p[0] === MK.BQ ? p.slice(1) : p));
    // Tương tự với <center>: sách canh giữa gần hết thì coi như không canh
    let ctr = 0;
    for (const p of c.paras) if (p[0] === MK.CTR) ctr += p.length;
    if (ctr > all * 0.6) c.paras = c.paras.map(p => (p[0] === MK.CTR ? p.slice(1) : p));
  }
  final.forEach((c, i) => { if (!c.title) c.title = `Phần ${i + 1}`; });
  return final;
}

/** Xoá các cụm đoạn toàn link nội bộ (mục lục nằm trong nội dung). */
function removeInlineToc(stream, from) {
  let i = from;
  const drop = [];
  while (i < stream.length) {
    if (stream[i].t === 'p' && stream[i].link) {
      let j = i, count = 0;
      const members = [];
      while (j < stream.length && (stream[j].t === 'a' || (stream[j].t === 'p' && stream[j].link))) {
        if (stream[j].t === 'p') count++;
        members.push(j);
        j++;
      }
      // tiêu đề "Mục lục" đứng ngay trước
      let k = i - 1;
      while (k >= from && stream[k].t === 'a') k--;
      const hasTitle = k >= from && (stream[k].t === 'h' || stream[k].t === 'p') && TOC_TITLE.test(stream[k].text);
      if (count >= 4 || (hasTitle && count >= 2)) {
        if (hasTitle) members.push(k);
        for (const m of members) if (stream[m].t !== 'a') drop.push(m);
      }
      i = j;
    } else i++;
  }
  for (const idx of drop.sort((a, b) => b - a)) stream.splice(idx, 1);
}

function isHeadingLike(it) {
  return !!it && (it.t === 'h' || (it.t === 'p' && (it.cls || looksLikeChapterTitle(it.text))));
}

function nextContent(stream, pos) {
  for (let i = pos; i < stream.length; i++) {
    const it = stream[i];
    if (it.t === 'p' || it.t === 'h') return it;
    if (it.t === 'doc' && i > pos) return null;
  }
  return null;
}

function atDocStart(stream, pos) {
  for (let i = pos - 1; i >= 0; i--) {
    const it = stream[i];
    if (it.t === 'doc') return true;
    if (it.t === 'p' || it.t === 'h') return false;
  }
  return true;
}

function boundsFromToc(stream, toc, docIndex, anchorIndex) {
  const entries = [];
  const seen = new Set();
  for (const e of toc) {
    const [h, f] = splitHref(e.href);
    if (!docIndex.has(h)) continue;
    const d = docIndex.get(h);
    const pos = f ? (anchorIndex.get(`${h}#${f}`) ?? d) : d;
    if (seen.has(pos)) continue;
    seen.add(pos);
    entries.push({ pos, title: cleanText(e.title || ''), level: e.level || 0, doc: h });
  }
  entries.sort((a, b) => a.pos - b.pos);
  if (entries.length < 2 || new Set(entries.map(e => e.doc)).size < 2) return null;

  const level0 = entries.filter(e => e.level === 0).length;
  const keepAll = level0 < 2;
  const list = entries.filter(e =>
    keepAll || e.level === 0 || atDocStart(stream, e.pos) || isHeadingLike(nextContent(stream, e.pos)));
  if (list.length < 2) return null;

  // Tên cho phần trước chương đầu: mục TOC nằm trước ranh giới đầu (nếu có)
  const before = entries.find(e => e.pos < list[0].pos && e.title);
  list.forEach((e, i) => {
    if (!e.title) {
      const c = nextContent(stream, e.pos);
      e.title = c && c.text.length <= 100 ? c.text : `Phần ${i + 1}`;
    }
  });
  return { list, prefaceTitle: before ? before.title : null };
}

function boundsFromHeadings(stream) {
  const counts = new Map();
  let clsCount = 0, reCount = 0;
  for (const it of stream) {
    if (it.t === 'h') counts.set(it.level, (counts.get(it.level) || 0) + 1);
    else if (it.t === 'p') {
      if (it.cls) clsCount++;
      else if (looksLikeChapterTitle(it.text)) reCount++;
    }
  }
  let L = null;
  for (const lvl of [...counts.keys()].sort((a, b) => a - b)) {
    if (counts.get(lvl) >= 2) { L = lvl; break; }
  }
  let pick;
  if (L != null) pick = it => (it.t === 'h' && it.level === L) || (it.t === 'p' && it.cls);
  else if (clsCount >= 2) pick = it => it.t === 'p' && it.cls;
  else if (reCount >= 2) pick = it => it.t === 'p' && !it.cls && looksLikeChapterTitle(it.text);
  else return null;

  const cands = [];
  stream.forEach((it, i) => { if (pick(it)) cands.push({ pos: i, text: it.text }); });
  if (cands.length < 2) return null;

  // Gộp các tiêu đề liền nhau không có đoạn nào ở giữa
  const merged = [];
  for (const c of cands) {
    const last = merged[merged.length - 1];
    if (last) {
      let body = false;
      for (let i = last.endPos + 1; i < c.pos; i++) {
        if (stream[i].t === 'p' || stream[i].t === 'h') { body = true; break; }
      }
      if (!body) {
        const sep = looksLikeChapterTitle(last.title) && !looksLikeChapterTitle(c.text) ? ': ' : ' - ';
        last.title = `${last.title}${sep}${c.text}`;
        last.endPos = c.pos;
        last.n++;
        continue;
      }
    }
    merged.push({ pos: c.pos, endPos: c.pos, title: c.text, n: 1 });
  }
  const list = merged.map(m => ({ pos: m.pos, title: m.title, skip: m.n }));
  return { list, prefaceTitle: null };
}

function boundsFromDocs(stream, book) {
  const list = [];
  const docs = [];
  stream.forEach((it, i) => { if (it.t === 'doc') docs.push({ pos: i, title: it.title }); });
  const titleCount = new Map();
  docs.forEach(d => titleCount.set(d.title, (titleCount.get(d.title) || 0) + 1));
  let k = 0;
  docs.forEach((d, di) => {
    const end = di + 1 < docs.length ? docs[di + 1].pos : stream.length;
    const content = stream.slice(d.pos, end).filter(it => it.t === 'p' || it.t === 'h');
    if (!content.length) return;
    k++;
    let title = '';
    let skip = 0;
    if (content[0].t === 'h' && content[0].text.length <= 100) { title = content[0].text; skip = 1; }
    else if (d.title && titleCount.get(d.title) === 1 && d.title.length <= 100) title = d.title;
    if (!title) title = docs.length === 1 ? (book.meta.title || book.fallbackTitle || '') : '';
    list.push({ pos: d.pos, title: title || `Phần ${k}`, skip });
  });
  return { list, prefaceTitle: null };
}
