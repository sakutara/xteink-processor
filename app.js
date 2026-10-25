import { convert } from './src/convert.js';
import { UserError } from './src/util.js';
import { decodeImage } from './src/image.js';
import { createEditor } from './src/editor.js';
import * as dev from './src/xteink.js';

const $ = id => document.getElementById(id);
const sections = ['drop', 'progress', 'done', 'error'];
let busy = false;
let currentUrl = null;
let lastBook = null, lastImage = null;

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
    lastBook = { blob: res.blob, name: res.filename };
    $('sendbook-msg').textContent = '';
    syncSend();
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
  lastImage = { blob: res.bmp.blob, name: res.bmp.filename };
  $('sendimg-msg').textContent = '';
  syncSend();
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
const TABS = { epub: ['tab-epub', 'panel-epub'], img: ['tab-img', 'panel-img']};
const TAB_ORDER = ['epub', 'img'];
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
  syncSend();
}
for (const [k, [tabId]] of Object.entries(TABS)) {
  $(tabId).addEventListener('click', () => selectTab(k));
  $(tabId).addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const i = TAB_ORDER.indexOf(k) + (e.key === 'ArrowRight' ? 1 : -1);
      selectTab(TAB_ORDER[(i + TAB_ORDER.length) % TAB_ORDER.length], true);
    }
  });
}


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

// --- Máy Xteink: kết nối, quản lý tệp, gửi tệp
const device = { host: null, cwd: '/', moving: null, uploadMode: false, busy: false };

// Ba trạng thái giao diện: off (ngắt kết nối), on (quản lý file), upload (công cụ sách/ảnh, chỉ có nút gửi)
function setMode() {
  const mode = !connected() ? 'off' : device.uploadMode ? 'upload' : 'on';
  document.body.dataset.mode = mode;
  $('devopen').hidden = mode !== 'off';
  $('devdisc').hidden = mode === 'off';
  $('devfiles').hidden = mode !== 'on';
  if (mode !== 'off') $('devconn').hidden = true;
  syncSend();
}
const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const devMsg = (t, err) => { const m = $('devmsg'); m.textContent = t || ''; m.classList.toggle('err', !!err); };
const devErr = t => { const e = $('deverr'); e.textContent = t || ''; e.hidden = !t; };
const connected = () => !!device.host;

// Nút "Gửi vào Xteink" + banner thư mục đích ở tab sách/ảnh
function syncSend() {
  const on = connected();
  $('sendbook').hidden = !(on && lastBook);
  $('sendimg').hidden = !(on && lastImage);
  if (on) {
    $('sendbook').textContent = `Gửi vào Xteink (${device.cwd})`;
    $('sendimg').textContent = `Gửi BMP vào Xteink (${device.cwd})`;
  }
  const banner = $('sendbanner');
  banner.hidden = !(on && device.uploadMode);
  if (!banner.hidden) $('sendbanner-text').textContent = `Xong sẽ gửi thẳng vào thư mục ${device.cwd} trên Xteink.`;
}

// Đóng cửa sổ upload, quay về quản lý file và làm mới danh sách
function leaveUpload() {
  device.uploadMode = false;
  lastBook = lastImage = null;
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
  $('sendbook-msg').textContent = '';
  $('sendimg-msg').textContent = '';
  show('drop');
  $('imgresult').hidden = true;
  $('imgpick').hidden = false;
  setMode();
  refresh();
}

