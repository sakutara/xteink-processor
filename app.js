import { convert } from './src/convert.js';
import { UserError } from './src/util.js';
import { decodeImage } from './src/image.js';
import { createEditor } from './src/editor.js';
import * as dev from './src/xteink.js';

const $ = id => document.getElementById(id);
const sections = ['drop', 'progress', 'done', 'error'];
let busy = false;

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

function chipsFor(res) {
  const box = document.createElement('div');
  box.className = 'chips';
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
  return box;
}

// Tải nhiều tệp: kích hoạt lần lượt từng liên kết (trình duyệt có thể hỏi cho phép tải nhiều tệp)
async function downloadAll(items) {
  for (const it of items) {
    const a = document.createElement('a');
    a.href = it.url; a.download = it.name;
    document.body.append(a);
    a.click();
    a.remove();
    await new Promise(r => setTimeout(r, 400));
  }
}

function renderBooks() {
  const ul = $('booklist');
  ul.textContent = '';
  for (const b of books) {
    const li = document.createElement('li');
    const n = document.createElement('div');
    n.className = 'rname'; n.textContent = b.name;
    li.append(n);
    if (b.error) {
      const er = document.createElement('div');
      er.className = 'stage err'; er.textContent = `${b.src}: ${b.error}`;
      li.append(er);
    } else {
      li.append(chipsFor(b.res));
      const a = document.createElement('a');
      a.className = 'link'; a.href = b.url; a.download = b.name; a.textContent = 'Tải tệp này';
      li.append(a);
    }
    ul.append(li);
  }
  const ok = books.filter(b => !b.error);
  $('download').textContent = ok.length > 1 ? `Tải xuống tất cả (${ok.length} tệp)` : `Tải xuống ${ok[0]?.name || ''}`;
  $('sendbook').hidden = !ok.length;
  $('download').hidden = !ok.length;
}

let books = [];
const okBooks = () => books.filter(b => !b.error);

async function handleFiles(files) {
  files = [...(files || [])];
  if (!files.length || busy) return;
  busy = true;
  for (const b of books) if (b.url) URL.revokeObjectURL(b.url);
  books = [];
  show('progress');
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tag = files.length > 1 ? `[${i + 1}/${files.length}] ` : '';
      $('fname').textContent = tag + file.name;
      $('barfill').style.width = '2%';
      $('stage').textContent = 'Đang bắt đầu…';
      try {
        const res = await convert(file, (msg, frac) => {
          $('stage').textContent = msg;
          $('barfill').style.width = `${Math.round(Math.max(0.02, Math.min(1, frac)) * 100)}%`;
        }, { wordwise: +radioValue('wwlevel'), wordwiseLang: wwLang() });
        books.push({ blob: res.blob, name: res.filename, url: URL.createObjectURL(res.blob), res });
      } catch (e) {
        console.error(e);
        books.push({ name: file.name, src: file.name, error: e instanceof UserError ? e.message
          : 'Đã xảy ra lỗi khi xử lý tệp. Tệp có thể bị hỏng hoặc không đúng định dạng.' });
      }
    }
    if (!okBooks().length) {
      $('errmsg').textContent = books.map(b => `${b.src}: ${b.error}`).join('\n');
      show('error');
    } else {
      $('sendbook-msg').textContent = '';
      syncSend();
      renderBooks();
      show('done');
    }
  } finally {
    busy = false;
  }
}

// --- chọn / kéo thả
const drop = $('drop'), input = $('file');
$('pick').addEventListener('click', e => { e.stopPropagation(); input.click(); });
drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
input.addEventListener('change', () => { const f = [...input.files]; input.value = ''; handleFiles(f); });
$('download').addEventListener('click', () => downloadAll(okBooks()));
for (const ev of ['dragenter', 'dragover']) {
  window.addEventListener(ev, e => { e.preventDefault(); if (!busy) drop.classList.add('over'); });
}
for (const ev of ['dragleave', 'drop']) {
  window.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); });
}
window.addEventListener('drop', e => {
  // Chỉ nhận thả tệp ở tab ebook; tab hình dùng nút chọn
  handleFiles(e.dataTransfer?.files);
});
$('again').addEventListener('click', () => show('drop'));
$('retry').addEventListener('click', () => show('drop'));

