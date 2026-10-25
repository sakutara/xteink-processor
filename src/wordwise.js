// Wordwise: chú giải ngắn (ruby) cho từ khó trong sách tiếng Anh.
// Cấp 0 = tắt; cấp 1-3 = số lượng từ được chú giải tăng dần, luôn bắt đầu từ bộ từ khó nhất.
// Dữ liệu data/wordwise-en.tsv do tools/build_wordwise.py sinh ra (tier 1 = khó nhất).
import { escapeXml } from './util.js';

export const LEVELS = [0, 1, 2, 3];

const EN_STOP = new Set('the of and to a in that is was he it for with as his on be at by had not are but from or have an they which you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three'.split(' '));

/** @returns {Map<string,{tier:number, gloss:string}>} */
export function parseDict(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const a = line.indexOf('\t');
    const b = line.indexOf('\t', a + 1);
    if (a < 1 || b < 0) continue;
    map.set(line.slice(a + 1, b), { tier: +line.slice(0, a), gloss: line.slice(b + 1).trim() });
  }
  return map;
}

let dictPromise = null;
export function loadDict() {
  dictPromise ||= fetch(new URL('../data/wordwise-en.tsv', import.meta.url))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then(parseDict)
    .catch(e => { dictPromise = null; throw e; });
  return dictPromise;
}

/** Sách có phải tiếng Anh không: ưu tiên metadata, nếu thiếu thì đoán theo từ chức năng thường gặp. */
export function isEnglish(meta, chapters) {
  const lang = String((meta && meta.language) || '').trim().toLowerCase();
  if (lang) return /^(en|eng)([-_]|$)/.test(lang);
  let words = 0, stop = 0;
  outer: for (const ch of chapters) {
    for (const p of ch.paras) {
      for (const w of p.toLowerCase().match(/[a-zÀ-ỹ']+/g) || []) {
        words++;
        if (EN_STOP.has(w)) stop++;
        if (words >= 3000) break outer;
      }
    }
  }
  return words >= 50 && stop / words > 0.2;
}

const DOUBLE = /([bcdfgklmnprstvz])\1$/;

/** Các dạng gốc có thể có của một từ (đã viết thường), theo thứ tự thử. */
export function candidates(w) {
  const out = [w];
  const n = w.length;
  if (w.endsWith('ies') && n > 4) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && n > 3) out.push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss') && n > 3) out.push(w.slice(0, -1));
  if (w.endsWith('ied') && n > 4) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed') && n > 4) {
    const s = w.slice(0, -2);
    out.push(s, s + 'e');
    if (DOUBLE.test(s)) out.push(s.slice(0, -1));
  }
  if (w.endsWith('ing') && n > 5) {
    const s = w.slice(0, -3);
    out.push(s, s + 'e');
    if (DOUBLE.test(s)) out.push(s.slice(0, -1));
  }
  if (w.endsWith('ier') && n > 5) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('er') && n > 4) { const s = w.slice(0, -2); out.push(s, s + 'e'); if (DOUBLE.test(s)) out.push(s.slice(0, -1)); }
  if (w.endsWith('est') && n > 5) { const s = w.slice(0, -3); out.push(s, s + 'e'); if (DOUBLE.test(s)) out.push(s.slice(0, -1)); }
  return out;
}

function lookup(dict, lower, maxTier) {
  for (const c of candidates(lower)) {
    const e = dict.get(c);
    if (e && e.tier <= maxTier) return { key: c, gloss: e.gloss };
  }
  return null;
}

const WORD_RE = /[A-Za-z]+/g;
const SENTENCE_START = /(^|[.!?…:]["'“”‘’)\]]*\s+|^["'“‘(\[]+|[“"‘(]\s*)$/;

/**
 * Chú giải một đoạn. Mỗi từ gốc chỉ chú giải lần xuất hiện đầu trong `seen` (thường là một chương).
 * @returns {{html:string, count:number}}
 */
export function annotateText(text, dict, maxTier, seen) {
  let html = '', last = 0, count = 0;
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text))) {
    const word = m[0];
    if (word.length < 4) continue;
    const end = m.index + word.length;
    // bỏ qua từ dính dấu nháy kiểu don't, o'clock, và số/chữ lẫn lộn
    if (/['’]/.test(text[end] || '') && /[A-Za-z]/.test(text[end + 1] || '') && !/^['’]s\b/i.test(text.slice(end, end + 3))) continue;
    if (m.index > 0 && /['’\d]/.test(text[m.index - 1])) continue;
    const first = word[0];
    const isUpper = first !== first.toLowerCase();
    if (isUpper) {
      if (word.length > 1 && word === word.toUpperCase()) continue;
      if (!SENTENCE_START.test(text.slice(0, m.index))) continue; // tên riêng
    }
    const hit = lookup(dict, word.toLowerCase(), maxTier);
    if (!hit || seen.has(hit.key)) continue;
    seen.add(hit.key);
    html += escapeXml(text.slice(last, m.index)) +
      `<ruby>${escapeXml(word)}<rp>(</rp><rt>${escapeXml(hit.gloss)}</rt><rp>)</rp></ruby>`;
    last = end;
    count++;
  }
  return { html: html + escapeXml(text.slice(last)), count };
}

/**
 * Gắn `ch.html` (mảng HTML theo từng đoạn) cho mỗi chương.
 * @returns {number} tổng số từ được chú giải
 */
export function applyWordwise(chapters, dict, level) {
  let total = 0;
  for (const ch of chapters) {
    const seen = new Set();
    ch.html = ch.paras.map(p => {
      const r = annotateText(p, dict, level, seen);
      total += r.count;
      return r.html;
    });
  }
  return total;
}
