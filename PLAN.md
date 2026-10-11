# Xteink X3 EPUB Processor — Kế hoạch

## Context
Thư mục `/Users/sakutara/Work/xteink-processor` đang trống. Cần một webapp thuần client (HTML/CSS/JS, deploy GitHub Pages, PWA offline) nhận ebook (epub, azw3, azw, mobi, prc, txt, html/htm, fb2) và luôn xuất ra một EPUB tối giản cho máy đọc Xteink X3 (RAM ít, renderer đơn giản).

Những gì đã chốt với user:
- Nội dung chỉ có `<h1>` (tên chương) và `<p>`. **Không có `<a>`** ở bất kỳ đâu trong nội dung.
- **Mỗi chương là một file .xhtml.** Mỗi file có đúng **một** `<h1>` ở đầu, là tên chương.
- Drop cap: nhận diện bằng heuristic + alt text (không OCR), thay bằng chữ thuần.
- Ảnh: xoá hết, chỉ giữ ảnh bìa (thu nhỏ theo màn X3, chất lượng tối thiểu).
- Mục lục: chỉ có `toc.ncx` của máy đọc (EPUB 2, không có nav.xhtml), văn bản thuần. Trang mục lục nằm trong nội dung thì xoá. Sách không có TOC thì tự sinh từ danh sách chương.
- Xoá toàn bộ CSS và attribute style.

## Định dạng đầu ra (EPUB 2.0.1)
```
mimetype                 (đứng đầu, STORE)
META-INF/container.xml
OEBPS/content.opf        metadata + manifest + spine (toc="ncx") + <meta name="cover">
OEBPS/toc.ncx
OEBPS/images/cover.jpg   (nếu có)
OEBPS/text/ch001.xhtml … chNNN.xhtml
```
Một file chương có dạng:
```html
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Tên chương</title></head>
<body><h1>Tên chương</h1><p>…</p><p>…</p></body></html>
```
`<h1>` và `<p>` không mang attribute nào. `navPoint` trong NCX trỏ thẳng vào file, không cần anchor.

## Ảnh bìa
- **Tìm bìa:**
  - EPUB: thứ tự ưu tiên là `properties="cover-image"`, rồi `<meta name="cover">`, rồi `guide type="cover"` (lấy `<img>` đầu tiên trong trang đó), cuối cùng là ảnh có id/tên chứa `cover`.
  - MOBI/AZW3: EXTH 201.
  - FB2: `<coverpage>` → `<binary>`.
  - TXT/HTML: không có bìa.
