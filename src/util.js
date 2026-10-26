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

// Viết tắt có dấu chấm dính liền chữ hoa theo sau (Ph.D, Tp.HCM...) — không tách.
const ABBREV = /^(?:ph|th|tp|tt|dr|mr|mrs|ms|st|prof|gs|ts|ths|pgs|ks|bs|cn|vs|jr|sr|nxb)$/i;
// Token là URL / email / tham số truy vấn thì giữ nguyên.
const URL_LIKE = /:\/\/|www\.|@|\.[a-z]{2,}\/|\?\w+=/i;

/** Thêm khoảng trắng còn thiếu và bỏ khoảng trắng thừa quanh dấu `"` (chỉ khi các dấu đi theo cặp). */
function fixQuotes(s) {
  const parts = s.split('"');
  if (parts.length < 3 || parts.length % 2 === 0) return s;
  for (let k = 0; k < parts.length - 1; k++) {
    if (k % 2 === 0) { // mở
      if (/[\p{L}\p{N},;:.!?)\]]$/u.test(parts[k])) parts[k] += ' ';
      parts[k + 1] = parts[k + 1].replace(/^ +/, '');
    } else { // đóng
      parts[k] = parts[k].replace(/ +$/, '');
      if (/^[\p{L}\p{N}]/u.test(parts[k + 1])) parts[k + 1] = ' ' + parts[k + 1];
    }
  }
  return parts.join('"');
}

/** Sửa khoảng cách quanh dấu câu: thừa trước `.,;:!?`, thiếu sau dấu, thừa trong ngoặc / nháy kép. */
function fixPunctuation(s) {
  return fixQuotes(s)
    .replace(/ +([.,;:!?]+)(?!\d)/g, '$1')
    .replace(/([(\[]) +/g, '$1')
    .replace(/ +([)\]])/g, '$1')
    .replace(/\S+/g, tok => {
      if (URL_LIKE.test(tok)) return tok;
      return tok
        .replace(/(?<!^(?:https?|ftp|mailto|tel|file))([,;:!?])(?=\p{L})/giu, '$1 ')
        .replace(/\.{2,}(?=\p{L})/gu, m => m + ' ')
        .replace(/(\p{L}*\p{Ll})\.(?=\p{Lu})/gu, (m, w) => (ABBREV.test(w) ? m : m + ' '));
    });
}

/** Chuẩn hoá một đoạn text: NFC, bỏ ký tự XML không hợp lệ, đổi ký tự đặc biệt, gộp khoảng trắng, sửa khoảng cách dấu câu. */
export function cleanText(s) {
  return fixPunctuation(cleanBase(s)).trim();
}

function cleanBase(s) {
  return String(s)
    .replace(INVALID_XML, '')
    .replace(SPECIAL, c => CHAR_MAP.get(c))
    .replace(INVISIBLE, '')
    .replace(/[\s   -   　]+/g, ' ')
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

// --- Markup nội tuyến trong đoạn văn: ký tự private-use làm dấu hiệu, giữ nguyên là chuỗi để các bước
// cắt chương/tách đoạn không phải đổi kiểu dữ liệu. Tag được hỗ trợ: i, b (nội tuyến), ul/ol/li và blockquote (đánh dấu đầu đoạn).
export const MK = { I1: '\uE000', I0: '\uE001', B1: '\uE002', B0: '\uE003', UL: '\uE010', OL: '\uE011', BQ: '\uE012', CTR: '\uE013' };
const MK_ALL = /[\uE000-\uE003\uE010-\uE013]/g;
const TAGS = { '\uE000': ['i', 1], '\uE001': ['i', 0], '\uE002': ['b', 1], '\uE003': ['b', 0] };

/** Bỏ cặp tag rỗng và khoảng trắng thừa sinh ra quanh chúng. */
export function tidyRich(s) {
  let prev;
  do { prev = s; s = s.replace(/([\uE000\uE002])(\s*)[\uE001\uE003]/g, '$2'); } while (s !== prev);
  return s.replace(/ {2,}/g, ' ').trim();
}

/** Đoạn văn không kèm dấu hiệu markup. */
export const richPlain = s => s.replace(MK_ALL, '');
/** Bỏ ký tự private-use có sẵn trong nguồn (font icon...) để không bị nhầm với dấu hiệu. */
export const stripPrivate = s => s.replace(/[-]/g, '');

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '–': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '–': '₋', '=': '₌', '(': '₍', ')': '₎' };
const KEEP = /^[\s*†‡,.]$/;

/** Bỏ ngoặc bao quanh toàn bộ nội dung sup/sub: "[1]" -> "1", "(2)" -> "2". */
export const unwrapBrackets = s => { const m = /^\s*[[(]\s*([^[\]()]*?)\s*[\])]\s*$/.exec(s); return m ? m[1] : s; };

/**
 * Chuyển nội dung <sup>/<sub> sang ký tự Unicode (¹ ² ³ ₂ …). Dấu * † ‡ , . giữ nguyên.
 * Trả về null nếu có ký tự không có dạng chỉ số, khi đó giữ chữ như cũ.
 */
export function toScript(text, kind) {
  const map = kind === 'sub' ? SUB : SUP;
  let out = '';
  for (const ch of text) {
    if (KEEP.test(ch)) out += ch;
    else if (map[ch]) out += map[ch];
    else return null;
  }
  return out;
}

/** @returns {{kind:'ul'|'ol'|'bq'|'ctr'|null, body:string}} */
export function splitBlock(s) {
  if (s[0] === MK.UL) return { kind: 'ul', body: s.slice(1) };
  if (s[0] === MK.OL) return { kind: 'ol', body: s.slice(1) };
  if (s[0] === MK.BQ) return { kind: 'bq', body: s.slice(1) };
  if (s[0] === MK.CTR) return { kind: 'ctr', body: s.slice(1) };
  return { kind: null, body: s };
}

/**
 * Đoạn (đã bỏ dấu hiệu khối) -> XHTML. `hits` là các khoảng {start,end,html} theo toạ độ của `richPlain`,
 * thay thế phần chữ tương ứng bằng `html` (dùng cho Wordwise); khoảng nào băng qua dấu hiệu thì bị bỏ.
 */
export function richToHtml(body, hits = []) {
  let prev;
  do { prev = body; body = body.replace(/([])(\s*)[]/g, '$2'); } while (body !== prev);
  let out = '', po = 0, hi = 0;
  const stack = [];
  const closeTo = (name) => {
    const k = stack.lastIndexOf(name);
    if (k < 0) return;
    const reopen = stack.splice(k).slice(1);
    for (let j = reopen.length - 1; j >= 0; j--) out += `</${reopen[j]}>`;
    out += `</${name}>`;
    for (const n of reopen) { out += `<${n}>`; stack.push(n); }
  };
  const run = (text) => {
    const end = po + text.length;
    let at = 0;
    while (hi < hits.length && hits[hi].start < end) {
      const h = hits[hi++];
      if (h.start < po || h.end > end) continue;
      out += escapeXml(text.slice(at, h.start - po)) + h.html;
      at = h.end - po;
    }
    out += escapeXml(text.slice(at));
    po = end;
  };
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const t = i < body.length ? TAGS[body[i]] : null;
    if (i < body.length && !t) continue;
    if (i > start) run(body.slice(start, i));
    start = i + 1;
    if (!t) continue;
    if (t[1]) { stack.push(t[0]); out += `<${t[0]}>`; } else closeTo(t[0]);
  }
  for (let j = stack.length - 1; j >= 0; j--) out += `</${stack[j]}>`;
  return out;
}
