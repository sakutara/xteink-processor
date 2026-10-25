import { convert } from './src/convert.js';
import { UserError } from './src/util.js';
import { decodeImage } from './src/image.js';
import { createEditor } from './src/editor.js';

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

// --- Tuỳ chọn (nhớ lại giữa các lần mở)
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } },
};
const radios = name => [...document.querySelectorAll(`input[name="${name}"]`)];
const radioValue = name => (radios(name).find(r => r.checked) || {}).value;
function setRadio(name, value) {
  const r = radios(name).find(x => x.value === value);
  if (r) r.checked = true;
}
const wwLang = () => ($('wwlang').checked ? 'vi' : 'en');
const WW_HINTS = {
  0: 'Tắt: không thêm chú giải.',
  1: 'Ít: chỉ chú giải bộ từ khó nhất.',
  2: 'Vừa: thêm các từ ít khó hơn.',
  3: 'Nhiều: thêm cả từ dễ hơn nữa. Mỗi từ chỉ chú giải ở lần xuất hiện đầu trong mỗi chương.',
};
function syncWordwise() {
  const level = radioValue('wwlevel') || '0';
  $('wwhint').textContent = WW_HINTS[level];
  $('wwlang').disabled = level === '0';
  $('wwlangrow').classList.toggle('off', level === '0');
}
{
  const saved = store.get('xteink-wordwise');
  if (saved) setRadio('wwlevel', saved);
  for (const r of radios('wwlevel')) r.addEventListener('change', () => { store.set('xteink-wordwise', radioValue('wwlevel')); syncWordwise(); });
  const lang = $('wwlang');
  lang.checked = store.get('xteink-wordwise-lang') === 'vi';
  lang.addEventListener('change', () => store.set('xteink-wordwise-lang', wwLang()));
}
syncWordwise();

function renderSummary(res) {
  const box = $('summary');
  box.textContent = '';
  const chip = (text, warn) => {
    const c = document.createElement('span');
    c.className = warn ? 'chip warn' : 'chip';
    c.textContent = text;
    box.append(c);
  };
  chip(`${res.chapters} chương`);
  chip(formatSize(res.blob.size));
  if (res.hasCover) chip('Có ảnh bìa');
  const w = res.wordwise;
  if (w.level) chip(`Wordwise ${w.level}/3 · ${w.lang === 'vi' ? 'Tiếng Việt' : 'English'} · ${w.words} từ`);
  if (w.skipped) chip(w.skipped, true);
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
    }, { wordwise: +radioValue('wwlevel'), wordwiseLang: wwLang() });
    currentUrl = URL.createObjectURL(res.blob);
    const a = $('download');
    a.href = currentUrl;
    a.download = res.filename;
    a.textContent = `Tải xuống ${res.filename}`;
    renderSummary(res);
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

// --- chuẩn bị hình: chọn -> chỉnh sửa/cắt -> xử lý
let imgBusy = false, imgUrls = [];
function showImageResult(res) {
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
  $('imgpick').hidden = false;
}
function imageError(e) {
  console.error(e);
  $('imgresult').hidden = true;
  $('imgpick').hidden = false;
  $('imgerror').textContent = e instanceof UserError ? e.message : 'Đã xảy ra lỗi khi xử lý hình.';
  $('imgerror').hidden = false;
}
const editor = createEditor({
  onApply: res => showImageResult(res),
  onCancel: e => { if (e) imageError(e); else $('imgpick').hidden = false; },
});
async function handleImage(file) {
  if (!file || imgBusy) return;
  imgBusy = true;
  $('imgerror').hidden = true;
  try {
    const bmp = await decodeImage(file);
    $('imgresult').hidden = true;
    $('imgpick').hidden = true;
    editor.open(bmp, file.name);
  } catch (e) {
    imageError(e);
  } finally {
    imgBusy = false;
  }
}
$('imgpick').addEventListener('click', () => $('imgfile').click());
$('imgfile').addEventListener('change', () => { const f = $('imgfile').files[0]; $('imgfile').value = ''; handleImage(f); });
window.__xteinkImage = handleImage;
window.__xteinkEditor = editor;

// Test hook: cho phép nạp tệp bằng script.
window.__xteinkConvert = handleFile;
window.__xteinkConvertRaw = convert;

// --- Tab công cụ
const TABS = { epub: ['tab-epub', 'panel-epub'], img: ['tab-img', 'panel-img'] };
function selectTab(name, focus) {
  if (!TABS[name]) name = 'epub';
  for (const [k, [tabId, panelId]] of Object.entries(TABS)) {
    const on = k === name;
    const t = $(tabId);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
    $(panelId).hidden = !on;
    if (on && focus) t.focus();
  }
  store.set('xteink-tab', name);
}
for (const [k, [tabId]] of Object.entries(TABS)) {
  $(tabId).addEventListener('click', () => selectTab(k));
  $(tabId).addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      selectTab(k === 'epub' ? 'img' : 'epub', true);
    }
  });
}
selectTab(location.hash === '#hinh' ? 'img' : store.get('xteink-tab'));

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

// --- Tắt phóng to / thu nhỏ của trang (chụm hai ngón, ctrl/cmd + chuột, phím tắt)
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, e => e.preventDefault(), { passive: false });
}
document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', 'Add', 'Subtract'].includes(e.key)) e.preventDefault();
});