// Gửi một Blob vào thư mục hiện hành; hỏi trước khi ghi đè tệp trùng tên.
async function sendToDevice(blob, name, msgEl, progEl) {
  const host = device.host, dir = device.cwd;
  const set = t => { msgEl.textContent = t; msgEl.classList.remove('err'); };
  const fail = t => { msgEl.textContent = t; msgEl.classList.add('err'); };
  try {
    const existing = await dev.list(host, dir);
    if (existing.some(f => f.name === name && !f.isDirectory)) {
      if (!confirm(`"${name}" đã có trong ${dir}. Ghi đè?`)) { set('Đã huỷ.'); return false; }
      await dev.remove(host, dev.joinPath(dir, name));
    }
    set('Đang gửi 0%…');
    await dev.upload(host, dir, blob, name, f => {
      const pct = Math.round(f * 100);
      set(`Đang gửi ${pct}%…`);
      if (progEl) { progEl.hidden = false; $('devprogfill').style.width = `${pct}%`; }
    });
    set(`Đã gửi ${name} vào ${dir}.`);
    return true;
  } catch (e) {
    fail(e instanceof dev.DeviceError ? e.message : 'Gửi tệp thất bại.');
    return false;
  } finally {
    if (progEl) progEl.hidden = true;
  }
}
$('sendbook').addEventListener('click', async () => {
  if (!lastBook) return;
  $('sendbook').disabled = true;
  const ok = await sendToDevice(lastBook.blob, lastBook.name, $('sendbook-msg'));
  $('sendbook').disabled = false;
  if (ok) leaveUpload();
});
$('sendimg').addEventListener('click', async () => {
  if (!lastImage) return;
  $('sendimg').disabled = true;
  const ok = await sendToDevice(lastImage.blob, lastImage.name, $('sendimg-msg'));
  $('sendimg').disabled = false;
  if (ok) leaveUpload();
});
$('sendbanner-back').addEventListener('click', leaveUpload);

function setConnected(host, info) {
  device.host = host;
  device.cwd = '/';
  device.moving = null;
  if (host) dev.saveHost(host);
  $('devhost').value = host || $('devhost').value;
  device.uploadMode = false;
  const st = $('devstatus');
  st.textContent = host ? `Đã kết nối${info?.device ? ' · ' + info.device : ''} · ${host}` : 'Chưa kết nối';
  st.classList.toggle('on', !!host);
  setMode();
  if (host) refresh();
}

async function connectTo(host) {
  host = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!host) { devMsg('Nhập IP của máy, hoặc bấm Quét mạng.', true); return; }
  devMsg(`Đang kết nối ${host}…`);
  const info = await dev.probe(host, 4000);
  if (info) { devMsg(''); setConnected(host, info); return; }
  devMsg(`Không thấy máy Xteink tại ${host}. Kiểm tra máy đã bật Wi-Fi truyền tệp và cùng mạng.`, true);
  $('devhttps').hidden = !dev.isSecurePage();
}
let scanCtl = null;
async function scanNetwork() {
  if (scanCtl) { scanCtl.abort(); return; }
  scanCtl = new AbortController();
  const btn = $('devscan');
  btn.textContent = 'Dừng quét';
  $('devhttps').hidden = !dev.isSecurePage();
  const prefix = (/^\d+\.\d+\.\d+/.exec($('devhost').value) || [])[0];
  let found = null;
  try {
    found = await dev.scan({ prefix, signal: scanCtl.signal, onProgress: (m, f) => devMsg(`${m} ${f ? Math.round(f * 100) + '%' : ''}`) });
  } finally {
    scanCtl = null;
    btn.textContent = 'Quét mạng';
  }
  if (found) { devMsg(''); setConnected(found.host, found.info); }
  else devMsg('Không tìm thấy máy Xteink. Nhập IP thủ công (xem trên màn hình máy khi bật truyền tệp).', true);
}
$('devconnect').addEventListener('click', () => connectTo($('devhost').value));
$('devhost').addEventListener('keydown', e => { if (e.key === 'Enter') connectTo($('devhost').value); });
$('devscan').addEventListener('click', scanNetwork);
$('devdisc').addEventListener('click', () => { setConnected(null); devMsg(''); });
$('devopen').addEventListener('click', () => { $('devconn').hidden = !$('devconn').hidden; if (!$('devconn').hidden) $('devhost').focus(); });
$('devconnclose').addEventListener('click', () => { $('devconn').hidden = true; });

function renderCrumbs() {
  const nav = $('devcrumbs');
  nav.textContent = '';
  const add = (label, path) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', () => { device.cwd = path; refresh(); });
    nav.append(b);
  };
  add('Xteink', '/');
  let acc = '';
  for (const part of device.cwd.split('/').filter(Boolean)) {
    const sep = document.createElement('span');
    sep.className = 'sep'; sep.textContent = '/';
    nav.append(sep);
    acc += '/' + part;
    add(part, acc);
  }
}

