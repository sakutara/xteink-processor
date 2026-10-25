// Điều phối: file -> reader -> normalize -> cover -> writer.
import { UserError, extOf, baseName, cleanText, safeFileName } from './util.js';
import { normalize } from './normalize.js';
import { processCover } from './cover.js';
import { writeEpub } from './writer.js';
import { loadDict, isEnglish, applyWordwise } from './wordwise.js';

export const SUPPORTED = ['epub', 'azw3', 'azw', 'mobi', 'prc', 'txt', 'html', 'htm', 'xhtml', 'fb2', 'pdf'];

async function readerFor(ext) {
  switch (ext) {
    case 'epub': return (await import('./readers/epub.js')).readEpub;
    case 'mobi': case 'azw': case 'azw3': case 'prc': return (await import('./readers/mobi.js')).readMobi;
    case 'fb2': return (await import('./readers/fb2.js')).readFb2;
    case 'html': case 'htm': case 'xhtml': return (await import('./readers/html.js')).readHtml;
    case 'pdf': return (await import('./readers/pdf.js')).readPdf;
    case 'txt': return (await import('./readers/txt.js')).readTxt;
    default:
      throw new UserError(`Định dạng ".${ext}" chưa được hỗ trợ. Hỗ trợ: EPUB, AZW3, AZW, MOBI, PRC, TXT, HTML, FB2, PDF.`);
  }
}

/**
 * @param {{wordwise?:number}} options  wordwise: 0 (tắt) – 3, chỉ áp dụng cho sách tiếng Anh
 * @returns {Promise<{blob:Blob, filename:string, chapters:number, hasCover:boolean, wordwise:{level:number, words:number, skipped:string}}>}
 */
export async function convert(file, report = () => {}, options = {}) {
  const ext = extOf(file.name);
  report('Đang đọc tệp…', 0.02);
  const read = await readerFor(ext);
  const book = await read(file, (msg, f) => report(msg, 0.05 + 0.4 * (f || 0)));
  report('Đang xử lý nội dung…', 0.5);
  const chapters = await normalize(book, (msg, f) => report(msg, 0.5 + 0.3 * (f || 0)));
  const ww = { level: 0, words: 0, skipped: '' };
  const level = Math.max(0, Math.min(3, Math.floor(options.wordwise) || 0));
  if (level > 0) {
    if (!isEnglish(book.meta, chapters)) ww.skipped = 'Sách không phải tiếng Anh nên bỏ qua Wordwise.';
    else {
      report('Đang thêm Wordwise…', 0.8);
      try {
        ww.words = applyWordwise(chapters, await loadDict(), level);
        ww.level = level;
      } catch (e) {
        console.error(e);
        ww.skipped = 'Không tải được từ điển Wordwise nên bỏ qua.';
      }
    }
  }
  report('Đang xử lý ảnh bìa…', 0.85);
  const cover = await processCover(book.cover);
  report('Đang đóng gói EPUB…', 0.92);
  const title = cleanText(book.meta.title || '') || baseName(file.name);
  const blob = await writeEpub({ ...book.meta, title }, chapters, cover);
  report('Hoàn tất', 1);
  const author = safeFileName((book.meta.author || []).filter(Boolean).join(', '));
  const name = [safeFileName(title) || safeFileName(baseName(file.name)) || 'ebook', author, 'xte'].filter(Boolean).join(' - ');
  return { blob, filename: `${name}.epub`, chapters: chapters.length, hasCover: !!cover, wordwise: ww };
}