- **Xử lý** trong worker bằng `createImageBitmap` + `OffscreenCanvas`:
  - fit vào **528×792**, độ phân giải X3 (3.7", ~257 PPI) theo spec bên thứ ba vì Xteink chưa công bố chính thức; giữ tỉ lệ, không phóng to;
  - chuyển sang xám;
  - xuất JPEG chất lượng **0.4**;
  - lưu thành `images/cover.jpg`.
- Chỉ khai báo trong OPF (`<meta name="cover" content="cover-image"/>`). **Không tạo trang cover.xhtml**, vì nó cần thẻ `<img>`. Máy đọc vẫn dùng bìa cho thumbnail và màn hình chờ.
- Không có OffscreenCanvas thì fallback sang canvas ở luồng chính. Ảnh lỗi thì bỏ bìa, vẫn chuyển đổi bình thường.

## Cấu trúc file
```
index.html          UI: kéo-thả/chọn file → trạng thái → nút tải xuống
app.css
app.js              UI + điều phối Web Worker (+ fallback xử lý bìa)
worker.js           file → reader → normalize → writer → Blob
src/readers/
  epub.js           JSZip, OPF spine, TOC từ NCX hoặc nav, tìm bìa
  mobi.js           wrapper quanh mobi.js của foliate-js (MOBI/AZW/AZW3/KF8/PRC)
  fb2.js            DOMParser
  html.js           một doc
  txt.js            dò encoding (UTF-8 fatal → windows-1258 → windows-1252)
src/normalize.js    lõi chuyển đổi
src/cover.js        resize, chuyển xám, nén JPEG
src/writer.js       tạo EPUB2 bằng JSZip
vendor/             jszip.min.js, foliate-js mobi.js (MIT), vendor sẵn nên không cần CDN
sw.js               precache toàn bộ asset, cache-first, có version
manifest.webmanifest, icons/, .nojekyll
```
Tất cả path đều tương đối để chạy được trên subpath `/<repo>/` của GitHub Pages.

## Mô hình trung gian
Reader trả về `{ meta, cover: Blob|null, docs: [{ href, html }], toc: [{ title, href#frag }], tocDocHrefs }`.

## normalize.js: các bước
1. **Parse** từng doc bằng `DOMParser` (thử XHTML, lỗi thì fallback `text/html`).
2. **Bỏ trang mục lục trong nội dung**: bỏ doc trỏ bởi `guide type="toc"` hay landmark `toc`, hoặc doc có tiêu đề "Mục lục|Contents|Table of Contents" mà phần lớn khối là link nội bộ.
3. **Drop cap → chữ**: với `<img>`/`<svg><image>` ở đầu khối, ngay trước text:
   - lấy alt/title nếu là 1–3 ký tự chữ;
   - không có thì lấy tên file khớp `(^|[_\-/])([A-Za-zÀ-ỹ])\.(jpe?g|png|gif|svg)$`, hoặc tên chứa `dropcap|initial` kèm 1 chữ cái;
   - nếu nằm trong phần tử class `dropcap|first-?letter|initial` thì cũng áp dụng như trên.
   - Khớp thì chèn chữ thuần, ghép liền với text phía sau. Không khớp thì xoá ảnh.
4. **Nhận diện ranh giới chương**, theo thứ tự ưu tiên:
   - đích của các mục TOC gốc (fragment hoặc đầu file);
   - nếu TOC gốc không dùng được thì dùng heading cấp cao nhất trong sách (h1, không có thì h2, …), class `chapter|chapter-title`, hoặc đoạn ngắn đứng riêng khớp `^(Chương|Hồi|Phần|Quyển|Chapter|Part|Book)\s+[\dIVXLC]+`.
   - Text của điểm ranh giới chính là tên chương.
5. **Làm phẳng**: chỉ xuất `<p>` text thuần.
   - Mọi heading khác không phải tên chương (tiêu đề phụ trong chương) đều thành `<p>`.
   - Các khối (div, section, blockquote, li, td, …) thành `<p>`.
   - Inline (span, b, i, em, **a**, sup, …) bóc thẻ, giữ text. `<br>` tách `<p>`.
   - Xoá script/style/link/img/svg/media, mọi attribute, comment và đoạn rỗng.
   - Chuẩn hoá khoảng trắng và escape `& < >`.
6. **Tách file**: mỗi chương thành `chNNN.xhtml` với đúng một `<h1>` ở đầu. Nội dung trước chương đầu tiên (lời đề tặng, giới thiệu…) thành một file riêng, `<h1>` là tên mục trong TOC nếu có, không có thì đặt "Mở đầu".
7. **Dựng `toc.ncx`**, lúc nào cũng có:
   - Có TOC gốc thì giữ tên mục (text thuần, trim) và trỏ vào file chương tương ứng.
   - Không có TOC hoặc TOC hỏng (dưới 2 mục hoặc mọi mục trỏ cùng một file) thì **tự sinh từ danh sách chương** ở bước 4, mỗi `<h1>` là một `navPoint`.
   - Không nhận diện được chương nào thì mỗi file spine gốc là một chương, tên lấy từ `<title>` hoặc "Phần 1, 2, …".
   - TOC phân cấp được làm phẳng thành danh sách chương. Mục con trỏ vào giữa chương chỉ tách file khi nó là ranh giới chương ở bước 4.

## Đọc từng định dạng
- **EPUB**: spine theo OPF. TOC lấy từ NCX, không có thì từ nav. Bỏ CSS, font và ảnh (trừ bìa).
- **MOBI/AZW3/PRC**: dùng `MOBI` của foliate-js để lấy sections, TOC, bìa. File có DRM thì báo lỗi rõ ràng.
- **FB2**: `<section><title>` là chương, `<p>` giữ nguyên, `<binary>` chỉ dùng để lấy bìa.
- **TXT**: dòng trống tách đoạn, dòng khớp regex tựa chương là ranh giới chương.
- **HTML**: một doc, chương lấy từ heading hoặc regex.

## UI
Một trang: kéo-thả/chọn file → tiến trình → nút "Tải xuống `<title> - <author> - xte.epub` (bỏ phần `<author>` nếu sách không có tác giả)". `<title>` lấy từ metadata của sách; không có metadata thì dùng tên file gốc (bỏ đuôi); ký tự không hợp lệ trong tên file được thay bằng khoảng trắng. Không có tuỳ chọn nào khác. Báo lỗi bằng tiếng Việt, có chỉ báo "Sẵn sàng offline".

## Verification
1. Chạy `python3 -m http.server` trong project, mở bằng built-in browser.
2. Fixture trong scratchpad:
   - epub không có toc.ncx/nav, để kiểm tra NCX tự sinh;
   - epub có drop cap `alt="T"`, ảnh thường, ảnh bìa lớn, CSS, trang mục lục, h1/h3 lồng, link chú thích;
   - txt CP1258;
   - fb2.
3. Script kiểm epub đầu ra:
   - body chỉ chứa {h1, p}, mỗi file có đúng 1 `<h1>` và nó là phần tử đầu tiên;
   - không có attribute nào trên h1/p;
   - không có `<a>`, `<img>`, CSS hay attribute style;
   - mimetype đứng đầu và STORE;
   - ảnh duy nhất là `cover.jpg` ≤528×792, xám;
   - toc.ncx đúng thứ tự, trỏ đúng file.
   - Có `epubcheck` thì chạy thêm.
4. Thử azw3 thật nếu user cung cấp.
5. PWA: SW đã activate. Tắt server rồi reload, xử lý lại file vẫn chạy offline.

## Ghi chú triển khai (lệch so với kế hoạch)
- **Không dùng Web Worker**: `DOMParser` không có trong worker nên toàn bộ xử lý chạy ở luồng chính, nhường luồng bằng `setTimeout` giữa các tài liệu. Do đó không có `worker.js`; điều phối nằm ở `src/convert.js`, bìa xử lý bằng `OffscreenCanvas` (fallback `<canvas>`) ở luồng chính.
- Reader trả về `docs: [{href, doc}]` với `doc` là `Document` đã parse (không phải chuỗi html); TXT/FB2 tạo document tổng hợp gồm `<h1>`/`<p>`.
- `vendor/foliate-mobi.js` là `mobi.js` (commit 78914ae) kèm một chỉnh sửa nhỏ: KF8 quay về parse HTML khi XHTML lỗi. Không cần phụ thuộc nào khác; `unzlib` chỉ dùng cho font nên bỏ qua.
- Chương dài hơn ~150.000 ký tự được tách thành "Tên (2)", "Tên (3)"… để máy đọc ít RAM không bị nghẽn.
- JPEG bìa do canvas xuất có 3 thành phần nhưng mọi pixel R=G=B (xám).
- Mục TOC lồng bên trong chương chỉ tách file khi là heading/regex tựa chương; NCX đầu ra là danh sách phẳng, mỗi file chương một navPoint.