async function refresh() {
  if (!connected()) return;
  renderCrumbs();
  devErr('');
  $('devchoose-dir').textContent = device.cwd;
  $('devmove').hidden = !device.moving;
  if (device.moving) $('devmove-text').textContent = `Đang di chuyển "${device.moving.name}" — mở thư mục đích rồi bấm Dán vào đây.`;
  syncSend();
  const ul = $('devlist');
  ul.textContent = '';
  const loading = document.createElement('li');
  loading.className = 'empty'; loading.textContent = 'Đang tải…';
  ul.append(loading);
  let items;
  try {
    items = await dev.list(device.host, device.cwd);
  } catch (e) {
    ul.textContent = '';
    devErr(e.message);
    return;
  }
  ul.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty'; li.textContent = 'Thư mục trống';
    ul.append(li);
  }
  for (const it of items) {
    const path = dev.joinPath(device.cwd, it.name);
    const li = document.createElement('li');
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'fname-btn' + (it.isDirectory ? ' dir' : '');
    name.textContent = (it.isDirectory ? '📁 ' : '') + it.name;
    if (it.isDirectory) name.addEventListener('click', () => { device.cwd = path; refresh(); });
    li.append(name);
    if (!it.isDirectory) {
      const sz = document.createElement('span');
      sz.className = 'fsize'; sz.textContent = fmtSize(it.size);
      li.append(sz);
    }
    const acts = document.createElement('div');
    acts.className = 'acts';
    const act = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
      b.addEventListener('click', fn);
      acts.append(b);
    };
    act('Đổi tên', '', () => doOp(() => {
      const n = prompt('Tên mới:', it.name);
      return n && n !== it.name ? dev.rename(device.host, path, n) : null;
    }));
    if (!it.isDirectory) act('Di chuyển', '', () => { device.moving = { path, name: it.name }; refresh(); });
    act('Xoá', 'del', () => doOp(() => (confirm(`Xoá ${it.isDirectory ? 'thư mục' : 'tệp'} "${it.name}"?${it.isDirectory ? ' Mọi thứ bên trong sẽ mất.' : ''}`) ? dev.remove(device.host, path) : null)));
    li.append(acts);
    ul.append(li);
  }
}

async function doOp(fn) {
  devErr('');
  try {
    const p = fn();
    if (!p) return;
    await p;
  } catch (e) {
    devErr(e instanceof dev.DeviceError ? e.message : 'Thao tác thất bại.');
  }
  refresh();
}
$('devrefresh').addEventListener('click', refresh);
$('devmkdir').addEventListener('click', () => doOp(() => {
  const n = prompt('Tên thư mục mới:');
  return n ? dev.mkdir(device.host, device.cwd, n) : null;
}));
$('devpaste').addEventListener('click', () => doOp(() => {
  const m = device.moving;
  device.moving = null;
  return dev.move(device.host, m.path, device.cwd);
}));
$('devmovecancel').addEventListener('click', () => { device.moving = null; refresh(); });

// Upload: chọn sách / ảnh / tệp bất kỳ
$('devup').addEventListener('click', () => { $('devchoose').hidden = !$('devchoose').hidden; });
$('choosecancel').addEventListener('click', () => { $('devchoose').hidden = true; });
function goUpload(tab) {
  device.uploadMode = true;
  $('devchoose').hidden = true;
  setMode();
  selectTab(tab);
}
$('choosebook').addEventListener('click', () => goUpload('epub'));
$('chooseimg').addEventListener('click', () => goUpload('img'));
$('choosefile').addEventListener('click', () => $('rawfile').click());
$('rawfile').addEventListener('change', async () => {
  const files = [...$('rawfile').files];
  $('rawfile').value = '';
  $('devchoose').hidden = true;
  for (const f of files) {
    const ok = await sendToDevice(f, f.name, $('devmsg'), $('devprog'));
    if (!ok) break;
  }
  refresh();
});

function initDevice() {
  const saved = dev.savedHost();
  if (saved) $('devhost').value = saved;
  if (dev.isSecurePage()) $('devhttps').hidden = false;
  setMode();
  if (saved && !dev.isSecurePage()) dev.probe(saved, 2500).then(info => { if (info && !connected()) setConnected(saved, info); });
}

selectTab(location.hash === '#hinh' ? 'img' : store.get('xteink-tab'));
initDevice();