// --- chuẩn bị hình: chọn -> chỉnh sửa/cắt -> xử lý
let imgBusy = false, imgResults = [], imgQueue = [];
function renderImages() {
  const ul = $('imglist');
  ul.textContent = '';
  for (const r of imgResults) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.className = 'preview'; img.src = r.bmpUrl; img.alt = 'Xem trước hình đã xử lý';
    li.append(img);
    const sum = document.createElement('div');
    sum.className = 'stage';
    sum.textContent = `${r.bmp.filename} · ${r.srcWidth}×${r.srcHeight} → ${r.width}×${r.height} · BMP 4-bit · ${formatSize(r.bmp.blob.size)}`;
    li.append(sum);
    for (const [url, name, label] of [[r.bmpUrl, r.bmp.filename, 'Tải BMP'], [r.pngUrl, r.png.filename, 'Tải PNG']]) {
      const a = document.createElement('a');
      a.className = 'link'; a.href = url; a.download = name; a.textContent = label + ' ';
      li.append(a);
    }
    ul.append(li);
  }
  const n = imgResults.length;
  $('imgdownload').textContent = n > 1 ? `Tải xuống tất cả BMP (${n} ảnh)` : 'Tải xuống BMP';
  $('imgdownloadpng').textContent = n > 1 ? 'Tải tất cả PNG xám 8-bit' : 'Tải PNG xám 8-bit';
  $('sendimg-msg').textContent = '';
  syncSend();
  $('imgresult').hidden = !n;
}
function clearImages() {
  for (const r of imgResults) { URL.revokeObjectURL(r.bmpUrl); URL.revokeObjectURL(r.pngUrl); }
  imgResults = [];
}
function showImageResult(res) {
  imgResults.push({ ...res, bmpUrl: URL.createObjectURL(res.bmp.blob), pngUrl: URL.createObjectURL(res.png.blob) });
  renderImages();
  nextImage();
}
function imageError(e) {
  console.error(e);
  $('imgresult').hidden = !imgResults.length;
  $('imgpick').hidden = false;
  $('imgerror').textContent = e instanceof UserError ? e.message : 'Đã xảy ra lỗi khi xử lý hình.';
  $('imgerror').hidden = false;
}
const editor = createEditor({
  onApply: res => showImageResult(res),
  onCancel: e => { if (e) imageError(e); nextImage(); },
});
// Mở lần lượt từng ảnh trong hàng đợi để chỉnh sửa; xong hết mới hiện lại nút chọn.
async function nextImage() {
  const q = $('imgqueue');
  while (imgQueue.length) {
    const file = imgQueue.shift();
    try {
      const bmp = await decodeImage(file);
      $('imgresult').hidden = true;
      $('imgpick').hidden = true;
      q.hidden = false;
      q.textContent = `Đang chỉnh: ${file.name}${imgQueue.length ? ` (còn ${imgQueue.length} ảnh sau)` : ''}`;
      editor.open(bmp, file.name);
      return;
    } catch (e) {
      imageError(e);
    }
  }
  q.hidden = true;
  $('imgpick').hidden = false;
  $('imgresult').hidden = !imgResults.length;
}
function handleImages(files) {
  files = [...(files || [])];
  if (!files.length || imgBusy) return;
  clearImages();
  renderImages();
  $('imgerror').hidden = true;
  imgQueue = files;
  nextImage();
}
$('imgpick').addEventListener('click', () => $('imgfile').click());
$('imgfile').addEventListener('change', () => { const f = [...$('imgfile').files]; $('imgfile').value = ''; handleImages(f); });
$('imgdownload').addEventListener('click', () => downloadAll(imgResults.map(r => ({ url: r.bmpUrl, name: r.bmp.filename }))));
$('imgdownloadpng').addEventListener('click', () => downloadAll(imgResults.map(r => ({ url: r.pngUrl, name: r.png.filename }))));
window.__xteinkImage = f => handleImages([f]);
window.__xteinkEditor = editor;

// Test hook: cho phép nạp tệp bằng script.
window.__xteinkConvert = f => handleFiles([f]);
window.__xteinkConvertRaw = convert;

// --- Tab công cụ
const TABS = { epub: ['tab-epub', 'panel-epub'], img: ['tab-img', 'panel-img'], cfg: ['tab-cfg', 'panel-cfg'] };
const TAB_ORDER = ['epub', 'img', 'cfg'];
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
  badge.textContent = location.protocol === 'http:' ? 'Bản HTTP: không dùng offline' : 'Trình duyệt không hỗ trợ offline';
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

