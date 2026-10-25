import { convert } from './src/convert.js';
import { UserError } from './src/util.js';
import { prepareImage } from './src/image.js';

const $ = id => document.getElementById(id);
const sections = ['drop', 'progress', 'done', 'error'];
let busy = false;
let currentUrl = null;

function show(name) {
  for (const s of sections) $(s).hidden = s !== name;
}

function formatSize(n) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

async function handleFile(file) {
  if (!file || busy) return;
  busy = true;
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
  $('fname').textContent = file.name;
  $('barfill').style.width = '2%';
  $('stage').textContent = 'Đang bắt đầu…';
  show('progress');
  try {
    const res = await convert(file, (msg, frac) => {
      $('stage').textContent = msg;
      $('barfill').style.width = `${Math.round(Math.max(0.02, Math.min(1, frac)) * 100)}%`;
    });
    currentUrl = URL.createObjectURL(res.blob);
    const a = $('download');
    a.href = currentUrl;
    a.download = res.filename;
    a.textContent = `Tải xuống ${res.filename}`;
    $('summary').textContent =
      `${res.chapters} chương · ${formatSize(res.blob.size)}${res.hasCover ? ' · có ảnh bìa' : ''}`;
    show('done');
  } catch (e) {
    console.error(e);
    $('errmsg').textContent = e instanceof UserError
      ? e.message
      : 'Đã xảy ra lỗi khi xử lý tệp. Tệp có thể bị hỏng hoặc không đúng định dạng.';
    show('error');
  } finally {
    busy = false;
  }
}

// --- chọn / kéo thả
const drop = $('drop'), input = $('file');
$('pick').addEventListener('click', e => { e.stopPropagation(); input.click(); });
drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; handleFile(f); });
for (const ev of ['dragenter', 'dragover']) {
  window.addEventListener(ev, e => { e.preventDefault(); if (!busy) drop.classList.add('over'); });
}
for (const ev of ['dragleave', 'drop']) {
  window.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); });
}
window.addEventListener('drop', e => handleFile(e.dataTransfer?.files?.[0]));
$('again').addEventListener('click', () => show('drop'));
$('retry').addEventListener('click', () => show('drop'));

// --- chuẩn bị hình
let imgBusy = false, imgUrls = [];
async function handleImage(file) {
  if (!file || imgBusy) return;
  imgBusy = true;
  $('imgerror').hidden = true;
  $('imgpick').disabled = true;
  try {
    const res = await prepareImage(file, msg => { $('imgpick').textContent = msg; });
    for (const u of imgUrls) URL.revokeObjectURL(u);
    const bmpUrl = URL.createObjectURL(res.bmp.blob), pngUrl = URL.createObjectURL(res.png.blob);
    imgUrls = [bmpUrl, pngUrl];
    $('imgpreview').src = bmpUrl;
    const a = $('imgdownload');
    a.href = bmpUrl; a.download = res.bmp.filename;
    a.textContent = `Tải xuống ${res.bmp.filename}`;
    const p = $('imgdownloadpng');
    p.href = pngUrl; p.download = res.png.filename;
    p.textContent = `Tải PNG xám 8-bit (${res.png.filename})`;
    $('imgsummary').textContent =
      `${res.srcWidth}×${res.srcHeight} → ${res.width}×${res.height} · BMP 4-bit 4 mức xám · ${formatSize(res.bmp.blob.size)}`;
    $('imgresult').hidden = false;
  } catch (e) {
    console.error(e);
    $('imgresult').hidden = true;
    $('imgerror').textContent = e instanceof UserError ? e.message : 'Đã xảy ra lỗi khi xử lý hình.';
    $('imgerror').hidden = false;
  } finally {
    imgBusy = false;
    $('imgpick').disabled = false;
    $('imgpick').textContent = 'Chọn hình';
  }
}
$('imgpick').addEventListener('click', () => $('imgfile').click());
$('imgfile').addEventListener('change', () => { const f = $('imgfile').files[0]; $('imgfile').value = ''; handleImage(f); });
window.__xteinkImage = handleImage;

// Test hook: cho phép nạp tệp bằng script.
window.__xteinkConvert = handleFile;
window.__xteinkConvertRaw = convert;

// --- PWA / offline
const badge = $('offline');
async function checkOffline() {
  try {
    const hit = await caches.match('vendor/jszip.min.js');
    const done = !!hit && !!navigator.serviceWorker.controller;
    badge.textContent = done ? 'Sẵn sàng offline' : 'Đang chuẩn bị offline…';
    badge.classList.toggle('ready', done);
  } catch {
    badge.textContent = 'Offline không khả dụng';
  }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready)
    .then(() => { checkOffline(); setTimeout(checkOffline, 1500); });
  navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(checkOffline, 500));
  checkOffline();
} else {
  badge.textContent = 'Trình duyệt không hỗ trợ offline';
}
