# Thư viện bên thứ ba

- `jszip.min.js` — JSZip 3.10.1 (MIT hoặc GPLv3, chọn MIT). https://github.com/Stuk/jszip
- `foliate-mobi.js` — `mobi.js` của foliate-js, commit `78914aef4466eb960965702401634c2cb348e9b1`
  (MIT, xem `FOLIATE-JS-LICENSE.txt`). https://github.com/johnfactotum/foliate-js
  Có một chỉnh sửa nhỏ (đánh dấu `LOCAL PATCH`): KF8 quay về parse HTML khi XHTML lỗi.
- `pdf.min.js`, `pdf.worker.min.js` — pdf.js (pdfjs-dist 3.11.174, Apache-2.0, xem `PDFJS-LICENSE.txt`). https://github.com/mozilla/pdf.js
  Chỉ nạp khi người dùng chọn tệp PDF. Dùng để trích văn bản, không render trang.