// Nút "Upload lên XTEInk": nhỏ/xám khi chưa có IP trong cấu hình, nút chính khi đã có.
// Ở chế độ upload từ trình quản lý file, đích là thư mục đang mở; ngược lại là thư mục trong cấu hình.
const targetDir = kind => (device.uploadMode ? device.cwd : kind === 'book' ? dev.getConfig().bookDir : dev.getConfig().imageDir);
function syncSend() {
  const hasHost = !!dev.getConfig().host;
  document.body.classList.toggle('has-host', hasHost);
  for (const [id, kind, label] of [['sendbook', 'book', 'Upload lên XTEInk'], ['sendimg', 'image', 'Upload lên XTEInk']]) {
    const b = $(id);
    b.classList.toggle('muted', !hasHost);
    b.textContent = hasHost || device.uploadMode ? `${label} (${targetDir(kind)})` : label;
  }
  const banner = $('sendbanner');
  banner.hidden = !(connected() && device.uploadMode);
  if (!banner.hidden) $('sendbanner-text').textContent = `Xong sẽ gửi thẳng vào thư mục ${device.cwd} trên Xteink.`;
}

// Đóng cửa sổ upload, quay về quản lý file và làm mới danh sách
function leaveUpload() {
  device.uploadMode = false;
  for (const b of books) if (b.url) URL.revokeObjectURL(b.url);
  books = [];
  imgResults = [];
  $('sendbook-msg').textContent = '';
  $('sendimg-msg').textContent = '';
  show('drop');
  $('imgresult').hidden = true;
  $('imgpick').hidden = false;
  setMode();
  refresh();
}

// Gửi một Blob vào thư mục hiện hành; hỏi trước khi ghi đè tệp trùng tên.
async function sendToDevice(blob, name, msgEl, progEl, host = device.host, dir = device.cwd, mkdirs = false) {
  const set = t => { msgEl.textContent = t; msgEl.classList.remove('err'); };
  const fail = t => { msgEl.textContent = t; msgEl.classList.add('err'); };
  try {
    if (mkdirs) { set(`Đang chuẩn bị thư mục ${dir}…`); await dev.ensureDir(host, dir); }
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
    fail((e instanceof dev.DeviceError ? e.message : 'Gửi tệp thất bại.') + (mkdirs ? ' Bạn có thể bấm Tải xuống rồi chép vào máy qua thẻ nhớ hoặc cáp.' : ''));
    return false;
  } finally {
    if (progEl) progEl.hidden = true;
  }
}
// Gửi tất cả kết quả convert: tới thư mục trong cấu hình, hoặc thư mục đang mở khi từ trình quản lý file.
function wireSend(id, msgId, kind, getItems) {
  $(id).addEventListener('click', async () => {
    const items = getItems();
    if (!items.length) return;
    const msg = $(msgId);
    const uploadMode = device.uploadMode;
    const host = uploadMode ? device.host : dev.getConfig().host;
    if (!uploadMode && !host) { selectTab('cfg'); cfgMsg('Nhập IP / link của XTEInk để upload trực tiếp.', true); $('cfghost').focus(); return; }
    $(id).disabled = true;
    let okCount = 0;
    for (let i = 0; i < items.length; i++) {
      const tag = items.length > 1 ? `[${i + 1}/${items.length}] ` : '';
      const ok = uploadMode
        ? await sendToDevice(items[i].blob, items[i].name, msg)
        : await sendToDevice(items[i].blob, items[i].name, msg, null, host, targetDir(kind), true);
      if (ok) okCount++;
      else break;
      if (items.length > 1) msg.textContent = `${tag}Đã gửi ${items[i].name}${i + 1 < items.length ? '…' : ''}`;
    }
    if (items.length > 1 && okCount === items.length) { msg.textContent = `Đã gửi ${okCount} tệp.`; msg.classList.remove('err'); }
    $(id).disabled = false;
    if (uploadMode && okCount === items.length) leaveUpload();
  });
}
wireSend('sendbook', 'sendbook-msg', 'book', () => okBooks().map(b => ({ blob: b.blob, name: b.name })));
wireSend('sendimg', 'sendimg-msg', 'image', () => imgResults.map(r => ({ blob: r.bmp.blob, name: r.bmp.filename })));
$('sendbanner-back').addEventListener('click', leaveUpload);

