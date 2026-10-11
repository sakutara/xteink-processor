# Xteink EPUB

Webapp thuần client (HTML/CSS/JS, không cần build) chuyển ebook sang EPUB 2.0.1 tối giản cho máy đọc Xteink X3.
Chạy hoàn toàn trên trình duyệt, cài được như PWA và dùng được khi offline.

## Cách dùng
1. Mở trang, kéo thả hoặc chọn tệp ebook (EPUB, AZW3, AZW, MOBI, PRC, TXT, HTML, FB2).
2. Chờ thanh tiến trình chạy xong.
3. Bấm "Tải xuống `<title> - <author> - xte.epub` (bỏ phần `<author>` nếu sách không có tác giả)" (title lấy từ metadata, không có thì dùng tên file gốc) rồi chép vào máy đọc.

Đầu ra: mỗi chương một file `.xhtml` chỉ có một `<h1>` và các `<p>` thuần văn bản; mục lục `toc.ncx`;
ảnh bìa (nếu có) thu nhỏ vừa 528×792, xám, JPEG chất lượng 0.4. Không có CSS, ảnh trong nội dung hay liên kết.
Sách có DRM không chuyển đổi được.

## Chạy thử cục bộ
```sh
python3 -m http.server 8000
# mở http://localhost:8000
```

## Deploy lên GitHub Pages
1. Đẩy toàn bộ thư mục này lên một repo GitHub (file `.nojekyll` đã có sẵn, mọi đường dẫn đều tương đối).
2. Vào Settings → Pages → Source: "Deploy from a branch", chọn nhánh `main`, thư mục `/ (root)`.
3. Truy cập `https://<user>.github.io/<repo>/`. Lần mở đầu cần mạng để service worker tải sẵn mọi tệp; sau đó
   chỉ báo "Sẵn sàng offline" sẽ hiện và ứng dụng chạy được không cần mạng.

Khi sửa bất kỳ tệp nào, tăng `VERSION` trong `sw.js` để người dùng nhận bản mới.

## Thư viện
`vendor/jszip.min.js` (JSZip 3.10.1) và `vendor/foliate-mobi.js` (mobi.js của foliate-js, MIT). Xem `vendor/README.md`.
