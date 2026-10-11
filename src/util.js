// Tiện ích dùng chung.

export class UserError extends Error {}

export const tick = () => new Promise(r => setTimeout(r, 0));

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Ký tự đặc biệt -> ký tự thường tương đương. Hán tự/kana/hangul/chữ Việt và mọi ký tự
// không có trong bảng được giữ nguyên.
const CHAR_MAP = new Map();
const mapAll = (chars, to) => { for (const c of chars) CHAR_MAP.set(c, to); };
mapAll('‘’‚‛′ʼ', "'");
mapAll('“”„‟″«»', '"');
mapAll('‐‑‒–—―−', '-');
mapAll('•‣◦∙⊙', '*');
mapAll('…', '...');
mapAll('‥', '..');
mapAll('，、﹐､', ',');
mapAll('。｡', '.');
mapAll('「」『』《》〈〉﹁﹂﹃﹄', '"');
mapAll('【】〖〗〔〕', '');
mapAll('・･', '-');
mapAll('〜～', '~');
CHAR_MAP.set('【', '['); CHAR_MAP.set('】', ']');
CHAR_MAP.set('〖', '['); CHAR_MAP.set('〗', ']');
CHAR_MAP.set('〔', '('); CHAR_MAP.set('〕', ')');
[['ﬀ', 'ff'], ['ﬁ', 'fi'], ['ﬂ', 'fl'], ['ﬃ', 'ffi'], ['ﬄ', 'ffl'], ['ﬅ', 'st'], ['ﬆ', 'st']]
  .forEach(([k, v]) => CHAR_MAP.set(k, v));
// Full-width ASCII (！ -> !, Ａ -> A ...); dấu câu Hán như ： ； ？ ！ （ ） cũng nằm trong dải này.
for (let c = 0xFF01; c <= 0xFF5E; c++) {
  const ch = String.fromCharCode(c);
  if (!CHAR_MAP.has(ch)) CHAR_MAP.set(ch, String.fromCharCode(c - 0xFEE0));
}
const SPECIAL = new RegExp(`[${[...CHAR_MAP.keys()].join('')}]`, 'g');
const INVISIBLE = /[​-‏‪-‮⁠-⁤­﻿︀-️￼�]/g;

/** Chuẩn hoá một đoạn text: NFC, bỏ ký tự XML không hợp lệ, đổi ký tự đặc biệt, gộp khoảng trắng. */
export function cleanText(s) {
  return String(s)
    .replace(INVALID_XML, '')
    .replace(SPECIAL, c => CHAR_MAP.get(c))
    .replace(INVISIBLE, '')
    .replace(/[\s   -   　]+/g, ' ')
    .trim()
    .normalize('NFC');
}

export const escapeXml = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function baseName(name) {
  const n = name.split(/[\\/]/).pop();
  return n.replace(/\.[^.]*$/, '') || n;
}

/** Tên file an toàn: bỏ ký tự cấm, gom khoảng trắng, giới hạn độ dài. */
export function safeFileName(name) {
  const n = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return n.slice(0, 120).trim();
}

export function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** Giải đường dẫn tương đối `href` so với file `base` (đường dẫn kiểu zip). */
export function resolvePath(base, href) {
  let path = href.split('#')[0];
  try { path = decodeURI(path); } catch { /* giữ nguyên */ }
  if (!path) return base;
  const parts = path.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of path.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

export function fragmentOf(href) {
  const i = href.indexOf('#');
  if (i < 0) return '';
  const f = href.slice(i + 1);
  try { return decodeURIComponent(f); } catch { return f; }
}

/** Dò encoding từ khai báo XML / meta charset trong ~1KB đầu. */
function sniffCharset(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const m = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)
    || /<meta[^>]*charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : null;
}

export function decodeMarkup(bytes) {
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
  let label = sniffCharset(bytes);
  if (!label || label === 'utf8') label = 'utf-8';
  let text;
  try {
    text = new TextDecoder(label).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

const CHILD_PARSERERROR = 'parsererror';

export function parseXml(text, type = 'application/xml') {
  const doc = new DOMParser().parseFromString(text, type);
  const bad = doc.getElementsByTagName(CHILD_PARSERERROR).length > 0;
  return bad ? null : doc;
}

/** XHTML trước, lỗi thì quay về text/html. */
export function parseMarkup(text) {
  return parseXml(text, 'application/xhtml+xml')
    || new DOMParser().parseFromString(text, 'text/html');
}

// --- Nhận diện tiêu đề chương dạng văn bản -------------------------------
const NUM_WORDS = [
  'không', 'một', 'mốt', 'hai', 'ba', 'bốn', 'tư', 'năm', 'lăm', 'sáu', 'bảy', 'tám', 'chín',
  'mười', 'mươi', 'chục', 'trăm', 'nhất', 'nhì', 'đầu', 'cuối', 'linh', 'lẻ',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'first', 'second', 'third',
  'final', 'last',
];
const END = '(?![a-z0-9à-ỹ])';
const KEYWORDS = 'chương|hồi|phần|quyển|tập|chapter|part|book|volume';
export const CHAPTER_RE = new RegExp(
  `^(?:${KEYWORDS})\\s+(?:\\d+|[ivxlcdm]+${END}|(?:${NUM_WORDS.join('|')})${END}(?:\\s+(?:${NUM_WORDS.join('|')})${END}){0,3})` +
  `(?:\\s*[.:)\\-–—]\\s*.{0,100}|\\s+.{0,80})?$`,
);
export const SPECIAL_RE = new RegExp(
  '^(?:lời nói đầu|lời giới thiệu|lời tựa|lời dẫn|mở đầu|giới thiệu|phần kết|kết luận|phụ lục|' +
  'prologue|epilogue|introduction|preface|foreword|afterword|conclusion|appendix)\\s*[.:]?$',
);

/** Dòng ngắn đứng riêng có giống tiêu đề chương không? */
export function looksLikeChapterTitle(text) {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 110) return false;
  if (SPECIAL_RE.test(t)) return true;
  if (!CHAPTER_RE.test(t)) return false;
  // "Phần lớn thời gian ..." không phải tiêu đề: câu dài có dấu chấm cuối.
  return !/[.,;]$/.test(t) || t.length <= 40;
}
