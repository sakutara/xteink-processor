// Dựng EPUB 2.0.1 tối giản bằng JSZip.
import { escapeXml } from './util.js';

const XHTML_HEAD =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n' +
  '<html xmlns="http://www.w3.org/1999/xhtml">';

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function chapterFile(i) {
  return `ch${String(i + 1).padStart(3, '0')}.xhtml`;
}

/**
 * @param {{title:string, author:string[], language:string}} meta
 * @param {{title:string, paras:string[], html?:string[]}[]} chapters  (html: đoạn đã dựng sẵn markup, ví dụ Wordwise)
 * @param {Uint8Array|null} coverJpeg
 * @returns {Promise<Blob>}
 */
export async function writeEpub(meta, chapters, coverJpeg) {
  const JSZip = globalThis.JSZip;
  const zip = new JSZip();
  const NOF = { createFolders: false };
  const id = `urn:uuid:${uuid()}`;
  const title = meta.title || 'Không có tiêu đề';
  const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(meta.language || '') ? meta.language : 'vi';

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', createFolders: false });
  zip.file('META-INF/container.xml',
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    '</container>', NOF);

  chapters.forEach((c, i) => {
    const t = escapeXml(c.title);
    const body = c.paras.map((p, k) => `<p>${c.html ? c.html[k] : escapeXml(p)}</p>`).join('\n');
    zip.file(`OEBPS/text/${chapterFile(i)}`,
      `${XHTML_HEAD}<head><title>${t}</title></head>\n<body><h1>${t}</h1>\n${body}</body></html>\n`, NOF);
  });

  if (coverJpeg) zip.file('OEBPS/images/cover.jpg', coverJpeg, NOF);

  const manifest = ['<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'];
  const spine = [];
  chapters.forEach((_, i) => {
    manifest.push(`<item id="ch${i + 1}" href="text/${chapterFile(i)}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="ch${i + 1}"/>`);
  });
  if (coverJpeg) manifest.push('<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>');

  const authors = (meta.author || []).filter(Boolean)
    .map(a => `<dc:creator>${escapeXml(a)}</dc:creator>`).join('');
  zip.file('OEBPS/content.opf',
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">' +
    `<dc:title>${escapeXml(title)}</dc:title>${authors}<dc:language>${escapeXml(lang)}</dc:language>` +
    `<dc:identifier id="bookid">${id}</dc:identifier>` +
    (coverJpeg ? '<meta name="cover" content="cover-image"/>' : '') +
    '</metadata>' +
    `<manifest>${manifest.join('')}</manifest>` +
    `<spine toc="ncx">${spine.join('')}</spine></package>\n`, NOF);

  const points = chapters.map((c, i) =>
    `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(c.title)}</text></navLabel>` +
    `<content src="text/${chapterFile(i)}"/></navPoint>`).join('\n');
  zip.file('OEBPS/toc.ncx',
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">\n' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head>' +
    `<meta name="dtb:uid" content="${id}"/><meta name="dtb:depth" content="1"/>` +
    '<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>' +
    `<docTitle><text>${escapeXml(title)}</text></docTitle><navMap>\n${points}\n</navMap></ncx>\n`, NOF);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
