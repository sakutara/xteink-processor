// Điều phối: file -> reader -> normalize -> cover -> writer.
import { UserError, extOf, baseName, cleanText, safeFileName } from './util.js';
import { normalize } from './normalize.js';
import { processCover } from './cover.js';
import { writeEpub } from './writer.js';

export const SUPPORTED = ['epub', 'azw3', 'azw', 'mobi', 'prc', 'txt', 'html', 'htm', 'xhtml', 'fb2'];

async function readerFor(ext) {
  switch (ext) {
    case 'epub': return (await import('./readers/epub.js')).readEpub;
    case 'mobi': case 'azw': case 'azw3': case 'prc': return (await import('./readers/mobi.js')).readMobi;
    case 'fb2': return (await import('./readers/fb2.js')).readFb2;
    case 'html': case 'htm': case 'xhtml': return (await import('./readers/html.js')).readHtml;
    case 'txt': return (await import('./readers/txt.js')).readTxt;
    default:
      throw new UserError(`Định dạng ".${ext}" chưa được hỗ trợ. Hỗ trợ: EPUB, AZW3, AZW, MOBI, PRC, TXT, HTML, FB2.`);
  }
}

/** @returns {Promise<{blob:Blob, filename:string, chapters:number, hasCover:boolean}>} */
export async function convert(file, report = () => {}) {
  const ext = extOf(file.name);
  report('Đang đọc tệp…', 0.02);
  const read = await readerFor(ext);
  const book = await read(file, (msg, f) => report(msg, 0.05 + 0.4 * (f || 0)));
  report('Đang xử lý nội dung…', 0.5);
  const chapters = await normalize(book, (msg, f) => report(msg, 0.5 + 0.3 * (f || 0)));
  report('Đang xử lý ảnh bìa…', 0.85);
  const cover = await processCover(book.cover);
  report('Đang đóng gói EPUB…', 0.92);
  const title = cleanText(book.meta.title || '') || baseName(file.name);
  const blob = await writeEpub({ ...book.meta, title }, chapters, cover);
  report('Hoàn tất', 1);
  const author = safeFileName((book.meta.author || []).filter(Boolean).join(', '));
  const name = [safeFileName(title) || safeFileName(baseName(file.name)) || 'ebook', author, 'xte'].filter(Boolean).join(' - ');
  return { blob, filename: `${name}.epub`, chapters: chapters.length, hasCover: !!cover };
}