function setConnected(host, info) {
  device.host = host;
  device.cwd = '/';
  device.moving = null;
  if (host) dev.saveHost(host);
  if (host) $('devhost').value = host;
  device.uploadMode = false;
  const st = $('devstatus');
  st.textContent = host ? `Đã kết nối${info?.device ? ' · ' + info.device : ''} · ${host}` : 'Chưa kết nối';
  st.classList.toggle('on', !!host);
  setMode();
  if (host) refresh();
}

async function connectTo(host) {
  host = dev.normalizeHost(host);
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
  const prefix = (/^\d+\.\d+\.\d+/.exec($('devhost').value) || [])[0];
  let found = null;
  try {
    found = await dev.scan({ prefix, signal: scanCtl.signal, onProgress: (m, f) => devMsg(`${m} ${f ? Math.round(f * 100) + '%' : ''}`) });
  } finally {
    scanCtl = null;
    btn.textContent = 'Quét mạng';
  }
  if (found) { devMsg(''); setConnected(found.host, found.info); }
  else {
    devMsg('Không tìm thấy máy Xteink. Nhập IP thủ công (xem trên màn hình máy khi bật truyền tệp).', true);
    $('devhttps').hidden = !dev.isSecurePage();
  }
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

// --- Trang cấu hình (dùng chung với cửa sổ kết nối)
const cfgMsg = (t, err) => { const m = $('cfgmsg'); m.textContent = t || ''; m.classList.toggle('err', !!err); };
function renderConfig() {
  const c = dev.getConfig();
  for (const [id, v] of [['cfghost', c.host], ['cfgbook', c.bookDir], ['cfgimg', c.imageDir], ['devhost', c.host]]) {
    if (document.activeElement !== $(id)) $(id).value = v;
  }
  syncSend();
}
window.addEventListener('xteink-config', renderConfig);
$('cfghost').addEventListener('input', () => dev.saveConfig({ host: $('cfghost').value }));
$('devhost').addEventListener('input', () => dev.saveConfig({ host: $('devhost').value }));
$('cfgbook').addEventListener('change', () => { dev.saveConfig({ bookDir: $('cfgbook').value }); $('cfgbook').value = dev.getConfig().bookDir; });
$('cfgimg').addEventListener('change', () => { dev.saveConfig({ imageDir: $('cfgimg').value }); $('cfgimg').value = dev.getConfig().imageDir; });
for (const id of ['cfghost', 'devhost']) $(id).addEventListener('blur', () => { $(id).value = dev.getConfig().host; });
$('cfgreset').addEventListener('click', () => {
  dev.saveConfig({ bookDir: dev.DEFAULT_CONFIG.bookDir, imageDir: dev.DEFAULT_CONFIG.imageDir });
  $('cfgbook').value = dev.getConfig().bookDir; $('cfgimg').value = dev.getConfig().imageDir;
});
$('cfgtest').addEventListener('click', async () => {
  const host = dev.getConfig().host;
  if (!host) { cfgMsg('Chưa nhập IP.', true); return; }
  cfgMsg(`Đang kết nối ${host}…`);
  const info = await dev.probe(host, 4000);
  if (info) cfgMsg(`Kết nối được${info.device ? ' · ' + info.device : ''}.`);
  else cfgMsg(`Không thấy máy Xteink tại ${host}. Kiểm tra máy đã bật Wi-Fi truyền tệp và cùng mạng.` + (dev.isSecurePage() ? ' Trang HTTPS có thể bị trình duyệt chặn khi gọi máy HTTP; thử bản HTTP trong cửa sổ Kết nối XTEink.' : ''), true);
});

function initDevice() {
  renderConfig();
  // Bản HTTP của trang: gọi được máy (HTTP) trên mọi trình duyệt, kể cả điện thoại; mang theo IP đang nhập.
  $('httplink').addEventListener('click', () => {
    const ip = $('devhost').value.trim();
    $('httplink').href = `http://${location.host}${location.pathname}${ip ? '#ip=' + encodeURIComponent(ip) : ''}`;
  });
  $('httplink').href = `http://${location.host}${location.pathname}`;
  setMode();
  // Máy hiện QR dạng https://xte.fiddle.vn/#ip=192.168.1.50: quét xong tự kết nối.
  const m = /[#&]ip=([^&]+)/.exec(location.hash);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    $('devopen').click();
    connectTo(decodeURIComponent(m[1]));
    return;
  }
}

selectTab(location.hash === '#hinh' ? 'img' : store.get('xteink-tab'));
initDevice();
