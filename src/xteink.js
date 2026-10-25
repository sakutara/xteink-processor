// Client cho web server của CrossInk/CrossPoint chạy trên Xteink (cùng mạng Wi-Fi).
// API: GET /api/status, GET /api/files?path=, POST /upload?path= (multipart),
// POST /mkdir, /rename, /move, /delete (tham số dạng form). Server bật CORS.

const SAVED_KEY = 'xteink-device-host';
const COMMON_PREFIXES = ['192.168.1', '192.168.0', '192.168.88', '192.168.2', '10.0.0', '10.0.1', '172.20.10'];

export class DeviceError extends Error {}

export const isSecurePage = () => location.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export const joinPath = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;
export const parentPath = p => p.replace(/\/[^/]*$/, '') || '/';

function base(host) {
  return `http://${host}`;
}

async function timedFetch(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    // Chrome: yêu cầu từ trang HTTPS tới mạng cục bộ cần hỏi quyền (LNA); tên miền thường phải khai báo đích.
    const host = new URL(url).hostname;
    const named = !/^[\d.]+$/.test(host) && !host.endsWith('.local');
    return await fetch(url, { ...(named ? { targetAddressSpace: 'local' } : {}), ...opts, signal: opts.signal ? anySignal(opts.signal, ctl.signal) : ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

function anySignal(a, b) {
  const ctl = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) ctl.abort();
    else s.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return ctl.signal;
}

/** Kiểm tra một host có phải máy Xteink (trả về thông tin trạng thái, hoặc null). */
export async function probe(host, ms = 1500, signal) {
  try {
    const r = await timedFetch(`${base(host)}/api/status`, { signal }, ms);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.version && j.ip ? j : null;
  } catch {
    return null;
  }
}

export function savedHost() {
  try { return localStorage.getItem(SAVED_KEY) || ''; } catch { return ''; }
}
export function saveHost(host) {
  try { localStorage.setItem(SAVED_KEY, host); } catch { /* bỏ qua */ }
}

function prefixOf(host) {
  const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(host || '');
  return m ? m[1] : null;
}

/**
 * Quét mạng tìm Xteink: thử IP đã lưu, crosspoint.local, rồi quét /24 của các dải thường gặp.
 * @param {(msg:string, frac:number)=>void} onProgress
 * @returns {Promise<{host:string, info:object}|null>}
 */
export async function scan({ prefix, onProgress = () => {}, signal } = {}) {
  const tryOne = async (host, label) => {
    onProgress(label, 0);
    const info = await probe(host, 2500, signal);
    return info ? { host, info } : null;
  };
  const saved = savedHost();
  if (saved) { const r = await tryOne(saved, `Thử ${saved}…`); if (r) return r; }
  { const r = await tryOne('crosspoint.local', 'Thử crosspoint.local…'); if (r) return r; }

  const prefixes = [];
  const add = p => { if (p && !prefixes.includes(p)) prefixes.push(p); };
  add(prefix);
  add(prefixOf(saved));
  add(prefixOf(location.hostname));
  for (const p of COMMON_PREFIXES) add(p);

  const total = prefixes.length * 254;
  let done = 0, found = null;
  const queue = [];
  for (const p of prefixes) for (let i = 1; i < 255; i++) queue.push(`${p}.${i}`);
  const worker = async () => {
    while (!found && !signal?.aborted) {
      const host = queue.shift();
      if (!host) return;
      const info = await probe(host, 900, signal);
      done++;
      if (info && !found) found = { host, info };
      if (done % 8 === 0) onProgress(`Đang quét mạng ${host.replace(/\.\d+$/, '.x')}…`, done / total);
    }
  };
  await Promise.all(Array.from({ length: 48 }, worker));
  return found;
}

async function check(r) {
  if (r.ok) return r;
  let msg = '';
  try { msg = (await r.text()).trim(); } catch { /* bỏ qua */ }
  throw new DeviceError(msg || `Máy báo lỗi ${r.status}`);
}

const form = obj => new URLSearchParams(obj);

async function post(host, path, params) {
  let r;
  try {
    r = await timedFetch(`${base(host)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form(params),
    });
  } catch {
    throw new DeviceError('Không kết nối được với máy Xteink.');
  }
  await check(r);
}

export async function list(host, path) {
  let r;
  try {
    r = await timedFetch(`${base(host)}/api/files?path=${encodeURIComponent(path)}`, {}, 15000);
  } catch {
    throw new DeviceError('Không kết nối được với máy Xteink.');
  }
  await check(r);
  const items = await r.json();
  if (!Array.isArray(items)) throw new DeviceError('Không đọc được danh sách tệp.');
  return items.sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export const mkdir = (host, path, name) => post(host, '/mkdir', { path, name });
export const rename = (host, path, name) => post(host, '/rename', { path, name });
export const move = (host, path, dest) => post(host, '/move', { path, dest });
export const remove = (host, path) => post(host, '/delete', { path });

/** Tải tệp (Blob hoặc File) lên thư mục `dir`. Có tiến trình (0..1). */
export function upload(host, dir, blob, filename, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base(host)}/upload?path=${encodeURIComponent(dir)}`);
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new DeviceError((xhr.responseText || '').trim() || `Máy báo lỗi ${xhr.status}`)));
    xhr.onerror = () => reject(new DeviceError('Mất kết nối với máy Xteink khi gửi tệp.'));
    xhr.ontimeout = () => reject(new DeviceError('Gửi tệp quá lâu, đã dừng.'));
    const fd = new FormData();
    fd.append('file', blob, filename);
    xhr.send(fd);
  });
}
