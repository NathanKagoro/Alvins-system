/* ======================= state ======================= */
let DB = {}; TABLES.forEach(t => DB[t] = {});
let L = { lang: 'en', theme: 'auto', userName: '', syncUrl: '', cursor: 0, lastSync: 0, lastError: '', sheetUrl: '', notify: false, notified: {}, msg: {}, post: '' };
const ui = { view: 'home', period: 'month', costTab: 'purchases', salesTab: 'sales', custTab: 'customers', q: { sales: '', customers: '', suppliers: '' }, limit: 60, form: null, al: [],
  unlocked: false, hiddenAt: 0, after: null, prefill: null, msgPurpose: 'offer', msgChannel: 'wa', msgAudience: 'all', msgArea: '', postFiles: [], pendingLogo: null };
let C = {}, S = {};    // unit cost and stock per product, recomputed on every render
let syncing = false, syncTimer = 0, syncState = '';

const t = (k, ...a) => { let s = (I18N[L.lang] || I18N.en)[k]; if (s === undefined) s = I18N.en[k]; if (s === undefined) return k; return typeof s === 'function' ? s(...a) : s; };
const cal = () => CAL[L.lang] || CAL.en;

/* ======================= storage (IndexedDB, falls back to localStorage) ======================= */
const store = {
  db: null,
  open() { return new Promise(res => { try { const r = indexedDB.open(DEMO ? 'daftari-demo' : 'daftari', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => res(); r.onblocked = () => res(); } catch (e) { res(); } }); },
  get(k) { return new Promise(res => { if (!this.db) { try { res(JSON.parse(localStorage.getItem((DEMO ? 'dkd_' : 'dk_') + k))); } catch (e) { res(null); } return; } try { const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result === undefined ? null : q.result); q.onerror = () => res(null); } catch (e) { res(null); } }); },
  set(k, v) { return new Promise(res => { if (!this.db) { try { localStorage.setItem((DEMO ? 'dkd_' : 'dk_') + k, JSON.stringify(v)); } catch (e) {} res(); return; } try { const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res(); } catch (e) { res(); } }); }
};
const persist = tb => store.set('t_' + tb, DB[tb]);
const persistLocal = () => store.set('local', L);

/* ======================= helpers ======================= */
const n = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const money = v => 'TZS ' + Math.round(v).toLocaleString('en-US');
const short = v => { const a = Math.abs(v), s = v < 0 ? '−' : ''; if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M'; if (a >= 1e3) return s + Math.round(a / 1e3) + 'K'; return s + Math.round(a); };
const qn = v => (Math.round(n(v) * 100) / 100).toLocaleString('en-US');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = x => String(x).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const addDays = (s, k) => { const d = pd(s); d.setDate(d.getDate() + k); return iso(d); };
const pd = s => { const p = String(s).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
const nice = s => { if (!s) return ''; const d = pd(s); return d.getDate() + ' ' + cal().mon[d.getMonth()] + ' ' + d.getFullYear(); };
const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const daysAgo = d => d <= 0 ? t('today') : d === 1 ? t('yesterday') : t('days_ago', d);
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '');
const byName = (a, b) => String(a.name).localeCompare(String(b.name));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const chip = (cls, text) => `<span class="chip ${cls}">${esc(text)}</span>`;
const mlabel = m => m === 'Cash' ? t('m_cash') : m === 'Bank' ? t('m_bank') : (m || '');
const rlabel = r => { const i = REASONS.indexOf(r); return i >= 0 ? t('r_' + i) : (r || ''); };
function ago(ms) { if (!ms) return t('never'); const d = new Date(ms); const day = iso(d) === today() ? t('today') : nice(iso(d)); return day + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
/* Tanzanian mobile numbers typed any way (0712…, +255 712…, 712…) → 255712345678, or '' (from Kitabu's lib/auth/phone.ts). */
function phone255(p) { let d = String(p || '').replace(/[^\d+]/g, '').replace(/^\+/, ''); if (d.startsWith('255')) d = d.slice(3); else if (d.startsWith('0')) d = d.slice(1); return d.length === 9 && /^[67]/.test(d) ? '255' + d : ''; }
const waNumber = p => phone255(p) || String(p || '').replace(/\D/g, '');
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const waLink = (num, text) => 'https://wa.me/' + (num || '') + '?text=' + encodeURIComponent(text);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const smsLink = (nums, text) => nums.length > 1 ? (isIOS ? 'sms:/open?addresses=' + nums.map(x => '+' + x).join(',') + '&body=' : 'sms:' + nums.map(x => '+' + x).join(',') + '?body=') + encodeURIComponent(text) : 'sms:+' + nums[0] + (isIOS ? '&' : '?') + 'body=' + encodeURIComponent(text);
const fill = (tpl, vals) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => vals[k] != null ? vals[k] : m);
const firstName = s => String(s || '').trim().split(/\s+/)[0] || '';
const clip = async text => { try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; } };
function download(name, type, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); }

/* ======================= data access ======================= */
const rows = tb => Object.values(DB[tb]).filter(r => !r.deleted);
const get = (tb, id) => { const r = id ? DB[tb][id] : null; return r && !r.deleted ? r : null; };
function put(tb, rec) {
  let now = new Date().toISOString();
  if (!rec.id) rec.id = uid();
  const prev = DB[tb][rec.id];
  if (prev && prev.updatedAt >= now) now = new Date(Date.parse(prev.updatedAt) + 1).toISOString();
  if (tb !== 'meta' && !rec.createdAt) rec.createdAt = now;
  rec.updatedAt = now; rec._dirty = 1; delete rec.deleted;
  DB[tb][rec.id] = rec; persist(tb); queueSync(); return rec.id;
}
function remove(tb, id) {
  const prev = DB[tb][id]; if (!prev) return;
  let now = new Date().toISOString(); if (prev.updatedAt >= now) now = new Date(Date.parse(prev.updatedAt) + 1).toISOString();
  DB[tb][id] = { id, deleted: true, updatedAt: now, _dirty: 1 }; persist(tb); queueSync();
}
function touch(tb, pred) { let c = 0; Object.values(DB[tb]).forEach(r => { if (!r.deleted && pred(r)) { r._dirty = 1; c++; } }); if (c) { persist(tb); queueSync(); } }
const metaStr = (k, d) => { const r = get('meta', k); return r ? String(r.value == null ? '' : r.value) : d; };
const setMeta = (k, v) => put('meta', { id: k, value: String(v) });
function alloc() { try { const a = JSON.parse(metaStr('alloc', '')); if (Array.isArray(a) && a.length) return a; } catch (e) {} return DEFAULT_ALLOC.map(a => Object.assign({}, a)); }
const aname = a => a.name || (a.key ? t('al_' + a.key) : '');
const pname = id => { const p = get('products', id); return p ? p.name : ''; };
const cname = id => { const c = get('customers', id); return c ? c.name : ''; };
const sname = id => { const s = get('suppliers', id); return s ? s.name : ''; };
const unitOf = id => { const p = get('products', id); return p && p.unit ? p.unit : ''; };
const dirtyCount = () => TABLES.reduce((a, tb) => a + Object.values(DB[tb]).filter(r => r._dirty).length, 0);
const bizName = () => metaStr('business', '').trim() || String(BRAND.name || '');

/* ======================= maths ======================= */
function costMap() {
  const m = {}; rows('purchases').forEach(p => { const x = m[p.productId] || (m[p.productId] = { q: 0, c: 0 }); x.q += n(p.qty); x.c += n(p.qty) * n(p.cost) + n(p.transport); });
  const out = {}; rows('products').forEach(p => { const x = m[p.id]; out[p.id] = x && x.q > 0 ? x.c / x.q : n(p.cost); });
  Object.keys(m).forEach(id => { if (!(id in out) && m[id].q > 0) out[id] = m[id].c / m[id].q; });
  return out;
}
/* Stock: purchases add, sales and losses take away, a count sets it right (stored as the difference it made). */
function stockMap() {
  const m = {}, add = (id, q) => { if (id) m[id] = (m[id] || 0) + q; };
  rows('purchases').forEach(p => add(p.productId, n(p.qty)));
  rows('sales').forEach(s => add(s.productId, -n(s.qty)));
  rows('losses').forEach(l => add(l.productId, -n(l.qty)));
  rows('stock').forEach(c => add(c.productId, n(c.delta)));
  return m;
}
const tracked = () => rows('products').filter(p => p.trackStock && p.active !== false).sort(byName);
const stockQ = id => Math.round((S[id] || 0) * 100) / 100;
const stockLevel = p => { const q = stockQ(p.id); return q <= 0 ? 'bad' : q <= n(p.lowAt) ? 'warn' : 'good'; };
const stockChip = p => { const lv = stockLevel(p); return chip(lv, lv === 'bad' ? t('out_stock') : t('in_stock', qn(stockQ(p.id)), p.unit)); };
const lossValue = l => n(l.qty) * (C[l.productId] || 0) + n(l.extra);
const inR = (r, x) => (x.date || '') >= r[0] && (x.date || '') <= r[1];
function range(p) {
  const now = new Date(), td = iso(now);
  if (p === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(d), td, t('r_week', nice(iso(d)))]; }
  if (p === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), td, t('r_month', cal().monf[now.getMonth()] + ' ' + now.getFullYear())];
  if (p === 'lastmonth') { const a = new Date(now.getFullYear(), now.getMonth() - 1, 1), b = new Date(now.getFullYear(), now.getMonth(), 0); return [iso(a), iso(b), cal().monf[a.getMonth()] + ' ' + a.getFullYear()]; }
  if (p === 'year') return [now.getFullYear() + '-01-01', td, t('r_year', now.getFullYear())];
  return ['0000-01-01', '9999-12-31', t('r_all')];
}
function summary(r) {
  const s = { rev: 0, sold: 0, cogs: 0, lost: 0, count: 0, by: {} };
  rows('sales').forEach(x => { if (!inR(r, x)) return; const q = n(x.qty), rv = q * n(x.price), cg = q * (C[x.productId] || 0); s.rev += rv; s.sold += q; s.cogs += cg; s.count++; const b = s.by[x.productId] || (s.by[x.productId] = { q: 0, rev: 0, cogs: 0 }); b.q += q; b.rev += rv; b.cogs += cg; });
  rows('losses').forEach(x => { if (inR(r, x)) s.lost += lossValue(x); });
  s.profit = s.rev - s.cogs - s.lost; return s;
}
function customerStats() {
  const m = {}; rows('customers').forEach(c => m[c.id] = { orders: 0, spent: 0, owed: 0, dates: [] });
  rows('sales').forEach(s => { const x = m[s.customerId]; if (!x) return; x.orders++; x.spent += n(s.qty) * n(s.price); if (s.paid === false) x.owed += n(s.qty) * n(s.price); x.dates.push(s.date); });
  const td = today();
  Object.values(m).forEach(x => {
    const d = [...new Set(x.dates)].sort(); x.last = d[d.length - 1] || '';
    x.gap = d.length >= 2 ? daysBetween(d[0], d[d.length - 1]) / (d.length - 1) : null;
    x.since = x.last ? daysBetween(x.last, td) : null;
    x.freq = !d.length ? ['plain', 'f_none'] : x.gap === null ? ['plain', 'f_new'] : x.gap <= 10 ? ['good', 'f_weekly'] : x.gap <= 20 ? ['good', 'f_2weeks'] : x.gap <= 40 ? ['plain', 'f_monthly'] : ['plain', 'f_rare'];
    x.due = null; if (x.gap !== null && x.gap > 0) { if (x.since > x.gap * 1.3) x.due = ['bad', 'd_late']; else if (x.since >= x.gap * 0.85) x.due = ['warn', 'd_due']; }
  });
  return m;
}

/* ======================= orders and reminders ======================= */
const ostatus = o => o.status || 'open';
function dueAt(o) { const d = pd(o.due); const p = String(o.time || '08:00').split(':').map(Number); d.setHours(p[0] || 0, p[1] || 0, 0, 0); return d; }
function remindAt(o) { const r = o.remind === undefined || o.remind === '' ? -1 : n(o.remind); return r < 0 ? null : new Date(dueAt(o).getTime() - r * 60000); }
const openOrders = () => rows('orders').filter(o => ostatus(o) === 'open').sort((a, b) => dueAt(a) - dueAt(b));
const isLate = o => ostatus(o) === 'open' && (o.due < today() || (o.due === today() && !!o.time && dueAt(o) < new Date()));
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
function dueLabel(o) { const d = daysBetween(today(), o.due); return cap(d === 0 ? t('today') : d === 1 ? t('tomorrow') : d === -1 ? t('yesterday') : nice(o.due)) + (o.time ? ' ' + o.time : ''); }
function dueChip(o) { const s = ostatus(o); if (s !== 'open') return chip('plain', t(s === 'done' ? 'o_done' : 'o_cancelled')); if (isLate(o)) return chip('bad', t('o_late')); if (o.due === today()) return chip('warn', cap(t('today'))); if (o.due === addDays(today(), 1)) return chip('plain', cap(t('tomorrow'))); return ''; }
const orderLine = o => t('o_line', cname(o.customerId) || t('no_customer'), pname(o.productId) || t('no_product'), qn(o.qty), dueLabel(o));
async function notifyNow(title, body, tag) {
  toast(title + ': ' + body, 7000);
  if (!L.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) { await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }); return; } } catch (e) {}
  try { new Notification(title, { body, tag, icon: 'icons/icon-192.png' }); } catch (e) {}
}
function checkReminders() {
  const now = Date.now(); let changed = false;
  openOrders().forEach(o => { const r = remindAt(o); if (!r) return; const ms = r.getTime(); if (ms <= now && ms > now - 3 * 864e5 && L.notified[o.id] !== ms) { L.notified[o.id] = ms; changed = true; notifyNow(t('o_notify_title'), orderLine(o), 'order-' + o.id); } });
  if (changed) persistLocal();
  const due = openOrders().filter(o => o.due <= today()).length;
  try { if (navigator.setAppBadge) (due ? navigator.setAppBadge(due) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {}
}
/* A calendar entry rings even when the app is closed: Google Calendar link, or an .ics file with the alarm. */
const gstamp = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
const ustamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
function calText(o) { const c = get('customers', o.customerId); return { title: t('orders_title') + ': ' + (c ? c.name : t('no_customer')) + ', ' + (pname(o.productId) || '') + ' x ' + qn(o.qty), details: [c && c.phone ? c.phone : '', money(n(o.qty) * n(o.price)), o.notes || '', bizName()].filter(Boolean).join('\n') }; }
function googleCal(o) {
  const { title, details } = calText(o), a = dueAt(o), b = new Date(a.getTime() + 30 * 60000);
  const dates = o.time ? gstamp(a) + '/' + gstamp(b) : o.due.replace(/-/g, '') + '/' + addDays(o.due, 1).replace(/-/g, '');
  let tz = 'Africa/Dar_es_Salaam'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + dates + '&details=' + encodeURIComponent(details) + '&ctz=' + encodeURIComponent(tz);
}
function icsFile(o) {
  const { title, details } = calText(o), a = dueAt(o), b = new Date(a.getTime() + 30 * 60000), e = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const r = o.remind === undefined || o.remind === '' ? 60 : n(o.remind);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daftari//Orders//EN', 'BEGIN:VEVENT', 'UID:' + o.id + '@daftari', 'DTSTAMP:' + ustamp(new Date()),
    'DTSTART:' + ustamp(a), 'DTEND:' + ustamp(b), 'SUMMARY:' + e(title), 'DESCRIPTION:' + e(details),
    ...(r >= 0 ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + e(title), 'TRIGGER:-PT' + r + 'M', 'END:VALARM'] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

/* ======================= profit lock (PBKDF2 PIN, from Kitabu's lib/auth/pin.ts) ======================= */
const b64 = u => { let s = ''; u.forEach(x => { s += String.fromCharCode(x); }); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derive(pin, salt, it) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, key, 256)); }
async function hashPin(pin) { const salt = crypto.getRandomValues(new Uint8Array(16)); return { salt: b64(salt), hash: b64(await derive(pin, salt, 120000)), it: 120000 }; }
async function verifyPin(pin, st) { if (!st) return false; const h = b64(await derive(pin, unb64(st.salt), st.it || 120000)); if (h.length !== st.hash.length) return false; let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ st.hash.charCodeAt(i); return d === 0; }
const pinRec = () => { try { const p = JSON.parse(metaStr('pin', '') || 'null'); return p && p.hash ? p : null; } catch (e) { return null; } };
const locked = () => !!pinRec() && !ui.unlocked;
function needUnlock(after) { if (!locked()) { after(); return; } ui.after = after; openForm('unlock'); }
const lockPanel = id => `<section class="panel lockpanel" id="${id || 'lockPanel'}"><h3>${t('locked_title')}</h3><p class="hint">${t('locked_text')}</p><button class="btn primary" data-act="unlock">${t('unlock')}</button></section>`;

/* ======================= logo (from Kitabu's lib/logo.ts) ======================= */
async function shrinkLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad')); i.src = url; });
    for (const size of [192, 144, 112, 96]) {
      const k = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h);
      for (const q of [0.85, 0.7]) { const webp = cv.toDataURL('image/webp', q), data = webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/png'); if (data.length <= 40000) return data; }
    }
    throw new Error('big');
  } finally { URL.revokeObjectURL(url); }
}

/* ======================= sync with the Google Sheet ======================= */
function decorate(tb, r) {
  if (r.deleted) return { id: r.id, deleted: true, updatedAt: r.updatedAt };
  const o = Object.assign({}, r); delete o._dirty;
  if (tb === 'sales' || tb === 'orders') { o.productName = pname(r.productId); o.customerName = cname(r.customerId); o.total = n(r.qty) * n(r.price); }
  if (tb === 'purchases') { o.productName = pname(r.productId); o.total = n(r.qty) * n(r.cost) + n(r.transport); if (r.supplierId) o.supplier = sname(r.supplierId) || r.supplier || ''; }
  if (tb === 'losses') { o.productName = pname(r.productId); o.lossValue = Math.round(lossValue(r)); }
  if (tb === 'stock') o.productName = pname(r.productId);
  if (tb === 'products') o.supplierName = sname(r.supplierId);
  return o;
}
function applyRow(tb, r) {
  if (!r || !r.id) return false; const id = String(r.id), u = String(r.updatedAt || ''), loc = DB[tb][id];
  if (loc && (loc.updatedAt > u || (loc.updatedAt === u && (loc._dirty || !loc.deleted)))) return false;
  const o = Object.assign({}, r); DERIVED.forEach(k => delete o[k]); o.id = id; DB[tb][id] = o; return true;
}
const scriptOld = () => !!L.syncUrl && !!L.lastSync && !(L.serverTables || LEGACY).includes('orders');
function queueSync() { clearTimeout(syncTimer); if (L.linked && !DEMO) syncTimer = setTimeout(sync, 1500); renderChrome(); }
async function sync() {
  if (syncing || !L.syncUrl || DEMO) return false;
  if (!navigator.onLine) { L.lastError = 'net'; setSync('off'); return false; }
  syncing = true; setSync('busy');
  let ok = false, changedByPull = false;
  try {
    C = costMap();
    const changes = {}, sent = [];
    TABLES.forEach(tb => { const d = Object.values(DB[tb]).filter(r => r._dirty); if (d.length) { changes[tb] = d.map(r => decorate(tb, r)); d.forEach(r => sent.push([tb, r.id, r.updatedAt])); } });
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
    let out;
    try {
      let res;
      try { res = await fetch(L.syncUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ v: 2, since: L.cursor || 0, changes }), signal: ctl.signal, redirect: 'follow' }); } catch (e) { throw { net: true }; }
      try { out = await res.json(); } catch (e) { throw { message: 'badreply' }; }
    } finally { clearTimeout(timer); }
    if (!out || !out.ok) throw { message: (out && out.error) || 'Sync failed' };
    const known = Array.isArray(out.tables) ? out.tables : LEGACY, before = L.serverTables || LEGACY;
    const touched = new Set();
    // Only what the Sheet keeps counts as sent: an older script ignores the newer tables, so those stay waiting.
    sent.forEach(([tb, id, u]) => { if (!known.includes(tb)) return; const r = DB[tb][id]; if (r && r.updatedAt === u) { if (r.deleted) delete DB[tb][id]; else delete r._dirty; touched.add(tb); } });
    TABLES.forEach(tb => (out.rows && out.rows[tb] || []).forEach(r => { if (applyRow(tb, r)) { touched.add(tb); changedByPull = true; } }));
    (out.deleted || []).forEach(d => { const tb = d.t, loc = DB[tb] && DB[tb][d.id]; if (loc && String(d.updatedAt) >= loc.updatedAt) { delete DB[tb][d.id]; touched.add(tb); changedByPull = true; } });
    // The script was just updated: send every record once, so the new columns are filled in.
    if (known.some(tb => !before.includes(tb)) && L.lastSync) TABLES.forEach(tb => { Object.values(DB[tb]).forEach(r => { r._dirty = 1; }); touched.add(tb); });
    L.serverTables = known;
    touched.forEach(persist);
    L.cursor = out.now; L.lastSync = Date.now(); L.lastError = ''; L.linked = true; if (out.sheetUrl) L.sheetUrl = out.sheetUrl; persistLocal();
    ok = true;
  } catch (e) {
    L.lastError = e && e.net ? 'net' : String((e && e.message) || e); persistLocal();
  }
  syncing = false;
  setSync(ok ? 'ok' : L.lastError === 'net' ? 'off' : 'err');
  if (changedByPull) render();
  if (ok && TABLES.some(tb => (L.serverTables || LEGACY).includes(tb) && Object.values(DB[tb]).some(r => r._dirty))) queueSync();
  return ok;
}
function setSync(s) { syncState = s; renderChrome(); }
const validUrl = u => /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec(\?.*)?$/.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(u);
const errText = () => L.lastError === 'net' ? t('gate_fail') : L.lastError === 'badreply' ? t('sync_bad_reply') : t('sync_err') + ': ' + L.lastError;
function setLink(url) { if (url !== L.syncUrl) { L.syncUrl = url; L.cursor = 0; L.sheetUrl = ''; L.serverTables = null; TABLES.forEach(tb => { Object.values(DB[tb]).forEach(r => { r._dirty = 1; }); persist(tb); }); } L.lastError = ''; }
async function idle() { clearTimeout(syncTimer); for (let i = 0; i < 200 && syncing; i++) await new Promise(r => setTimeout(r, 250)); }

/* ======================= first-run gate: the app only opens after one successful sync ======================= */
let gateUrl = '';
const lock = on => { document.querySelectorAll('header.band, main, nav.nav').forEach(el => { el.inert = on; }); const g = $('#gate'); g.hidden = !on; if (!on) g.innerHTML = ''; };
const langSeg = () => `<div class="seg"><button type="button" data-act="lang" data-v="en" aria-pressed="${L.lang === 'en'}">English</button><button type="button" data-act="lang" data-v="sw" aria-pressed="${L.lang === 'sw'}">Kiswahili</button></div>`;

/* ----- install screen: shown first when the app is opened in a browser tab instead of from the home screen ----- */
const standalone = () => navigator.standalone === true || ['standalone', 'fullscreen', 'minimal-ui'].some(m => matchMedia('(display-mode: ' + m + ')').matches);
const SHARE = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M7 11H5v10h14V11h-2"/></svg>';
let installEvt = null, installed = false;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (ui.installOpen) showInstall(); else if (ui.view === 'more') render(); });
window.addEventListener('appinstalled', () => { installed = true; installEvt = null; if (ui.installOpen) showInstall(); });
function showInstall() {
  ui.installOpen = true; lock(true);
  const steps = isIOS ? [t('ios_1', SHARE), t('ios_2'), t('ios_3')] : [t('and_1'), t('and_2'), t('and_3')];
  $('#gate').innerHTML = `<div class="gatecard" id="installCard">${markHtml()}<h2 id="gateTitle">${t('inst_title')}</h2>` +
    (installed ? `<p>${t('inst_done')}</p>` : `<p>${t('inst_text')}</p>` +
      (installEvt ? `<button class="btn primary block" type="button" data-act="install" id="installBtn">${t('inst_btn')}</button>`
        : `<div class="howto"><b>${t(isIOS ? 'inst_ios' : 'inst_manual')}</b><ol class="steps">${steps.map(x => `<li>${x}</li>`).join('')}</ol><p class="hint">${t('inst_browser')}</p></div>`)) +
    `<button class="btn block" type="button" data-act="skip-install" id="skipInstall">${t(installed ? 'inst_continue' : 'inst_skip')}</button>${langSeg()}</div>`;
}
async function proceed() { ui.installOpen = false; if (L.linked || DEMO) { lock(false); renderAll(); sync(); } else { showGate(); if (DEFAULT_URL) await gateConnect(); } }

function showGate(msg) {
  const g = $('#gate'); if (!g.hidden && $('#g-url')) gateUrl = v('g-url');
  lock(true);
  g.innerHTML = `<div class="gatecard">${markHtml()}<h2 id="gateTitle">${t('gate_title')}</h2><p>${t(DEFAULT_URL ? 'gate_text_auto' : 'gate_text')}</p><form id="gateForm" novalidate>` +
    (DEFAULT_URL ? '' : inp('g-url', t('sync_link'), gateUrl || L.syncUrl, 'type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocomplete="off" spellcheck="false"')) +
    `<div class="msg" id="gmsg" role="alert">${esc(msg || '')}</div><button class="btn primary block" type="submit" id="gateBtn">${t(DEFAULT_URL ? 'gate_retry' : 'gate_connect')}</button></form>` +
    langSeg() + `</div>`;
  $('#gateForm').addEventListener('submit', e => { e.preventDefault(); gateConnect(); });
}
let gateBusy = false;
async function gateConnect() {
  if (gateBusy) return; const url = DEFAULT_URL || v('g-url').trim();
  if (!validUrl(url)) { $('#gmsg').textContent = t('sync_bad_url'); return; }
  gateBusy = true; gateUrl = url;
  const busy = () => { const b = $('#gateBtn'); if (b) { b.disabled = true; b.textContent = t('gate_busy'); } const m = $('#gmsg'); if (m) m.textContent = ''; };
  busy(); await idle(); setLink(url); await persistLocal(); busy();
  const ok = await sync(); gateBusy = false;
  if (ok) { await persistLocal(); lock(false); renderAll(); }
  else showGate(errText());
}

/* ======================= chrome: header + bottom nav ======================= */
const MARK = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" fill="#0F0E0E"/><rect x="112" y="88" width="288" height="336" rx="30" fill="#C8211E"/><rect x="112" y="88" width="52" height="336" rx="26" fill="#A91B18"/><path d="M318 88h50v124l-25-22-25 22z" fill="#F2B705"/><rect x="196" y="250" width="164" height="22" rx="11" fill="#fff"/><rect x="196" y="302" width="164" height="22" rx="11" fill="#fff"/><rect x="196" y="354" width="104" height="22" rx="11" fill="#fff"/></svg>';
const logoSrc = () => { const logo = metaStr('logo', ''); return logo.startsWith('data:image/') ? logo : (BRAND.logo || ''); };
const markHtml = () => { const src = logoSrc(); return src ? `<img class="mark logo" src="${esc(src)}" alt="">` : `<span class="mark">${MARK}</span>`; };
const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  sales: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  costs: '<svg viewBox="0 0 24 24"><path d="M3 4h2l2.5 11h10L20 7H6.5"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/></svg>',
  customers: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.7.8 2.7 2.5 3 5.2"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>'
};
const PARENT = { products: 'more', messages: 'more', post: 'more', report: 'more' };
function applyTheme() { const r = document.documentElement; if (L.theme === 'light' || L.theme === 'dark') r.dataset.theme = L.theme; else delete r.dataset.theme; }
function renderChrome() {
  const biz = bizName();
  let st = syncState;
  if (DEMO) st = 'demo'; else if (!L.syncUrl) st = 'none'; else if (!navigator.onLine) st = 'off'; else if (!st) st = L.lastError ? (L.lastError === 'net' ? 'off' : 'err') : 'ok';
  $('#band').innerHTML = `${markHtml()}<div class="brand"><h1>${esc(biz || 'Daftari')}</h1><p>${esc(biz ? 'Daftari, ' + t('app_sub') : t('app_sub'))}</p></div>` +
    `<button class="syncchip ${st}" data-act="form" data-f="sync" id="syncChip"><i></i><span>${t('sync_' + st)}</span></button>` +
    `<button class="guide" data-act="tour" id="guideBtn" aria-label="${t('tutorial')}" title="${t('tutorial')}">?</button>`;
  const cur = PARENT[ui.view] || ui.view;
  $('#nav').innerHTML = ['home', 'sales', 'costs', 'customers', 'more'].map(v => `<button data-act="nav" data-v="${v}"${cur === v ? ' aria-current="page"' : ''}>${ICON[v]}<span>${t('nav_' + v)}</span></button>`).join('');
  document.documentElement.lang = L.lang; applyTheme();
}

/* ======================= views ======================= */
const seg = (id, act, opts, cur) => `<div class="seg" id="${id}" role="group">${opts.map(o => `<button type="button" data-act="${act}" data-v="${o[0]}" aria-pressed="${cur === o[0]}">${esc(o[1])}</button>`).join('')}</div>`;
function vHome() {
  const r = range(ui.period), s = summary(r), lk = locked();
  const owed = rows('sales').filter(x => x.paid === false).sort(byDateDesc);
  const ow = owed.reduce((a, x) => a + n(x.qty) * n(x.price), 0);
  const fresh = !rows('sales').length && !rows('products').length && !rows('purchases').length;
  let h = '';
  if (DEMO) h += `<div class="demobox" id="demoBox"><span>${t('demo_note')}</span><button class="btn sm" data-act="demo-reset">${t('demo_reset')}</button></div>`;
  const waiting = dirtyCount();
  if (L.syncUrl && waiting && Date.now() - (L.lastSync || 0) > 48 * 3600e3) h += `<div class="warnbox" id="staleBox">${esc(t('stale', waiting, ago(L.lastSync)))}</div>`;
  if (fresh) h += `<section class="panel" id="startPanel"><h3>${t('start_title')}</h3><ol class="steps"><li>${t('start_1')}</li><li>${t('start_2')}</li><li>${t('start_3')}</li></ol><div class="actions"><button class="btn primary" data-act="new" data-f="product">${t('add_product')}</button><button class="btn" data-act="tour">${t('take_tour')}</button></div></section>`;
  h += `<div class="row"><div>${L.userName ? `<p class="hello" id="hello">${esc(t('hello', L.userName))}</p>` : ''}<h2>${t('home_title')}</h2><p class="sub">${esc(r[2])}</p></div><div class="actions">${pinRec() && !lk ? `<button class="btn sm" data-act="lock" id="lockBtn">${t('lock_now')}</button>` : ''}<button class="btn primary" data-act="new" data-f="sale">+ ${t('new_sale')}</button></div></div>`;
  h += `<div class="seg" id="periodSeg" role="group" aria-label="${t('period')}">${PERIODS.map(p => `<button type="button" data-act="period" data-p="${p}" aria-pressed="${ui.period === p}">${t('p_' + p)}</button>`).join('')}</div>`;
  h += `<div class="kpis">` +
    (lk ? `<button class="kpi hero lockkpi" data-act="unlock" id="profitKpi"><span class="l">${t('k_profit')}</span><span class="v">${t('locked_kpi')}</span><span class="s">${t('tap_unlock')}</span></button>`
      : `<div class="kpi hero" id="profitKpi"><span class="l">${t('k_profit')}</span><span class="v${s.profit < 0 ? ' neg' : ''}">${money(s.profit)}</span><span class="s">${s.sold ? t('per_item', money(s.profit / s.sold)) : t('no_sales_yet')}</span></div>`) +
    `<div class="kpi"><span class="l">${t('k_sales')}</span><span class="v">${money(s.rev)}</span><span class="s">${t('n_sales', s.count)}</span></div>` +
    `<div class="kpi"><span class="l">${t('k_units')}</span><span class="v">${qn(s.sold)}</span><span class="s">${s.sold ? t('avg_each', money(s.rev / s.sold)) : '—'}</span></div>` +
    `<div class="kpi"><span class="l">${t('k_owed')}</span><span class="v">${money(ow)}</span><span class="s">${owed.length ? t('n_unpaid', owed.length) : t('all_paid')}</span></div>` +
    `<button class="kpi" data-act="peopletab" data-v="customers" id="custKpi"><span class="l">${t('k_customers')}</span><span class="v">${rows('customers').length}</span><span class="s">${t('k_new', rows('customers').filter(c => inR(r, { date: String(c.createdAt || '').slice(0, 10) })).length)}</span></button>` +
    `<button class="kpi" data-act="peopletab" data-v="suppliers" id="supKpi"><span class="l">${t('k_suppliers')}</span><span class="v">${rows('suppliers').length}</span><span class="s">${t('k_used', new Set(rows('purchases').filter(x => x.supplierId && inR(r, x)).map(x => x.supplierId)).size)}</span></button></div>`;
  if (lk) h += lockPanel('ledgerPanel');
  else {
    const noCost = Object.keys(s.by).filter(id => !(C[id] > 0) && get('products', id)).map(pname);
    h += `<section class="panel" id="ledgerPanel"><h3>${t('ledger_title')}</h3><div class="ledger">` +
      `<div><span>${t('l_sales')}</span><span>${money(s.rev)}</span></div>` +
      `<div><span>${t('l_cogs', qn(s.sold))}</span><span class="minus">− ${money(s.cogs)}</span></div>` +
      `<div><span>${t('l_losses')}</span><span class="minus">− ${money(s.lost)}</span></div>` +
      `<div class="tot"><span>${t('l_profit')}</span><span>${money(s.profit)}</span></div></div>` +
      (noCost.length ? `<div class="warnbox">${esc(t('no_cost_warn', noCost.join(', ')))}</div>` : '') + `</section>`;
    const base = Math.max(0, s.profit);
    h += `<section class="panel" id="allocPanel"><div class="row"><h3>${t('alloc_title')}</h3><button class="btn sm" data-act="form" data-f="alloc">${t('change')}</button></div>` +
      (s.profit <= 0 ? `<p class="hint">${t('alloc_none')}</p>` : '') +
      `<div class="alloc">${alloc().map(a => `<div><div class="al-top"><span>${esc(aname(a))}<small>${qn(a.pct)}%</small></span><b class="num">${money(base * n(a.pct) / 100)}</b></div><div class="al-bar"><i style="width:${Math.max(0, Math.min(100, n(a.pct)))}%"></i></div></div>`).join('')}</div></section>`;
  }
  const up = openOrders().filter(o => o.due <= addDays(today(), 14));
  h += `<section class="panel" id="upPanel"><div class="row"><h3>${t('up_title')}</h3><button class="btn sm" data-act="orders">${t('up_all')}</button></div>` + (up.length ? `<div>${up.slice(0, 6).map(o => `<div class="li"><div><div class="who">${esc(cname(o.customerId) || t('no_customer'))}</div><div class="meta">${esc(dueLabel(o))}, ${esc(pname(o.productId))} ×&nbsp;${qn(o.qty)}</div></div><div class="right">${dueChip(o)}<button class="btn sm" data-act="edit" data-f="order" data-id="${o.id}">${t('edit')}</button></div></div>`).join('')}</div>` : `<p class="hint">${t('up_none')}</p>`) + `</section>`;
  const low = tracked().filter(p => stockLevel(p) !== 'good');
  if (low.length) h += `<div class="warnbox row" id="stockAlert"><span>${esc(t('stock_alert', low.map(p => p.name + ' (' + (stockLevel(p) === 'bad' ? t('out_stock') : qn(stockQ(p.id))) + ')').join(', ')))}</span><button class="btn sm" data-act="peopletab" data-v="stock">${t('stock_go')}</button></div>`;
  h += chartPanel(lk);
  const by = Object.keys(s.by).map(id => Object.assign({ id }, s.by[id])).sort((a, b) => b.rev - a.rev);
  if (by.length) h += `<section class="panel" id="prodPanel"><h3>${t('byprod_title')}</h3><div class="tw"><table><thead><tr><th>${t('th_product')}</th><th class="r">${t('th_qty')}</th><th class="r">${t('th_sales')}</th>${lk ? '' : `<th class="r">${t('th_profit')}</th>`}</tr></thead><tbody>${by.map(b => `<tr><td>${esc(pname(b.id) || t('no_product'))}</td><td class="r">${qn(b.q)}</td><td class="r">${money(b.rev)}</td>${lk ? '' : `<td class="r">${money(b.rev - b.cogs)}</td>`}</tr>`).join('')}</tbody></table></div></section>`;
  h += `<section class="panel" id="owedPanel"><h3>${t('owed_title')}</h3>` + (owed.length ? `<div>${owed.slice(0, 10).map(x =>
    `<div class="li"><div><div class="who">${esc(cname(x.customerId) || t('no_customer'))}</div><div class="meta">${nice(x.date)}, ${esc(pname(x.productId))} ×&nbsp;${qn(x.qty)}</div></div><div class="right"><b class="num">${money(n(x.qty) * n(x.price))}</b><button class="btn sm" data-act="paid" data-id="${x.id}">${t('mark_paid')}</button></div></div>`).join('')}</div>` : `<p class="hint">${t('owed_none')}</p>`) + `</section>`;
  const st = customerStats(), due = rows('customers').filter(c => st[c.id].due).sort((a, b) => st[b.id].since - st[a.id].since);
  h += `<section class="panel" id="duePanel"><h3>${t('due_title')}</h3><p class="hint">${t('due_hint')}</p>` + (due.length ? `<div>${due.slice(0, 10).map(c => { const x = st[c.id]; return `<div class="li"><div><div class="who">${esc(c.name)}</div><div class="meta">${t('due_meta', Math.round(x.gap), daysAgo(x.since))}</div></div><div class="right">${chip(x.due[0], t(x.due[1]))}${c.phone ? `<a class="btn sm" href="${esc(telHref(c.phone))}">${t('call')}</a>` : ''}</div></div>`; }).join('')}</div>` : `<p class="hint">${t('due_none')}</p>`) + `</section>`;
  return h;
}
function buckets(p) {
  const now = new Date(), out = [], k = cal();
  const day = (d, lab) => ({ from: iso(d), to: iso(d), lab, tip: nice(iso(d)) });
  if (p === 'week') { const m = new Date(now); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); for (let i = 0; i < 7; i++) { const d = new Date(m); d.setDate(m.getDate() + i); out.push(day(d, k.day[i])); } return { unit: 'u_day', b: out, every: 1 }; }
  if (p === 'month' || p === 'lastmonth') { const y = now.getFullYear(), mo = now.getMonth() - (p === 'month' ? 0 : 1), last = new Date(y, mo + 1, 0).getDate(); for (let i = 1; i <= last; i++) out.push(day(new Date(y, mo, i), String(i))); return { unit: 'u_day', b: out, every: 5 }; }
  const month = (y, m) => { const a = new Date(y, m, 1), z = new Date(y, m + 1, 0); return { from: iso(a), to: iso(z), lab: k.mon[a.getMonth()], tip: k.monf[a.getMonth()] + ' ' + a.getFullYear() }; };
  if (p === 'year') { for (let m = 0; m < 12; m++) out.push(month(now.getFullYear(), m)); return { unit: 'u_month', b: out, every: 1 }; }
  const dates = [...rows('sales'), ...rows('losses'), ...rows('purchases')].map(x => x.date).filter(Boolean).sort();
  const first = dates.length ? pd(dates[0]) : now;
  const months = Math.max(1, (now.getFullYear() - first.getFullYear()) * 12 + now.getMonth() - first.getMonth() + 1);
  if (months > 24) { for (let y = first.getFullYear(); y <= now.getFullYear(); y++) out.push({ from: y + '-01-01', to: y + '-12-31', lab: String(y), tip: String(y) }); return { unit: 'u_year', b: out, every: 1 }; }
  for (let i = 0; i < months; i++) { const b = month(first.getFullYear(), first.getMonth() + i); if (months > 12) b.lab += " '" + String(pd(b.from).getFullYear()).slice(2); out.push(b); }
  return { unit: 'u_month', b: out, every: months > 12 ? 3 : 1 };
}
const niceStep = x => { if (x <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
function chartPanel(hideProfit) {
  const { unit, b, every } = buckets(ui.period), td = today();
  const data = b.map(x => { const s = summary([x.from, x.to]); return Object.assign({ rev: s.rev, pro: hideProfit ? 0 : s.profit, future: x.from > td }, x); });
  const W = Math.max(280, Math.min(726, ($('#view').clientWidth || 360) - 66)), H = 220, Lf = 44, R = 6, T = 14, B = 26;
  let max = Math.max(1, ...data.map(m => Math.max(m.rev, m.pro))), min = Math.min(0, ...data.map(m => m.pro));
  const step = niceStep((max - min) / 4); max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  const y = v => T + (max - v) / (max - min) * (H - T - B);
  const cw = (W - Lf - R) / data.length, bw = Math.max(2, Math.min(26, cw * (hideProfit ? 0.6 : 0.38))), gap = cw > 12 ? 2 : 1, lab = W < 480 && every === 5 ? 10 : every;
  let g = '';
  for (let v = min; v <= max + 1e-6; v += step) g += `<line x1="${Lf}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${Lf - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${short(v)}</text>`;
  g += `<line x1="${Lf}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-width="1"/>`;
  data.forEach((m, i) => {
    const cx = Lf + cw * i + cw / 2, isNow = m.from <= td && td <= m.to, r1 = y(m.rev), p0 = y(Math.max(0, m.pro)), p1 = y(Math.min(0, m.pro));
    g += `<g><title>${esc(hideProfit ? m.tip + ': ' + money(m.rev) : t('chart_tip', m.tip, money(m.rev), money(m.pro)))}</title><rect x="${cx - cw / 2}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent"/>` +
      (hideProfit ? `<rect x="${cx - bw / 2}" y="${r1}" width="${bw}" height="${Math.max(0, y(0) - r1)}" rx="1.5" fill="var(--ink)"/>`
        : `<rect x="${cx - bw - gap / 2}" y="${r1}" width="${bw}" height="${Math.max(0, y(0) - r1)}" rx="1.5" fill="var(--ink)"/><rect x="${cx + gap / 2}" y="${p0}" width="${bw}" height="${Math.max(0, p1 - p0)}" rx="1.5" fill="var(--red)"/>`) + `</g>`;
    if (i % lab === 0 || isNow || (lab > 1 && i === data.length - 1 && (data.length - 1) % lab >= 3)) g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${m.future ? 'var(--line)' : 'var(--muted)'}" font-weight="${isNow ? 700 : 400}">${esc(m.lab)}</text>`;
  });
  const title = t('chart_title', t(unit));
  return `<section class="panel chart" id="chartPanel"><div class="row"><h3>${title}</h3><div class="legend"><span><i style="background:var(--ink)"></i>${t('lg_sales')}</span>${hideProfit ? '' : `<span><i style="background:var(--red)"></i>${t('lg_profit')}</span>`}</div></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" font-family="Barlow, system-ui, sans-serif">${g}</svg></section>`;
}

function listHead(title, f, addLabel, search) {
  return `<div class="row"><h2>${title}</h2><button class="btn primary" id="addBtn" data-act="new" data-f="${f}">+ ${addLabel}</button></div>` +
    (search ? `<input class="search" type="search" id="q" value="${esc(ui.q[search] || '')}" placeholder="${esc(t('search_' + search))}" aria-label="${esc(t('search_' + search))}" data-q="${search}">` : '');
}
const more = total => total > ui.limit ? `<button class="btn block" data-act="more">${t('show_more')}</button>` : '';
function saleCard(x) {
  const c = cname(x.customerId);
  return `<button class="card" data-act="edit" data-f="sale" data-id="${x.id}"><span class="c1"><b>${esc(pname(x.productId) || t('no_product'))} <span class="x">× ${qn(x.qty)}</span></b><b class="num">${money(n(x.qty) * n(x.price))}</b></span>` +
    `<span class="c2"><span>${nice(x.date)}, ${c ? esc(c) : `<em>${t('no_customer')}</em>`}, ${esc(mlabel(x.method))}</span>${x.paid === false ? chip('bad', t('unpaid')) : chip('good', t('paid'))}</span>` +
    (x.notes ? `<span class="c3">${esc(x.notes)}</span>` : '') + `<span class="edit">${t('edit')} ›</span></button>`;
}
function listSales() {
  const q = ui.q.sales.trim().toLowerCase();
  let l = rows('sales').sort(byDateDesc);
  if (q) l = l.filter(x => (pname(x.productId) + ' ' + cname(x.customerId) + ' ' + (x.notes || '') + ' ' + mlabel(x.method)).toLowerCase().includes(q));
  if (!l.length) return `<div class="empty">${q ? t('no_match') : t('sales_empty')}</div>`;
  return l.slice(0, ui.limit).map(saleCard).join('') + more(l.length);
}
function orderCard(o) {
  const c = get('customers', o.customerId), tel = c ? phone255(c.phone) : '', open = ostatus(o) === 'open';
  const msg = fill(t('o_msg_tpl'), { name: firstName(c ? c.name : ''), product: pname(o.productId), qty: qn(o.qty), when: dueLabel(o), shop: bizName() || 'Daftari' });
  return `<div class="cardwrap"><button class="card" data-act="edit" data-f="order" data-id="${o.id}"><span class="c1"><b>${esc(c ? c.name : t('no_customer'))}</b><b class="num">${money(n(o.qty) * n(o.price))}</b></span>` +
    `<span class="c2"><span>${esc(dueLabel(o))}, ${esc(pname(o.productId) || t('no_product'))} ×&nbsp;${qn(o.qty)}</span>${dueChip(o)}</span>${o.notes ? `<span class="c3">${esc(o.notes)}</span>` : ''}<span class="edit">${t('edit')} ›</span></button>` +
    (open ? `<div class="acts"><button class="btn sm good" data-act="deliver" data-id="${o.id}">${t('o_deliver')}</button><button class="btn sm" data-act="cal" data-id="${o.id}">${t('o_calendar')}</button>${tel ? `<a class="btn sm" href="${esc(waLink(tel, msg))}" target="_blank" rel="noopener">${t('whatsapp')}</a>` : ''}</div>` : '') + `</div>`;
}
function vSales() {
  const isO = ui.salesTab === 'orders', open = openOrders();
  let h = listHead(isO ? t('orders_title') : t('sales_title'), isO ? 'order' : 'sale', isO ? t('new_order') : t('new_sale'), isO ? '' : 'sales');
  h += seg('salesSeg', 'salestab', [['sales', t('tab_sales')], ['orders', t('tab_orders') + (open.length ? ' (' + open.length + ')' : '')]], ui.salesTab);
  if (!isO) return h + `<div class="list" id="list">${listSales()}</div>`;
  const past = rows('orders').filter(o => ostatus(o) !== 'open').sort((a, b) => dueAt(b) - dueAt(a)).slice(0, 20);
  return h + `<div class="list" id="list">${open.length ? open.map(orderCard).join('') : `<div class="empty">${t('orders_empty')}</div>`}</div>` + (past.length ? `<h3>${t('orders_past')}</h3><div class="list">${past.map(orderCard).join('')}</div>` : '');
}
function vCosts() {
  if (locked()) return `<h2>${t('costs_title')}</h2>` + lockPanel('costLock');
  const p = ui.costTab === 'purchases';
  let h = listHead(t('costs_title'), p ? 'purchase' : 'loss', p ? t('new_purchase') : t('new_loss')) +
    `<div class="seg" id="costSeg" role="group"><button type="button" data-act="costtab" data-v="purchases" aria-pressed="${p}">${t('tab_purchases')}</button><button type="button" data-act="costtab" data-v="losses" aria-pressed="${!p}">${t('tab_losses')}</button></div><div class="list" id="list">`;
  if (p) {
    const l = rows('purchases').sort(byDateDesc);
    h += l.length ? l.slice(0, ui.limit).map(x => { const q = n(x.qty), tot = q * n(x.cost) + n(x.transport), sup = sname(x.supplierId) || x.supplier; return `<button class="card" data-act="edit" data-f="purchase" data-id="${x.id}"><span class="c1"><b>${esc(pname(x.productId) || t('no_product'))} <span class="x">× ${qn(q)}</span></b><b class="num">${money(tot)}</b></span><span class="c2"><span>${nice(x.date)}${sup ? ', ' + esc(sup) : ''}</span></span><span class="c3">${esc(t('p_meta', money(n(x.cost)), money(n(x.transport)), q ? money(tot / q) : '—'))}</span>${x.notes ? `<span class="c3">${esc(x.notes)}</span>` : ''}<span class="edit">${t('edit')} ›</span></button>`; }).join('') + more(l.length) : `<div class="empty">${t('purchases_empty')}</div>`;
  } else {
    const l = rows('losses').sort(byDateDesc);
    h += l.length ? l.slice(0, ui.limit).map(x => `<button class="card" data-act="edit" data-f="loss" data-id="${x.id}"><span class="c1"><b>${esc(rlabel(x.reason))}</b><b class="num">${money(lossValue(x))}</b></span><span class="c2"><span>${nice(x.date)}${n(x.qty) ? ', ' + esc(pname(x.productId) || t('no_product')) + ' × ' + qn(x.qty) : ''}${n(x.extra) ? ', ' + esc(t('other_money', money(n(x.extra)))) : ''}</span></span>${x.notes ? `<span class="c3">${esc(x.notes)}</span>` : ''}<span class="edit">${t('edit')} ›</span></button>`).join('') + more(l.length) : `<div class="empty">${t('losses_empty')}</div>`;
  }
  return h + `</div>`;
}
const contactActs = p => p ? `<div class="acts"><a class="btn sm" href="${esc(telHref(p))}">${t('call')}</a><a class="btn sm" href="https://wa.me/${esc(waNumber(p))}" target="_blank" rel="noopener">${t('whatsapp')}</a></div>` : '';
function listCustomers() {
  const st = customerStats(), q = ui.q.customers.trim().toLowerCase();
  let l = rows('customers').sort((a, b) => st[b.id].spent - st[a.id].spent || byName(a, b));
  if (q) l = l.filter(c => ((c.name || '') + ' ' + (c.phone || '') + ' ' + (c.area || '')).toLowerCase().includes(q));
  if (!l.length) return `<div class="empty">${q ? t('no_match') : t('customers_empty')}</div>`;
  return l.slice(0, ui.limit).map(c => {
    const x = st[c.id];
    return `<div class="cardwrap"><button class="card" data-act="edit" data-f="customer" data-id="${c.id}"><span class="c1"><b>${esc(c.name)}</b><span>${chip(x.freq[0], t(x.freq[1]))}${x.due ? ' ' + chip(x.due[0], t(x.due[1])) : ''}</span></span>` +
      `<span class="c2"><span>${esc([c.area, c.phone].filter(Boolean).join(', ') || '—')}</span></span><span class="c3">${esc(t('c_meta', x.orders, money(x.spent)))}${x.last ? ', ' + esc(t('c_last', daysAgo(x.since))) : ''}</span>${c.notes ? `<span class="c3">${esc(c.notes)}</span>` : ''}<span class="edit">${t('edit')} ›</span></button>` + contactActs(c.phone) + `</div>`;
  }).join('') + more(l.length);
}
/* A supplier's products: the ones set to come from them, and anything bought from them. */
function supplierProducts(sid) { const ids = new Set(rows('products').filter(p => p.supplierId === sid).map(p => p.id)); rows('purchases').forEach(p => { if (p.supplierId === sid && p.productId) ids.add(p.productId); }); return [...ids].map(id => get('products', id)).filter(Boolean).sort(byName); }
function listSuppliers() {
  const q = ui.q.suppliers.trim().toLowerCase(), lk = locked(), st = {};
  rows('purchases').forEach(p => { if (!p.supplierId) return; const x = st[p.supplierId] || (st[p.supplierId] = { c: 0, v: 0, last: '' }); x.c++; x.v += n(p.qty) * n(p.cost) + n(p.transport); if ((p.date || '') > x.last) x.last = p.date; });
  let l = rows('suppliers').sort(byName);
  if (q) l = l.filter(s => ((s.name || '') + ' ' + (s.phone || '') + ' ' + (s.area || '') + ' ' + (s.notes || '')).toLowerCase().includes(q));
  if (!l.length) return `<div class="empty">${q ? t('no_match') : t('suppliers_empty')}</div>`;
  return l.map(s => { const x = st[s.id] || { c: 0, v: 0, last: '' }, prods = supplierProducts(s.id); return `<div class="cardwrap"><button class="card" data-act="edit" data-f="supplier" data-id="${s.id}"><span class="c1"><b>${esc(s.name)}</b></span><span class="c2"><span>${esc([s.area, s.phone].filter(Boolean).join(', ') || '—')}</span></span>${prods.length ? `<span class="c3">${esc(t('supplies_list', prods.map(p => p.name).join(', ')))}</span>` : ''}${s.notes ? `<span class="c3">${esc(s.notes)}</span>` : ''}<span class="c3">${esc(t('s_meta', x.c, lk || !x.c ? '' : money(x.v)))}${x.last ? ', ' + esc(t('s_last', nice(x.last))) : ''}</span><span class="edit">${t('edit')} ›</span></button>` + contactActs(s.phone) + `</div>`; }).join('');
}
function listStock() {
  const prods = rows('products').filter(p => p.active !== false).sort(byName), lastC = {};
  if (!prods.length) return `<div class="empty">${t('stock_none')}</div>`;
  rows('stock').forEach(c => { if (!lastC[c.productId] || (c.date || '') > lastC[c.productId]) lastC[c.productId] = c.date; });
  const on = prods.filter(p => p.trackStock), off = prods.filter(p => !p.trackStock);
  const recent = rows('stock').sort(byDateDesc).slice(0, 10);
  return on.map(p => `<div class="cardwrap"><button class="card" data-act="edit" data-f="product" data-id="${p.id}"><span class="c1"><b>${esc(p.name)}</b>${stockChip(p)}</span><span class="c2"><span>${lastC[p.id] ? esc(t('last_count', nice(lastC[p.id]))) : ''}${p.supplierId && sname(p.supplierId) ? (lastC[p.id] ? ', ' : '') + esc(t('from_sup', sname(p.supplierId))) : ''}</span></span><span class="edit">${t('edit')} ›</span></button><div class="acts"><button class="btn sm" data-act="new" data-f="count" data-pid="${p.id}">${t('stock_count')}</button></div></div>`).join('') +
    off.map(p => `<div class="cardwrap"><div class="card"><span class="c1"><b>${esc(p.name)}</b>${chip('plain', t('stock_untracked'))}</span></div><div class="acts"><button class="btn sm" data-act="new" data-f="count" data-pid="${p.id}">${t('keep_count')}</button></div></div>`).join('') +
    (recent.length ? `<h3>${t('counts_recent')}</h3>` + recent.map(c => `<button class="card" data-act="edit" data-f="count" data-id="${c.id}"><span class="c1"><b>${esc(pname(c.productId) || t('no_product'))}</b><span class="num">${qn(c.counted)}${unitOf(c.productId) ? ' ' + esc(unitOf(c.productId)) : ''}</span></span><span class="c2"><span>${nice(c.date)}, ${esc(t('count_diff', Math.round(n(c.delta) * 100) / 100))}</span></span>${c.notes ? `<span class="c3">${esc(c.notes)}</span>` : ''}</button>`).join('') : '');
}
function vCustomers() {
  const tab = ['customers', 'suppliers', 'stock'].includes(ui.custTab) ? ui.custTab : 'customers', sup = tab === 'suppliers', stock = tab === 'stock';
  let h = stock ? `<div class="row"><h2>${t('stock_title')}</h2><button class="btn primary" id="addBtn" data-act="new" data-f="count">+ ${t('stock_count')}</button></div>`
    : listHead(sup ? t('suppliers_title') : t('customers_title'), sup ? 'supplier' : 'customer', sup ? t('new_supplier') : t('new_customer'), sup ? 'suppliers' : 'customers');
  h += seg('custSeg', 'custtab', [['customers', t('n_customers', rows('customers').length)], ['suppliers', t('n_suppliers', rows('suppliers').length)], ['stock', t('tab_stock')]], tab);
  if (tab === 'customers') h += `<button class="btn block" data-act="nav" data-v="messages" id="msgBtn">${t('msg_menu')}</button>`;
  if (stock) h += `<p class="hint">${t('stock_hint')}</p>`;
  return h + `<div class="list" id="list">${stock ? listStock() : sup ? listSuppliers() : listCustomers()}</div>`;
}
function vProducts() {
  const l = rows('products').sort((a, b) => (b.active !== false) - (a.active !== false) || byName(a, b)), lk = locked();
  return `<div><button class="btn sm" data-act="nav" data-v="more">‹ ${t('back')}</button></div>` + listHead(t('products_title'), 'product', t('new_product')) + `<div class="list" id="list">` +
    (l.length ? l.map(p => { const c = C[p.id] || 0; return `<div class="cardwrap"><button class="card" data-act="edit" data-f="product" data-id="${p.id}"><span class="c1"><b>${esc(p.name)}</b><b class="num">${money(n(p.price))}</b></span><span class="c2"><span>${p.unit ? esc(t('per') + ' ' + p.unit) : ''}</span><span>${p.trackStock ? stockChip(p) : ''}${p.active === false ? ' ' + chip('plain', t('hidden')) : ''}</span></span>${p.supplierId && sname(p.supplierId) ? `<span class="c3">${esc(t('from_sup', sname(p.supplierId)))}</span>` : ''}${p.description ? `<span class="c3">${esc(p.description)}</span>` : ''}${lk ? '' : `<span class="c3">${c > 0 ? esc(t('pr_meta', money(c), money(n(p.price) - c))) : t('pr_nocost')}</span>`}<span class="edit">${t('edit')} ›</span></button>` +
      (p.trackStock ? `<div class="acts"><button class="btn sm" data-act="new" data-f="count" data-pid="${p.id}">${t('stock_count')}</button></div>` : '') + `</div>`; }).join('') : `<div class="empty">${t('products_empty')}</div>`) + `</div>`;
}

/* ----- message many customers (from Kitabu's wateja/ofa: one tap per customer, with consent for offers) ----- */
function msgState() { const k = ui.msgPurpose; if (!L.msg[k]) L.msg[k] = { text: '', sent: [] }; const m = L.msg[k]; if (!m.text) m.text = t(k === 'offer' ? 'msg_tpl_offer' : 'msg_tpl_owed'); return m; }
function msgRecipients() {
  const st = customerStats(), td = today(), seen = new Set(), out = [];
  rows('customers').sort(byName).forEach(c => {
    const num = phone255(c.phone); if (!num || seen.has(num)) return; const x = st[c.id];
    if (ui.msgPurpose === 'owed') { if (!(x.owed > 0)) return; }
    else {
      if (!c.offersOk) return;
      if (ui.msgAudience === 'recent' && !(x.last && daysBetween(x.last, td) <= 30)) return;
      if (ui.msgAudience === 'away' && !(x.last && daysBetween(x.last, td) > 30)) return;
      if (ui.msgArea && String(c.area || '').trim().toLowerCase() !== ui.msgArea) return;
    }
    seen.add(num); out.push({ c, num, owed: x.owed });
  });
  return out;
}
const generic = m => fill(m.text, { name: '', jina: '', shop: bizName() || 'Daftari', duka: bizName() || 'Daftari', amount: '', kiasi: '' }).replace(/\s+([!,.?])/g, '$1').replace(/ {2,}/g, ' ').trim();
const personal = (m, r) => fill(m.text, { name: firstName(r ? r.c.name : ''), jina: firstName(r ? r.c.name : ''), shop: bizName() || 'Daftari', duka: bizName() || 'Daftari', amount: money(r ? r.owed : 0), kiasi: money(r ? r.owed : 0) });
function msgList() {
  const m = msgState(), list = msgRecipients(), done = list.filter(r => m.sent.includes(r.num)).length;
  if (!list.length) return `<div class="empty">${t(ui.msgPurpose === 'owed' ? 'msg_none_owed' : 'msg_none_offer')}</div>`;
  const sms = ui.msgChannel === 'sms';
  return `<div class="row"><b id="msgProgress">${t('msg_progress', done, list.length)}</b>${m.sent.length ? `<button class="btn sm" data-act="msg-restart">${t('msg_restart')}</button>` : ''}</div>` +
    `<div class="menu" id="msgList">${list.map(r => { const sent = m.sent.includes(r.num), text = personal(m, r); return `<a class="mrow${sent ? ' sent' : ''}" data-act="msent" data-num="${r.num}" href="${esc(sms ? smsLink([r.num], text) : waLink(r.num, text))}" target="_blank" rel="noopener"><span><span class="mt">${esc(r.c.name)}</span><br><span class="ms">${esc([r.c.area, r.c.phone].filter(Boolean).join(', '))}${ui.msgPurpose === 'owed' ? ', ' + money(r.owed) : ''}</span></span>${sent ? chip('good', t('msg_sent')) : `<span class="btn sm primary">${t('msg_send')}</span>`}</a>`; }).join('')}</div>` +
    (sms && list.length > 1 && ui.msgPurpose === 'offer' ? `<a class="btn block" id="smsAll" href="${esc(smsLink(list.map(r => r.num), generic(m)))}">${t('msg_all_sms')}</a><p class="hint">${t('msg_all_sms_hint')}</p>` : '');
}
function vMessages() {
  const m = msgState(), offer = ui.msgPurpose === 'offer', list = msgRecipients();
  const areas = [...new Set(rows('customers').map(c => String(c.area || '').trim()).filter(Boolean).map(a => a.toLowerCase()))].sort();
  const noConsent = rows('customers').filter(c => phone255(c.phone) && !c.offersOk).length;
  let h = `<div><button class="btn sm" data-act="nav" data-v="customers">‹ ${t('back')}</button></div><h2>${t('msg_title')}</h2>`;
  h += seg('msgPurpose', 'msgpurpose', [['offer', t('msg_offer')], ['owed', t('msg_owed')]], ui.msgPurpose);
  if (offer) {
    h += seg('msgAud', 'msgaud', [['all', t('aud_all')], ['recent', t('aud_recent')], ['away', t('aud_away')]], ui.msgAudience);
    if (areas.length) h += sel('m-area', t('location'), [['', t('loc_all')]].concat(areas.map(a => [a, a.replace(/\b\w/g, x => x.toUpperCase())])), ui.msgArea);
    if (noConsent) h += `<div class="warnbox row" id="consentBox"><span>${t('msg_noconsent', noConsent)}</span><button class="btn sm" data-act="form" data-f="consent">${t('msg_tick')}</button></div>`;
  }
  h += seg('msgChannel', 'msgchannel', [['wa', t('msg_wa')], ['sms', t('msg_sms')]], ui.msgChannel);
  h += `<div class="f"><label for="m-text">${t('msg_label')}</label><textarea id="m-text" rows="4">${esc(m.text)}</textarea><p class="hint">${t('msg_hint')}</p></div>`;
  h += `<div class="preview" id="msgPreview">${list[0] ? `<b>${esc(t('msg_preview', list[0].c.name))}</b><br>${esc(personal(m, list[0]))}` : esc(personal(m, null))}</div>`;
  h += `<p class="hint">${t(ui.msgChannel === 'sms' ? 'msg_how_sms' : 'msg_how_wa')}</p><div id="msgBody">${msgList()}</div>`;
  if (offer && ui.msgChannel === 'wa') h += `<div class="menu"><button data-act="msg-share"><span class="mt">${t('msg_share')}</span><span class="go">›</span></button><button data-act="vcf"><span><span class="mt">${t('msg_vcf')}</span><br><span class="ms">${t('msg_vcf_hint')}</span></span><span class="go">›</span></button></div>`;
  return h;
}
function refreshMsg() { const m = msgState(), list = msgRecipients(), pv = $('#msgPreview'); if (pv) pv.innerHTML = list[0] ? `<b>${esc(t('msg_preview', list[0].c.name))}</b><br>${esc(personal(m, list[0]))}` : esc(personal(m, null)); const b = $('#msgBody'); if (b) b.innerHTML = msgList(); }
const vcEsc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/* ----- one post for WhatsApp and Instagram ----- */
function vPost() {
  const prods = rows('products').filter(p => p.active !== false).sort(byName);
  return `<div><button class="btn sm" data-act="nav" data-v="more">‹ ${t('back')}</button></div><h2>${t('post_title')}</h2><p class="hint">${t('post_hint')}</p>` +
    `<label class="btn block filebtn" for="postFiles">${t('post_pick')}</label><input type="file" id="postFiles" accept="image/*,video/*" multiple hidden>` +
    `<div class="thumbs" id="thumbs">${thumbs()}</div>` +
    `<div class="f"><label for="postCaption">${t('post_caption')}</label><textarea id="postCaption" rows="5" placeholder="${esc(t('post_caption_ph'))}">${esc(L.post || '')}</textarea></div>` +
    (prods.length ? sel('postProduct', t('post_add'), [['', '—']].concat(prods.map(p => [p.id, p.name + ': ' + money(n(p.price)) + (p.unit ? ' / ' + p.unit : '')])), '') : '') +
    `<div class="msg" id="postMsg" role="status"></div><div class="actions"><button class="btn primary" data-act="post-share" id="postShare">${t('post_share')}</button><button class="btn" data-act="post-copy">${t('post_copy')}</button><a class="btn" id="postWa" href="${esc(waLink('', L.post || ''))}" target="_blank" rel="noopener">${t('post_wa_text')}</a></div>` +
    `<div class="howto"><b>${t('post_steps_h')}</b><ol class="steps"><li>${t('post_s1')}</li><li>${t('post_s2')}</li></ol></div>`;
}
let thumbUrls = [];
function thumbs() { thumbUrls.forEach(u => URL.revokeObjectURL(u)); thumbUrls = ui.postFiles.map(f => URL.createObjectURL(f)); return ui.postFiles.length ? ui.postFiles.map((f, i) => f.type.startsWith('video') ? `<span class="thumb vid">${esc(f.name)}</span>` : `<img class="thumb" src="${thumbUrls[i]}" alt="">`).join('') + `<span class="hint">${t('post_n', ui.postFiles.length)}</span>` : ''; }

function vMore() {
  const d = dirtyCount(), biz = bizName(), pin = !!pinRec();
  const syncSub = DEMO ? t('sync_demo') : !L.syncUrl ? t('sync_menu_none') : d ? t('sync_menu_wait', d) : t('sync_menu_ok', ago(L.lastSync));
  const row = (act, f, title, sub, id) => `<button data-act="${act}"${f ? ` data-f="${f}"` : ''}${id ? ` id="${id}"` : ''}><span><span class="mt">${title}</span>${sub ? `<br><span class="ms">${esc(sub)}</span>` : ''}</span><span class="go">›</span></button>`;
  return `<h2>${t('more_title')}</h2>` +
    `<div class="menu" id="menuMain">${row('report', '', t('rep_menu'), t('rep_menu_sub'), 'repMenu')}${row('nav', '', t('products'), t('n_products', rows('products').length)).replace('data-act="nav"', 'data-act="nav" data-v="products"')}` +
    row('nav', '', t('msg_menu'), t('msg_menu_sub')).replace('data-act="nav"', 'data-act="nav" data-v="messages"') +
    row('nav', '', t('post_menu'), t('post_menu_sub')).replace('data-act="nav"', 'data-act="nav" data-v="post"') +
    row('form', 'alloc', t('alloc_menu'), locked() ? t('locked_kpi') : alloc().map(a => aname(a) + ' ' + qn(a.pct) + '%').join(', ')) + `</div>` +
    `<div class="menu" id="menuShop">${row('form', 'business', t('biz_title'), t('biz_sub', biz, !!metaStr('logo', '')))}${row('form', 'username', t('your_name'), L.userName || t('not_set'))}` +
    row('form', 'pin', t('pin_title'), pin ? t('pin_on') : t('pin_offs'), 'menuPin') + row('form', 'notify', t('notify_menu'), L.notify && 'Notification' in window && Notification.permission === 'granted' ? t('notify_on_sub') : t('notify_off_sub')) +
    `<div class="mi"><span class="mt">${t('look')}</span>${seg('themeSeg', 'theme', [['auto', t('look_auto')], ['light', t('look_light')], ['dark', t('look_dark')]], L.theme || 'auto')}</div>` +
    `<div class="mi"><span class="mt">${t('language')}</span><span class="seg" id="langSeg"><button type="button" data-act="lang" data-v="en" aria-pressed="${L.lang === 'en'}">English</button><button type="button" data-act="lang" data-v="sw" aria-pressed="${L.lang === 'sw'}">Kiswahili</button></span></div></div>` +
    (scriptOld() ? `<div class="warnbox" id="scriptOld">${t('script_old')}</div>` : '') +
    `<div class="menu" id="menuSync">${row('form', 'sync', t('sync_menu'), syncSub)}${row('backup', '', t('backup'), t('backup_sub'))}${row('restore', '', t('restore'), t('restore_sub'))}</div>` +
    `<div class="menu">${standalone() ? '' : row('open-install', '', t('inst_menu'), t('inst_menu_sub'), 'menuInstall')}<button data-act="tour"><span class="mt">${t('tutorial')}</span><span class="go">›</span></button></div>` +
    `<p class="foot">Daftari, ${t('version')} ${VERSION}</p><input type="file" id="restoreFile" accept="application/json,.json" hidden>`;
}
const VIEWS = { report: vReport, home: vHome, sales: vSales, costs: vCosts, customers: vCustomers, more: vMore, products: vProducts, messages: vMessages, post: vPost };
function render() {
  C = costMap(); S = stockMap();
  const a = document.activeElement, refocus = a && a.id === 'q';
  $('#view').innerHTML = (VIEWS[ui.view] || vHome)();
  if (refocus) { const el = $('#q'); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} } }
  if (tour.open) tour.place();
}
function renderAll() { renderChrome(); render(); }
function go(v) { ui.view = v; ui.limit = 60; renderAll(); window.scrollTo(0, 0); }


/* ======================= monthly report ======================= */
function monthRange(key) { const [y, m] = key.split('-').map(Number), a = new Date(y, m - 1, 1), b = new Date(y, m, 0); return [iso(a), iso(b) < today() ? iso(b) : today(), cal().monf[m - 1] + ' ' + y, iso(b)]; }
function reportMonths() {
  const ks = new Set([today().slice(0, 7)]); ['sales', 'purchases'].forEach(tb => rows(tb).forEach(x => { if (x.date) ks.add(x.date.slice(0, 7)); }));
  return [...ks].sort().reverse().slice(0, 24);
}
function vReport() {
  const months = reportMonths(); if (!ui.repMonth || !months.includes(ui.repMonth)) ui.repMonth = months[months.length > 1 && today().slice(8) < '08' ? 1 : 0];
  const notes = (L.repNotes || {})[ui.repMonth] || '';
  return `<div class="noprint report-ctl"><button class="btn link" data-act="nav" data-v="more">‹ ${t('more_title')}</button><h2>${t('rep_menu')}</h2>` +
    `<div class="f2">${sel('r-month', t('rep_month'), months.map(k => [k, monthRange(k)[2]]), ui.repMonth)}${inp('r-for', t('rep_for'), L.repFor || '', `placeholder="${esc(t('rep_for_ph'))}"`)}</div>` +
    area('r-notes', t('rep_notes'), notes, t('rep_notes_ph')) +
    `<div class="actions"><button class="btn primary" data-act="rep-pdf" id="repPdf">${t('rep_pdf')}</button><button class="btn" data-act="rep-print" id="repPrint">${t('rep_print')}</button><button class="btn" data-act="rep-share">${t('rep_share')}</button></div><p class="hint">${t('rep_hint')}</p></div>` +
    `<article class="report" id="report">${reportHtml(ui.repMonth, L.repFor || '', notes)}</article>`;
}
function reportData(key) {
  const r = monthRange(key), s = summary(r), sales = rows('sales').filter(x => inR(r, x)), buys = rows('purchases').filter(x => inR(r, x));
  const prod = {}, cust = {}, sup = {};
  sales.forEach(x => { const v = n(x.qty) * n(x.price), p = prod[x.productId] || (prod[x.productId] = { q: 0, v: 0, paid: 0, owed: 0 }); p.q += n(x.qty); p.v += v; x.paid === false ? p.owed += v : p.paid += v;
    const c = cust[x.customerId || ''] || (cust[x.customerId || ''] = { v: 0, owed: 0, n: 0 }); c.v += v; c.n++; if (x.paid === false) c.owed += v; });
  buys.forEach(x => { const k = x.supplierId || (x.supplier ? 'name:' + x.supplier : ''), o = sup[k] || (sup[k] = { name: x.supplierId ? sname(x.supplierId) || x.supplier : x.supplier || '', q: 0, cost: 0, tr: 0, n: 0, prods: new Set() });
    o.q += n(x.qty); o.cost += n(x.qty) * n(x.cost); o.tr += n(x.transport); o.n++; if (x.productId) o.prods.add(pname(x.productId)); });
  const cash = Object.values(prod).reduce((a, p) => a + p.paid, 0), owed = Object.values(prod).reduce((a, p) => a + p.owed, 0);
  const weeks = []; for (let d = r[0]; d <= r[3]; d = addDays(d, 7)) { const e = addDays(d, 6) > r[3] ? r[3] : addDays(d, 6); const w = summary([d, e]); weeks.push({ a: pd(d).getDate(), b: pd(e).getDate(), rev: w.rev, profit: w.profit, future: d > today() }); }
  const newC = rows('customers').filter(c => String(c.createdAt || '').slice(0, 10) >= r[0] && String(c.createdAt || '').slice(0, 10) <= r[3]).length;
  return { r, s, prod, cust, sup, cash, owed, weeks, newC, nOwed: Object.entries(cust).filter(([k, c]) => c.owed > 0).length };
}
function weekChart(weeks) {
  const W = 640, H = 220, L0 = 64, B = 30, T = 14, R = 34, pts = weeks.filter(w => !w.future), top = Math.max(1, ...pts.map(w => Math.max(w.rev, w.profit)));
  const raw = top / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), stp = [1, 2, 2.5, 5, 10].find(k => k * mag >= raw) * mag, max = Math.ceil(top / stp) * stp;
  const ticks = []; for (let v = 0; v <= max + stp / 2; v += stp) ticks.push(v);
  const x = i => L0 + (weeks.length < 2 ? 0 : i * (W - L0 - R) / (weeks.length - 1)), y = v => T + (H - T - B) * (1 - Math.max(0, v) / max);
  const line = (k, c) => `<polyline fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" points="${pts.map((w, i) => x(i) + ',' + y(w[k])).join(' ')}"/>` + pts.map((w, i) => `<circle cx="${x(i)}" cy="${y(w[k])}" r="4" fill="${c}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('rep_s4'))}">` + ticks.map(v => `<line x1="${L0}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#E2DEDB"/><text x="${L0 - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#6D6764">${v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : v}</text>`).join('') +
    weeks.map((w, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#6D6764">${t('rep_week', w.a, w.b)}</text>`).join('') + line('rev', '#161413') + line('profit', '#C8211E') + `</svg>` +
    `<div class="legend"><span><i style="background:#161413"></i>${t('th_sales')}</span><span><i style="background:#C8211E"></i>${t('rep_k_profit')}</span></div>`;
}
function reportHtml(key, forWho, notes) {
  const D = reportData(key), { r, s } = D, biz = bizName() || 'Daftari', logo = logoSrc();
  const tbl = (head, body, foot) => `<table><tr>${head.map((h, i) => `<th${i ? ' class="r"' : ''}>${h}</th>`).join('')}</tr>${body.map(rw => `<tr>${rw.map((c, i) => `<td${i ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('')}${foot ? `<tr class="tot">${foot.map((c, i) => `<td${i ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>` : ''}</table>`;
  const m = x => Math.round(n(x)).toLocaleString('en-US');
  const prods = Object.entries(D.prod).sort((a, b) => b[1].v - a[1].v), best = prods[0];
  let h = `<header class="rep-head">${logo ? `<img src="${esc(logo)}" alt="">` : `<span class="mark">${MARK}</span>`}<div><h1>${esc(biz)}</h1><p>${esc(t('rep_title'))} · ${esc(r[2])}${forWho ? ' · ' + esc(t('rep_for')) + ': ' + esc(forWho) : ''}</p></div></header>`;
  h += `<div class="rep-kpis"><div><span>${t('rep_k_sales')}</span><b>${money(s.rev)}</b></div><div><span>${t('rep_k_cash')}</span><b>${money(D.cash)}</b></div><div class="hero"><span>${t('rep_k_profit')}</span><b>${money(s.profit)}</b></div><div><span>${t('rep_k_owed')}</span><b>${money(D.owed)}</b></div></div>`;
  h += `<section><h3>${t('rep_s1')}</h3>` + (s.count ? `<p>${esc(t('rep_para', r[2], qn(s.sold), s.count, money(s.rev), money(D.cash), money(D.owed), D.nOwed))} ${best ? esc(t('rep_best', pname(best[0]) || '—', money(best[1].v))) : ''}</p>` +
    tbl([t('th_product'), t('th_qty'), t('th_avg'), t('th_sales'), t('th_paid'), t('th_unpaid')], prods.map(([id, p]) => [esc(pname(id) || '—'), qn(p.q), m(p.q ? p.v / p.q : 0), m(p.v), m(p.paid), p.owed ? m(p.owed) : '—']),
      [t('total'), qn(s.sold), '—', m(s.rev), m(D.cash), D.owed ? m(D.owed) : '—']) : `<p>${t('rep_none')}</p>`) + `</section>`;
  const sups = Object.values(D.sup).sort((a, b) => (b.cost + b.tr) - (a.cost + a.tr)), tq = sups.reduce((a, o) => a + o.q, 0), tc = sups.reduce((a, o) => a + o.cost, 0), tt = sups.reduce((a, o) => a + o.tr, 0);
  h += `<section><h3>${t('rep_s2')}</h3>` + (sups.length ? tbl([t('th_supplier'), t('th_qty'), t('th_cost'), t('th_transport'), t('th_total')], sups.map(o => [`<b>${esc(o.name || t('rep_no_sup'))}</b><br><small>${esc([...o.prods].join(', '))} · ${esc(t('rep_buys', o.n))}</small>`, qn(o.q), m(o.cost), m(o.tr), m(o.cost + o.tr)]), [t('total'), qn(tq), m(tc), m(tt), m(tc + tt)]) : `<p>${t('rep_none')}</p>`) + `</section>`;
  h += `<section class="rep-pl"><h3>${t('rep_s3')}</h3><div class="ledger"><div><span>${t('pl_sales')}</span><span>${m(s.rev)}</span></div><div><span>${t('pl_cogs')}</span><span class="minus">(${m(s.cogs)})</span></div><div class="sub"><span>${t('pl_gross')}</span><span>${m(s.rev - s.cogs)}</span></div><div><span>${t('pl_loss')}</span><span class="minus">(${m(s.lost)})</span></div><div class="tot"><span>${t('pl_net')}</span><span>${money(s.profit)}</span></div></div><p class="note">${t('pl_note')}</p></section>`;
  h += `<section class="rep-chart"><h3>${t('rep_s4')}</h3>${weekChart(D.weeks)}</section>`;
  const named = Object.entries(D.cust).filter(([k]) => k && cname(k)).sort((a, b) => b[1].v - a[1].v), walk = D.cust[''];
  const owing = Object.entries(D.cust).filter(([k, c]) => c.owed > 0).sort((a, b) => b[1].owed - a[1].owed);
  h += `<section><h3>${t('rep_s5')}</h3><p>${esc(t('rep_new_cust', D.newC))}</p><div class="rep-two"><div><h4>${t('rep_top')}</h4>${named.length || walk ? tbl([t('th_customer'), t('th_sales')], named.slice(0, 6).map(([k, c]) => [esc(cname(k)), m(c.v)]).concat(walk ? [[esc(t('rep_no_cust')), m(walk.v)]] : [])) : '<p>—</p>'}</div>` +
    `<div><h4>${t('rep_owed_list')}</h4>${owing.length ? tbl([t('th_customer'), t('th_amount')], owing.map(([k, c]) => [esc(k ? cname(k) || '—' : t('rep_no_cust')), m(c.owed)]), [t('total'), m(D.owed)]) : '<p>—</p>'}</div></div></section>`;
  if (notes.trim()) h += `<section><h3>${t('rep_s6')}</h3><p class="pre">${esc(notes.trim())}</p></section>`;
  return h + `<footer>${esc(t('rep_foot', biz, nice(today())))}</footer>`;
}


/* ---------- the report as a real PDF file, made on the phone (A4, built-in Helvetica, no library) ---------- */
async function logoJpeg() {
  const src = logoSrc(); if (!src) return '';
  try {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 160; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 160, 160);
    const k = Math.min(160 / img.naturalWidth, 160 / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k; x.drawImage(img, (160 - w) / 2, (160 - h) / 2, w, h);
    return atob(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
  } catch (e) { return ''; }
}
async function reportPdf(key, forWho, notes) {
  const D = reportData(key), s = D.s, biz = bizName() || 'Daftari', W = 595.28, H = 841.89, M = 40, CW = W - 2 * M, jpg = await logoJpeg();
  const m = x => Math.round(n(x)).toLocaleString('en-US'), cv = document.createElement('canvas').getContext('2d');
  const wid = (str, sz, b) => { cv.font = (b ? 'bold ' : '') + sz + 'px Helvetica, Arial, sans-serif'; return cv.measureText(String(str)).width; };
  const WIN = { '–': 150, '—': 151, '’': 146, '‘': 145, '“': 147, '”': 148, '·': 183, '…': 133, '×': 215, '‹': 139, '›': 155, '€': 128 };
  const enc = str => [...String(str)].map(ch => { const c = ch.charCodeAt(0), x = String.fromCharCode(WIN[ch] || (c < 256 ? c : 63)); return '()\\'.includes(x) ? '\\' + x : x; }).join('');
  const col = h => h.match(/\w\w/g).map(x => (parseInt(x, 16) / 255).toFixed(3)).join(' '), f = v => (+v).toFixed(2);
  const pages = []; let ops, y;
  const page = () => { ops = []; pages.push(ops); y = M; };
  const need = h => { if (y + h > H - M - 16) page(); };
  const rect = (x, yy, w, h, c, stroke) => ops.push(stroke ? `${col(c)} RG 0.8 w ${f(x)} ${f(H - yy - h)} ${f(w)} ${f(h)} re S` : `${col(c)} rg ${f(x)} ${f(H - yy - h)} ${f(w)} ${f(h)} re f`);
  const line = (x1, y1, x2, y2, c, lw) => ops.push(`${col(c)} RG ${lw || 0.5} w ${f(x1)} ${f(H - y1)} m ${f(x2)} ${f(H - y2)} l S`);
  const text = (str, x, yy, sz, c, b, al) => { str = String(str); const w = wid(str, sz, b); if (al === 'r') x -= w; else if (al === 'c') x -= w / 2; ops.push(`BT /${b ? 'F2' : 'F1'} ${sz} Tf ${col(c)} rg ${f(x)} ${f(H - yy)} Td (${enc(str)}) Tj ET`); };
  const fit = (str, sz, b, max) => { str = String(str); if (wid(str, sz, b) <= max) return str; while (str.length > 1 && wid(str + '…', sz, b) > max) str = str.slice(0, -1); return str + '…'; };
  const wrap = (str, sz, b, max) => { const out = []; String(str).split('\n').forEach(par => { let l = ''; par.split(/\s+/).forEach(wd => { const tt = l ? l + ' ' + wd : wd; if (l && wid(tt, sz, b) > max) { out.push(l); l = wd; } else l = tt; }); out.push(l); }); return out; };
  const para = (str, sz, c) => wrap(str, sz, false, CW).forEach(l => { need(14); text(l, M, y + sz, sz, c || '161413'); y += sz + 4; });
  const head = (h, k) => { need((k || 60) + 26); y += 6; text(h.toUpperCase(), M, y + 11, 11, 'A91B18', true); line(M, y + 16, W - M, y + 16, '161413', 1.2); y += 26; };
  // table: cols = [[label, widthShare, align]], rows of cells (a cell may be [main, small]); returns the bottom y
  const table = (x0, w0, cols, rws, foot) => {
    const tot = cols.reduce((a, c) => a + c[1], 0), ws = cols.map(c => c[1] / tot * w0), xs = ws.map((_, i) => x0 + ws.slice(0, i).reduce((a, b) => a + b, 0));
    const cell = (v, i, yy, sz, b, c) => { const al = cols[i][2], tx = al === 'r' ? xs[i] + ws[i] - 2 : xs[i] + 2; text(fit(v, sz, b, ws[i] - 6), tx, yy, sz, c || '161413', b, al); };
    const hdr = () => { cols.forEach((c, i) => cell(c[0].toUpperCase(), i, y + 9, 7, true, '6D6764')); line(x0, y + 14, x0 + w0, y + 14, 'E2DEDB'); y += 16; };
    need(40); hdr();
    rws.forEach(r => { const two = r.some(c => Array.isArray(c)), h = two ? 25 : 17; if (y + h > H - M - 16) { page(); hdr(); }
      r.forEach((c, i) => { if (Array.isArray(c)) { cell(c[0], i, y + 11, 8.5, true); cell(c[1], i, y + 21, 7, false, '6D6764'); } else cell(c, i, y + (two ? 15 : 12), 8.5); });
      line(x0, y + h, x0 + w0, y + h, 'E2DEDB'); y += h; });
    if (foot) { need(18); line(x0, y, x0 + w0, y, '161413', 1.2); foot.forEach((c, i) => cell(c, i, y + 12, 8.5, true)); y += 18; }
    return y;
  };
  page();
  // header band
  rect(0, 0, W, 88, '0F0E0E'); rect(0, 88, W, 5, 'C8211E');
  if (jpg) ops.push(`q 60 0 0 60 ${M} ${f(H - 14 - 60)} cm /Im1 Do Q`);
  const tx = jpg ? M + 74 : M;
  text(fit(biz.toUpperCase(), 22, true, W - tx - M), tx, 46, 22, 'FFFFFF', true);
  text(fit((t('rep_title') + ' · ' + D.r[2] + (forWho ? ' · ' + t('rep_for') + ': ' + forWho : '')).toUpperCase(), 8.5, true, W - tx - M), tx, 66, 8.5, 'BDB6B3', true);
  y = 112;
  // headline figures
  const kp = [[t('rep_k_sales'), money(s.rev)], [t('rep_k_cash'), money(D.cash)], [t('rep_k_profit'), money(s.profit), 1], [t('rep_k_owed'), money(D.owed)]], kw = (CW - 24) / 4;
  kp.forEach((k, i) => { const x = M + i * (kw + 8); if (k[2]) rect(x, y, kw, 50, '0F0E0E'); else rect(x, y, kw, 50, 'E2DEDB', true);
    text(fit(k[0].toUpperCase(), 7, true, kw - 16), x + 8, y + 17, 7, k[2] ? 'BDB6B3' : '6D6764', true); text(fit(k[1], 12.5, true, kw - 16), x + 8, y + 38, 12.5, k[2] ? 'F2B705' : '161413', true); });
  y += 66;
  // 1. sales
  head(t('rep_s1'));
  const prods = Object.entries(D.prod).sort((a, b) => b[1].v - a[1].v), best = prods[0];
  if (s.count) {
    para(t('rep_para', D.r[2], qn(s.sold), s.count, money(s.rev), money(D.cash), money(D.owed), D.nOwed) + (best ? ' ' + t('rep_best', pname(best[0]) || '—', money(best[1].v)) : ''), 9.5); y += 6;
    table(M, CW, [[t('th_product'), 3], [t('th_qty'), 1, 'r'], [t('th_avg'), 1.4, 'r'], [t('th_sales'), 1.6, 'r'], [t('th_paid'), 1.6, 'r'], [t('th_unpaid'), 1.4, 'r']],
      prods.map(([id, p]) => [pname(id) || '—', qn(p.q), m(p.q ? p.v / p.q : 0), m(p.v), m(p.paid), p.owed ? m(p.owed) : '—']), [t('total'), qn(s.sold), '—', m(s.rev), m(D.cash), D.owed ? m(D.owed) : '—']);
  } else para(t('rep_none'), 9.5, '6D6764');
  // 2. suppliers
  head(t('rep_s2'));
  const sups = Object.values(D.sup).sort((a, b) => (b.cost + b.tr) - (a.cost + a.tr)), sq = sups.reduce((a, o) => a + o.q, 0), sc = sups.reduce((a, o) => a + o.cost, 0), st = sups.reduce((a, o) => a + o.tr, 0);
  if (sups.length) table(M, CW, [[t('th_supplier'), 3.6], [t('th_qty'), 1, 'r'], [t('th_cost'), 1.6, 'r'], [t('th_transport'), 1.4, 'r'], [t('th_total'), 1.6, 'r']],
    sups.map(o => [[o.name || t('rep_no_sup'), [...o.prods].join(', ') + ' · ' + t('rep_buys', o.n)], qn(o.q), m(o.cost), m(o.tr), m(o.cost + o.tr)]), [t('total'), qn(sq), m(sc), m(st), m(sc + st)]);
  else para(t('rep_none'), 9.5, '6D6764');
  // 3. profit and loss
  head(t('rep_s3'), 140);
  [[t('pl_sales'), m(s.rev)], [t('pl_cogs'), '(' + m(s.cogs) + ')', 0, 1], [t('pl_gross'), m(s.rev - s.cogs), 1], [t('pl_loss'), '(' + m(s.lost) + ')', 0, 1]].forEach(r => {
    text(r[0], M, y + 12, 9, r[2] ? '161413' : '6D6764', !!r[2]); text(r[1], W - M, y + 12, 9, r[3] ? 'A91B18' : '161413', !!r[2], 'r'); line(M, y + 18, W - M, y + 18, 'E2DEDB'); y += 19; });
  line(M, y + 1, W - M, y + 1, '161413', 1.2); text(t('pl_net'), M, y + 18, 12, '161413', true); text(money(s.profit), W - M, y + 18, 12, '161413', true, 'r'); y += 28;
  wrap(t('pl_note'), 7.5, false, CW).forEach(l => { text(l, M, y + 8, 7.5, '6D6764'); y += 11; });
  // 4. weekly chart
  head(t('rep_s4'), 180);
  { const wk = D.weeks, pts = wk.filter(w => !w.future), topv = Math.max(1, ...pts.map(w => Math.max(w.rev, w.profit))), raw = topv / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), stp = [1, 2, 2.5, 5, 10].find(k => k * mag >= raw) * mag, max = Math.ceil(topv / stp) * stp;
    const L0 = M + 44, R0 = W - M - 20, T0 = y + 6, B0 = y + 140, X = i => L0 + (wk.length < 2 ? 0 : i * (R0 - L0) / (wk.length - 1)), Y = v => B0 - (B0 - T0) * Math.max(0, v) / max;
    for (let v = 0; v <= max + stp / 2; v += stp) { line(L0, Y(v), R0, Y(v), 'E2DEDB'); text(v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(v), L0 - 6, Y(v) + 3, 7.5, '6D6764', false, 'r'); }
    wk.forEach((w, i) => text(t('rep_week', w.a, w.b), X(i), B0 + 14, 7.5, '6D6764', false, 'c'));
    const ln = (k, c) => { if (!pts.length) return; ops.push(`${col(c)} RG 2 w 1 j ` + pts.map((w, i) => `${f(X(i))} ${f(H - Y(w[k]))} ${i ? 'l' : 'm'}`).join(' ') + ' S');
      pts.forEach((w, i) => { const cx = X(i), cy = H - Y(w[k]), r = 2.6, q = r * 0.5523; ops.push(`${col(c)} rg ${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + q)} ${f(cx + q)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ${f(cx - q)} ${f(cy + r)} ${f(cx - r)} ${f(cy + q)} ${f(cx - r)} ${f(cy)} c ${f(cx - r)} ${f(cy - q)} ${f(cx - q)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ${f(cx + q)} ${f(cy - r)} ${f(cx + r)} ${f(cy - q)} ${f(cx + r)} ${f(cy)} c f`); }); };
    ln('rev', '161413'); ln('profit', 'C8211E');
    y = B0 + 26; rect(M, y - 6, 7, 7, '161413'); text(t('th_sales'), M + 11, y, 8, '6D6764'); const lx = M + 20 + wid(t('th_sales'), 8); rect(lx, y - 6, 7, 7, 'C8211E'); text(t('rep_k_profit'), lx + 11, y, 8, '6D6764'); y += 12; }
  // 5. customers
  head(t('rep_s5'), 90); para(t('rep_new_cust', D.newC), 9.5); y += 4;
  { const named = Object.entries(D.cust).filter(([k]) => k && cname(k)).sort((a, b) => b[1].v - a[1].v), walk = D.cust[''], owing = Object.entries(D.cust).filter(([k, c]) => c.owed > 0).sort((a, b) => b[1].owed - a[1].owed);
    const half = (CW - 20) / 2; need(60); const y0 = y, p0 = pages.length;
    text(t('rep_top').toUpperCase(), M, y + 9, 8.5, '6D6764', true); y += 16;
    const top = named.slice(0, 6).map(([k, c]) => [cname(k), m(c.v)]).concat(walk ? [[t('rep_no_cust'), m(walk.v)]] : []);
    const y1 = top.length ? table(M, half, [[t('th_customer'), 3], [t('th_sales'), 2, 'r']], top) : (text('—', M, y + 10, 9, '6D6764'), y + 16);
    if (pages.length === p0) { y = y0; text(t('rep_owed_list').toUpperCase(), M + half + 20, y + 9, 8.5, '6D6764', true); y += 16;
      const y2 = owing.length ? table(M + half + 20, half, [[t('th_customer'), 3], [t('th_amount'), 2, 'r']], owing.map(([k, c]) => [k ? cname(k) || '—' : t('rep_no_cust'), m(c.owed)]), [t('total'), m(D.owed)]) : (text('—', M + half + 20, y + 10, 9, '6D6764'), y + 16);
      y = Math.max(y1, y2) + 4; }
    else { text(t('rep_owed_list').toUpperCase(), M, y + 14, 8.5, '6D6764', true); y += 20; owing.length ? table(M, CW, [[t('th_customer'), 3], [t('th_amount'), 2, 'r']], owing.map(([k, c]) => [k ? cname(k) || '—' : t('rep_no_cust'), m(c.owed)]), [t('total'), m(D.owed)]) : 0; } }
  // 6. notes
  if (notes.trim()) { head(t('rep_s6')); para(notes.trim(), 9.5); }
  need(30); y += 8; line(M, y, W - M, y, 'E2DEDB'); wrap(t('rep_foot', biz, nice(today())), 7.5, false, CW).forEach(l => { text(l, M, y + 12, 7.5, '6D6764'); y += 11; });
  pages.forEach((o, i) => { ops = o; text(biz + ' · ' + D.r[2], M, H - 22, 7, '6D6764'); text(t('rep_page', i + 1, pages.length), W - M, H - 22, 7, '6D6764', false, 'r'); });
  // assemble
  const objs = [], add = o => objs.push(o);
  add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const im = jpg ? add(`<< /Type /XObject /Subtype /Image /Width 160 /Height 160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n${jpg}\nendstream`) : 0;
  const kids = pages.map(o => { const c = o.join('\n'), ci = add(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`); return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${im ? ` /XObject << /Im1 ${im} 0 R >>` : ''} >> /Contents ${ci} 0 R >>`); });
  objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  add(`<< /Title (${enc(biz + ' - ' + t('rep_title') + ' - ' + D.r[2])}) /Producer (Daftari) >>`);
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xr = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xr}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return new Blob([bytes], { type: 'application/pdf' });
}
async function saveReportPdf(btn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = t('rep_pdf_busy');
  try {
    const blob = await reportPdf(ui.repMonth, L.repFor || '', (L.repNotes || {})[ui.repMonth] || ''), name = ((bizName() || 'Daftari') + ' report ' + ui.repMonth).replace(/[^\w-]+/g, '-') + '.pdf';
    const file = new File([blob], name, { type: 'application/pdf' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); toast(t('rep_pdf_done'));
  } finally { btn.disabled = false; btn.textContent = old; }
}

/* ======================= forms ======================= */
const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
const fld = (id, label, inner) => `<div class="f"><label for="${id}">${label}</label>${inner}</div>`;
const inp = (id, label, val, attrs) => fld(id, label, `<input id="${id}" value="${esc(val == null ? '' : val)}" ${attrs || ''}>`);
const num = (id, label, val, attrs) => inp(id, label, val, 'type="number" inputmode="decimal" min="0" step="any" ' + (attrs || ''));
const area = (id, label, val, ph) => fld(id, label, `<textarea id="${id}" placeholder="${esc(ph || '')}">${esc(val || '')}</textarea>`);
const sel = (id, label, opts, val) => fld(id, label, `<select id="${id}">${opts.map(o => `<option value="${esc(o[0])}"${String(o[0]) === String(val == null ? '' : val) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`);
const check = (id, label, on, hint) => `<label class="check"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span>${label}${hint ? `<br><small class="hint">${hint}</small>` : ''}</span></label>`;
const pinInp = (id, label) => inp(id, label, '', 'type="password" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]*"');
const head = title => `<div class="sheet-head"><h3 id="sheetTitle">${title}</h3><button type="button" data-act="close" aria-label="${t('close')}">×</button></div>`;
const foot = (id, saveLabel) => `<div class="msg" id="fmsg" role="alert"></div><div class="actions"><button class="btn primary" type="submit">${saveLabel || t('save')}</button>${id ? `<button class="btn danger" type="button" data-act="del">${t('delete')}</button>` : ''}<button class="btn" type="button" data-act="close">${t('cancel')}</button></div>`;
const fail = m => { $('#fmsg').textContent = m; return false; };
function productOpts(cur) { const l = rows('products').filter(p => p.active !== false || p.id === cur).sort(byName); return l.map(p => [p.id, p.name + (p.unit ? ' (' + p.unit + ')' : '')]).concat([['__new', '+ ' + t('new_product')]]); }
function supplierOpts() { return [['', t('supplier_none')], ['__new', '+ ' + t('new_supplier')]].concat(rows('suppliers').sort(byName).map(s => [s.id, s.name + (s.area ? ', ' + s.area : '')])); }
function customerOpts() { return [['', t('no_customer')], ['__new', '+ ' + t('new_customer')]].concat(rows('customers').sort(byName).map(c => [c.id, c.name + (c.phone ? ', ' + c.phone : '')])); }
function lastProduct() { const s = rows('sales').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]; if (s && get('products', s.productId) && get('products', s.productId).active !== false) return s.productId; const p = rows('products').filter(p => p.active !== false)[0]; return p ? p.id : '__new'; }
function resolveProduct(prefix, price) {
  let pid = v(prefix + '-product');
  if (pid === '__new') { const nm = v(prefix + '-pname').trim(); if (!nm) return fail(t('need_product_name')); pid = put('products', { name: nm, unit: '', price: prefix === 't' ? 0 : price, cost: prefix === 't' ? price : 0, description: '', active: true }); }
  if (!pid) return fail(t('need_product'));
  return pid;
}
function resolveCustomer(prefix) { let cid = v(prefix + '-customer'); if (cid === '__new') cid = put('customers', { name: v(prefix + '-cname').trim(), phone: v(prefix + '-cphone').trim(), area: '', notes: '' }); return cid || ''; }
const newProductBox = (prefix, show) => `<div class="newbox" id="${prefix}-pbox"${show ? '' : ' hidden'}>${inp(prefix + '-pname', t('new_product_name'), '')}</div>`;
const newCustomerBox = prefix => `<div class="newbox" id="${prefix}-cbox" hidden>${inp(prefix + '-cname', t('new_customer_name'), '')}${inp(prefix + '-cphone', t('phone'), '', 'inputmode="tel" placeholder="07…"')}</div>`;
function wirePicker(prefix, priceId) {
  const unit = () => { const p = get('products', v(prefix + '-product')), lab = $('#' + prefix + '-qtylab'); if (lab) lab.textContent = t('qty') + (p && p.unit ? ' (' + p.unit + ')' : ''); const sh = $('#' + prefix + '-stock'); if (sh) sh.textContent = p && p.trackStock ? t('stock_sale_hint', qn(stockQ(p.id)) + (p.unit ? ' ' + p.unit : '')) : ''; };
  $('#' + prefix + '-product').addEventListener('change', () => { const pid = v(prefix + '-product'), p = get('products', pid); $('#' + prefix + '-pbox').hidden = pid !== '__new'; if (priceId) { if (p) $('#' + priceId).value = p.price; if (pid === '__new') $('#' + priceId).value = ''; } if (pid === '__new') $('#' + prefix + '-pname').focus(); unit(); $('#' + prefix + '-qty').dispatchEvent(new Event('input')); });
  const cs = $('#' + prefix + '-customer'); if (cs) cs.addEventListener('change', () => { $('#' + prefix + '-cbox').hidden = v(prefix + '-customer') !== '__new'; if (v(prefix + '-customer') === '__new') $('#' + prefix + '-cname').focus(); });
  unit();
}

const FORMS = {
  sale: {
    tb: 'sales', title: id => id ? t('edit_sale') : t('new_sale'),
    html(id) {
      const pre = !id && ui.prefill ? ui.prefill : null;
      const x = id ? get('sales', id) : Object.assign({ date: today(), productId: lastProduct(), customerId: '', qty: '', method: 'Cash', paid: true, notes: '' }, pre || {});
      const p = get('products', x.productId), price = id || (pre && pre.price !== undefined) ? x.price : (p ? p.price : '');
      return inp('s-date', t('date'), x.date, 'type="date" required') + sel('s-product', t('product'), productOpts(x.productId), x.productId) + `<p class="hint" id="s-stock"></p>` + newProductBox('s', x.productId === '__new') +
        sel('s-customer', t('customer'), customerOpts(), x.customerId) + newCustomerBox('s') +
        `<div class="f2">${num('s-qty', `<span id="s-qtylab">${t('qty')}</span>`, x.qty, 'required')}${num('s-price', t('unit_price'), price, 'required')}</div><div class="calc" id="s-total"></div>` +
        `<div class="f2">${sel('s-method', t('method'), METHODS.map(m => [m, mlabel(m)]), x.method || 'Cash')}${sel('s-paid', t('payment'), [['yes', t('pay_yes')], ['no', t('pay_no')]], x.paid === false ? 'no' : 'yes')}</div>` + area('s-notes', t('notes'), x.notes);
    },
    init() {
      const calc = () => { $('#s-total').textContent = t('total') + ': ' + money(n(v('s-qty')) * n(v('s-price'))); };
      $('#s-qty').addEventListener('input', calc); $('#s-price').addEventListener('input', calc); wirePicker('s', 's-price'); calc();
    },
    save(id) {
      const qty = n(v('s-qty')), price = n(v('s-price'));
      if (!(qty > 0)) return fail(t('need_qty'));
      if (v('s-customer') === '__new' && !v('s-cname').trim()) return fail(t('need_customer_name'));
      const pid = resolveProduct('s', price); if (!pid) return false;
      const cid = resolveCustomer('s');
      const sid = put('sales', Object.assign({}, id ? get('sales', id) : {}, { date: v('s-date') || today(), productId: pid, customerId: cid, qty, price, method: v('s-method'), paid: v('s-paid') === 'yes', notes: v('s-notes').trim() }));
      const pre = !id && ui.prefill; if (pre && pre.orderId) { const o = get('orders', pre.orderId); if (o) put('orders', Object.assign({}, o, { status: 'done', saleId: sid })); }
      return true;
    }
  },
  order: {
    tb: 'orders', title: id => id ? t('edit_order') : t('new_order'),
    html(id) {
      const x = id ? get('orders', id) : { due: addDays(today(), 1), time: '', productId: lastProduct(), customerId: '', qty: '', remind: 60, status: 'open', notes: '' };
      const p = get('products', x.productId), price = id ? x.price : (p ? p.price : '');
      return sel('o-customer', t('customer'), customerOpts(), x.customerId) + newCustomerBox('o') + sel('o-product', t('product'), productOpts(x.productId), x.productId) + newProductBox('o', x.productId === '__new') +
        `<div class="f2">${num('o-qty', `<span id="o-qtylab">${t('qty')}</span>`, x.qty, 'required')}${num('o-price', t('unit_price'), price)}</div><div class="calc" id="o-total"></div>` +
        `<div class="f2">${inp('o-due', t('due'), x.due, 'type="date" required')}${inp('o-time', t('due_time'), x.time, 'type="time"')}</div>` +
        sel('o-remind', t('remind'), REMINDS.map(r => [r, t(r < 0 ? 'rm_none' : 'rm_' + r)]), x.remind === undefined ? 60 : x.remind) +
        (id ? sel('o-status', t('status'), [['open', t('o_open')], ['done', t('o_done')], ['cancelled', t('o_cancelled')]], ostatus(x)) : check('o-cal', t('o_cal_after'), false)) + area('o-notes', t('notes'), x.notes);
    },
    init() { const calc = () => { $('#o-total').textContent = t('total') + ': ' + money(n(v('o-qty')) * n(v('o-price'))); }; $('#o-qty').addEventListener('input', calc); $('#o-price').addEventListener('input', calc); wirePicker('o', 'o-price'); calc(); },
    save(id) {
      const qty = n(v('o-qty')); if (!(qty > 0)) return fail(t('need_qty'));
      if (v('o-customer') === '__new' && !v('o-cname').trim()) return fail(t('need_customer_name'));
      const pid = resolveProduct('o', n(v('o-price'))); if (!pid) return false;
      const old = id ? get('orders', id) : null;
      const oid = put('orders', Object.assign({}, old || {}, { customerId: resolveCustomer('o'), productId: pid, qty, price: n(v('o-price')), due: v('o-due') || addDays(today(), 1), time: v('o-time'), remind: n(v('o-remind')), status: id ? v('o-status') : 'open', notes: v('o-notes').trim() }));
      if (old && (old.due !== v('o-due') || old.time !== v('o-time') || n(old.remind) !== n(v('o-remind')))) { delete L.notified[oid]; persistLocal(); }
      if (!id && $('#o-cal') && $('#o-cal').checked) return () => openForm('calendar', oid);
      return true;
    }
  },
  calendar: {
    title: () => t('cal_title'), custom: true,
    html(id) { const o = get('orders', id); if (!o) return ''; return `<p class="hint">${esc(orderLine(o))}</p><p>${t('cal_hint')}</p><div class="menu"><a class="mrow" href="${esc(googleCal(o))}" target="_blank" rel="noopener" id="calGoogle"><span><span class="mt">${t('cal_google')}</span><br><span class="ms">${t('cal_google_hint')}</span></span><span class="go">›</span></a><button type="button" class="mrow" data-act="ics" data-id="${o.id}" id="calFile"><span><span class="mt">${t('cal_file')}</span><br><span class="ms">${t('cal_file_hint')}</span></span><span class="go">›</span></button></div><div class="msg" id="fmsg"></div><div class="actions"><button class="btn" type="button" data-act="close">${t('close')}</button></div>`; },
    save() { return true; }
  },
  purchase: {
    tb: 'purchases', title: id => id ? t('edit_purchase') : t('new_purchase'),
    html(id) {
      const x = id ? get('purchases', id) : { date: today(), productId: lastProduct(), supplierId: '', supplier: '', qty: '', cost: '', transport: 0, notes: '' };
      if (!id) { const p0 = get('products', x.productId); if (p0 && p0.supplierId && get('suppliers', p0.supplierId)) x.supplierId = p0.supplierId; }
      const sups = [['', t('supplier_none')], ['__new', '+ ' + t('new_supplier')]].concat(x.supplier && !x.supplierId ? [['__text', x.supplier]] : []).concat(rows('suppliers').sort(byName).map(s => [s.id, s.name + (s.area ? ', ' + s.area : '')]));
      return inp('t-date', t('date'), x.date, 'type="date" required') + sel('t-product', t('product'), productOpts(x.productId), x.productId) + newProductBox('t', x.productId === '__new') +
        sel('t-supplier', t('supplier'), sups, x.supplierId || (x.supplier ? '__text' : '')) + `<div class="newbox" id="t-sbox" hidden>${inp('t-sname', t('name'), '')}${inp('t-sphone', t('phone'), '', 'inputmode="tel" placeholder="07…"')}${inp('t-sarea', t('area'), '')}</div>` +
        `<div class="f2">${num('t-qty', t('qty'), x.qty, 'required')}${num('t-cost', t('cost_each'), x.cost, 'required')}</div>` + num('t-transport', t('transport'), x.transport) + `<div class="calc" id="t-total"></div>` + area('t-notes', t('notes'), x.notes);
    },
    init() {
      const calc = () => { const q = n(v('t-qty')), tot = q * n(v('t-cost')) + n(v('t-transport')); $('#t-total').textContent = t('total') + ': ' + money(tot) + (q ? ', ' + t('with_transport', money(tot / q)) : ''); };
      $('#t-product').addEventListener('change', () => { $('#t-pbox').hidden = v('t-product') !== '__new'; if (v('t-product') === '__new') $('#t-pname').focus(); const p = get('products', v('t-product')); if (p && p.supplierId && get('suppliers', p.supplierId) && !$('#t-supplier').dataset.touched) $('#t-supplier').value = p.supplierId; });
      $('#t-supplier').addEventListener('input', () => { $('#t-supplier').dataset.touched = '1'; });
      $('#t-supplier').addEventListener('change', () => { $('#t-sbox').hidden = v('t-supplier') !== '__new'; if (v('t-supplier') === '__new') $('#t-sname').focus(); });
      ['t-qty', 't-cost', 't-transport'].forEach(i => document.getElementById(i).addEventListener('input', calc)); calc();
    },
    save(id) {
      const qty = n(v('t-qty')); if (!(qty > 0)) return fail(t('need_qty'));
      if (v('t-supplier') === '__new' && !v('t-sname').trim()) return fail(t('need_name'));
      const pid = resolveProduct('t', n(v('t-cost'))); if (!pid) return false;
      const old = id ? get('purchases', id) : null; let sid = v('t-supplier'), stext = '';
      if (sid === '__new') sid = put('suppliers', { name: v('t-sname').trim(), phone: v('t-sphone').trim(), area: v('t-sarea').trim(), notes: '' });
      if (sid === '__text') { stext = old ? old.supplier : ''; sid = ''; } else if (sid) stext = sname(sid);
      put('purchases', Object.assign({}, old || {}, { date: v('t-date') || today(), productId: pid, supplierId: sid, supplier: stext, qty, cost: n(v('t-cost')), transport: n(v('t-transport')), notes: v('t-notes').trim() }));
      return true;
    }
  },
  loss: {
    tb: 'losses', title: id => id ? t('edit_loss') : t('new_loss'),
    html(id) {
      const x = id ? get('losses', id) : { date: today(), reason: REASONS[0], productId: '', qty: 0, extra: 0, notes: '' };
      const prods = rows('products').sort(byName).map(p => [p.id, p.name]);
      const reasons = REASONS.map((r, i) => [r, t('r_' + i)]); if (x.reason && REASONS.indexOf(x.reason) < 0) reasons.push([x.reason, x.reason]);
      return inp('l-date', t('date'), x.date, 'type="date" required') + sel('l-reason', t('reason'), reasons, x.reason) + sel('l-product', t('product'), [['', t('money_only')]].concat(prods), x.productId) +
        `<div class="f2">${num('l-qty', t('qty_lost'), x.qty)}${num('l-extra', t('extra'), x.extra)}</div><p class="hint">${t('loss_hint')}</p><div class="calc" id="l-total"></div>` + area('l-notes', t('notes'), x.notes);
    },
    init() {
      const calc = () => { $('#l-total').textContent = t('loss_value') + ': ' + money(n(v('l-qty')) * (C[v('l-product')] || 0) + n(v('l-extra'))); };
      ['l-qty', 'l-extra', 'l-product'].forEach(i => document.getElementById(i).addEventListener('input', calc)); calc();
    },
    save(id) {
      const qty = n(v('l-qty')), extra = n(v('l-extra'));
      if (!(qty > 0) && !(extra > 0)) return fail(t('need_loss'));
      if (qty > 0 && !v('l-product')) return fail(t('need_loss_product'));
      put('losses', Object.assign({}, id ? get('losses', id) : {}, { date: v('l-date') || today(), reason: v('l-reason'), productId: v('l-product'), qty, extra, notes: v('l-notes').trim() }));
      return true;
    }
  },
  customer: {
    tb: 'customers', title: id => id ? t('edit_customer') : t('new_customer'),
    html(id) { const x = id ? get('customers', id) : {}; return inp('c-name', t('name'), x.name, 'required') + inp('c-phone', t('phone'), x.phone, 'inputmode="tel" placeholder="07…"') + inp('c-area', t('area'), x.area) + area('c-notes', t('notes'), x.notes) + check('c-ok', t('consent'), !!x.offersOk, t('consent_hint')); },
    save(id) {
      const name = v('c-name').trim(); if (!name) return fail(t('need_name'));
      const old = id ? get('customers', id) : null, ok = $('#c-ok').checked;
      put('customers', Object.assign({}, old || {}, { name, phone: v('c-phone').trim(), area: v('c-area').trim(), notes: v('c-notes').trim(), offersOk: ok, offersAt: ok ? ((old && old.offersOk && old.offersAt) || today()) : '' }));
      if (old && old.name !== name) { touch('sales', s => s.customerId === id); touch('orders', s => s.customerId === id); }
      return true;
    },
    canDelete(id) { return rows('sales').some(s => s.customerId === id) ? t('has_sales') : ''; }
  },
  supplier: {
    tb: 'suppliers', title: id => id ? t('edit_supplier') : t('new_supplier'),
    html(id) {
      const x = id ? get('suppliers', id) : {}, prods = rows('products').filter(p => p.active !== false || (id && p.supplierId === id)).sort(byName);
      return inp('u-name', t('name'), x.name, 'required') + inp('u-phone', t('phone'), x.phone, 'inputmode="tel" placeholder="07…"') + inp('u-area', t('area'), x.area) +
        `<div class="f"><span class="flabel">${t('sup_products')}</span>${prods.length ? `<div class="checklist">${prods.map(p => `<label class="check"><input type="checkbox" class="sp" value="${p.id}"${id && p.supplierId === id ? ' checked' : ''}><span>${esc(p.name)}${p.supplierId && p.supplierId !== id && sname(p.supplierId) ? `<br><small class="hint">${esc(t('from_sup', sname(p.supplierId)))}</small>` : ''}</span></label>`).join('')}</div>` : `<p class="hint">${t('sup_products_none')}</p>`}</div>` + area('u-notes', t('supplies'), x.notes);
    },
    save(id) {
      const name = v('u-name').trim(); if (!name) return fail(t('need_name'));
      const old = id ? get('suppliers', id) : null;
      const sid = put('suppliers', Object.assign({}, old || {}, { name, phone: v('u-phone').trim(), area: v('u-area').trim(), notes: v('u-notes').trim() }));
      document.querySelectorAll('#form .sp').forEach(cb => { const p = get('products', cb.value); if (!p) return; if (cb.checked && p.supplierId !== sid) put('products', Object.assign({}, p, { supplierId: sid })); else if (!cb.checked && p.supplierId === sid) put('products', Object.assign({}, p, { supplierId: '' })); });
      if (old && old.name !== name) { rows('purchases').filter(p => p.supplierId === id).forEach(p => { p.supplier = name; p._dirty = 1; }); persist('purchases'); touch('products', p => p.supplierId === id); }
      return true;
    },
    canDelete(id) { return rows('purchases').some(p => p.supplierId === id) ? t('supplier_used') : ''; },
    onDelete(id) { rows('products').filter(p => p.supplierId === id).forEach(p => put('products', Object.assign({}, p, { supplierId: '' }))); }
  },
  product: {
    tb: 'products', title: id => id ? t('edit_product') : t('new_product'),
    html(id) {
      const x = id ? get('products', id) : { active: true }, lk = locked();
      return inp('p-name', t('name'), x.name, 'required') + `<div class="f2">${num('p-price', t('price'), x.price, 'required')}${inp('p-unit', t('unit'), x.unit, `placeholder="${esc(t('unit_ph'))}"`)}</div>` +
        (lk ? '' : num('p-cost', t('usual_cost'), x.cost || '') + `<p class="hint">${t('usual_cost_hint')}</p>`) +
        sel('p-supplier', t('sup_field'), supplierOpts(), x.supplierId || '') + `<div class="newbox" id="p-sbox" hidden>${inp('p-sname', t('name'), '')}${inp('p-sphone', t('phone'), '', 'inputmode="tel" placeholder="07…"')}${inp('p-sarea', t('area'), '')}</div>` + area('p-desc', t('description'), x.description) +
        check('p-track', t('track'), !!x.trackStock, t('stock_hint')) + `<div class="newbox" id="p-tbox"${x.trackStock ? '' : ' hidden'}>${num('p-low', t('low_at'), x.lowAt || '')}${num('p-count', t('count_now'), '')}<p class="hint">${id && x.trackStock ? t('book_says', qn(stockQ(id))) + '. ' : ''}${t('count_now_hint')}</p></div>` +
        check('p-active', t('active'), x.active !== false);
    },
    init() { $('#p-track').addEventListener('change', () => { $('#p-tbox').hidden = !$('#p-track').checked; }); $('#p-supplier').addEventListener('change', () => { $('#p-sbox').hidden = v('p-supplier') !== '__new'; if (v('p-supplier') === '__new') $('#p-sname').focus(); }); },
    save(id) {
      const name = v('p-name').trim(); if (!name) return fail(t('need_name'));
      if (v('p-supplier') === '__new' && !v('p-sname').trim()) return fail(t('need_name'));
      const old = id ? get('products', id) : null, track = $('#p-track').checked;
      let sup = v('p-supplier'); if (sup === '__new') sup = put('suppliers', { name: v('p-sname').trim(), phone: v('p-sphone').trim(), area: v('p-sarea').trim(), notes: '' });
      const pid = put('products', Object.assign({}, old || {}, { name, unit: v('p-unit').trim(), price: n(v('p-price')), cost: $('#p-cost') ? n(v('p-cost')) : n(old && old.cost), description: v('p-desc').trim(), active: $('#p-active').checked, trackStock: track, lowAt: n(v('p-low')), supplierId: sup || '' }));
      if (track && v('p-count').trim() !== '') { S = stockMap(); const counted = n(v('p-count')); put('stock', { date: today(), productId: pid, counted, delta: counted - (S[pid] || 0), notes: '' }); }
      if (old && old.name !== name) ['sales', 'purchases', 'losses', 'orders', 'stock'].forEach(tb => touch(tb, r => r.productId === id));
      return true;
    },
    canDelete(id) { return ['sales', 'purchases', 'losses', 'orders'].some(tb => rows(tb).some(r => r.productId === id)) ? t('product_used') : ''; }
  },
  count: {
    tb: 'stock', title: () => t('count_title'),
    html(id) {
      const all = rows('products').filter(p => p.active !== false || (id && p.id === get('stock', id).productId)).sort((a, b) => (!!b.trackStock - !!a.trackStock) || byName(a, b));
      const x = id ? get('stock', id) : { date: today(), productId: (ui.prefill && ui.prefill.pid) || (all[0] || {}).id || '', counted: '', notes: '' };
      const opts = all.map(p => [p.id, p.name + (p.unit ? ' (' + p.unit + ')' : '')]);
      return sel('k-product', t('product'), opts.length ? opts : [['', t('products_empty')]], x.productId) + inp('k-date', t('date'), x.date, 'type="date"') + num('k-counted', t('counted'), x.counted, 'required') + `<div class="calc" id="k-calc"></div>` + area('k-notes', t('notes'), x.notes);
    },
    init(id) {
      const old = id ? get('stock', id) : null;
      const calc = () => { const pid = v('k-product'), book = (S[pid] || 0) - (old && old.productId === pid ? n(old.delta) : 0), raw = v('k-counted').trim(); $('#k-calc').textContent = t('book_says', qn(book)) + (raw === '' ? '' : '. ' + t('count_diff', Math.round((n(raw) - book) * 100) / 100)); };
      $('#k-product').addEventListener('change', calc); $('#k-counted').addEventListener('input', calc); calc();
    },
    save(id) {
      const pid = v('k-product'), raw = v('k-counted').trim(); if (!pid) return fail(t('need_product')); if (raw === '') return fail(t('need_count'));
      const old = id ? get('stock', id) : null, book = (S[pid] || 0) - (old && old.productId === pid ? n(old.delta) : 0), counted = n(raw);
      put('stock', Object.assign({}, old || {}, { date: v('k-date') || today(), productId: pid, counted, delta: counted - book, notes: v('k-notes').trim() }));
      const pr = get('products', pid); if (pr && !pr.trackStock) put('products', Object.assign({}, pr, { trackStock: true }));
      return true;
    }
  },
  business: {
    title: () => t('biz_title'),
    html() { ui.pendingLogo = null; const logo = logoSrc(); return inp('b-name', t('business'), metaStr('business', '').trim() || String(BRAND.name || ''), `placeholder="${esc(t('business_ph'))}" maxlength="40"`) + `<div class="f"><span class="flabel">${t('logo')}</span><div class="logorow"><span id="logoPrev">${logo ? `<img class="mark logo" src="${esc(logo)}" alt="">` : `<span class="mark">${MARK}</span>`}</span><label class="btn" for="b-logo">${t('logo_pick')}</label><button class="btn" type="button" data-act="logo-remove">${t('logo_remove')}</button></div><input type="file" id="b-logo" accept="image/*" hidden></div>`; },
    init() { $('#b-logo').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { ui.pendingLogo = await shrinkLogo(f); $('#logoPrev').innerHTML = `<img class="mark logo" src="${ui.pendingLogo}" alt="">`; $('#fmsg').textContent = ''; } catch (x) { $('#fmsg').textContent = t('logo_bad'); } }); },
    save() { setMeta('business', v('b-name').trim()); if (ui.pendingLogo !== null) setMeta('logo', ui.pendingLogo); return true; }
  },
  username: {
    title: () => t('your_name'),
    html() { return inp('n-name', t('your_name'), L.userName, 'maxlength="30" autocomplete="given-name"') + `<p class="hint">${t('your_name_hint')}</p>`; },
    save() { L.userName = v('n-name').trim(); persistLocal(); return true; }
  },
  pin: {
    title: () => t('pin_title'), custom: true,
    html() { const has = !!pinRec(); return `<p class="hint">${t('pin_hint')}</p>` + (has ? pinInp('pin-cur', t('pin_current')) : '') + pinInp('pin-new', t('pin_new')) + pinInp('pin-again', t('pin_again')) + `<div class="msg" id="fmsg" role="alert"></div><div class="actions"><button class="btn primary" type="submit">${t('save')}</button>${has ? `<button class="btn danger" type="button" data-act="pin-off">${t('pin_off')}</button>` : ''}<button class="btn" type="button" data-act="close">${t('cancel')}</button></div>` + (has ? `<button class="btn link" type="button" data-act="form" data-f="pinreset">${t('forgot_pin')}</button>` : ''); },
    async save() {
      const rec = pinRec(); if (rec && !(await verifyPin(v('pin-cur'), rec))) return fail(t('pin_wrong'));
      const a = v('pin-new'), b = v('pin-again'); if (!/^\d{4,6}$/.test(a)) return fail(t('pin_bad')); if (a !== b) return fail(t('pin_mismatch'));
      setMeta('pin', JSON.stringify(await hashPin(a))); ui.unlocked = true; toast(t('pin_set')); return true;
    }
  },
  unlock: {
    title: () => t('unlock_title'), custom: true,
    html() { return `<p class="hint">${t('locked_text')}</p>` + pinInp('u-pin', t('pin_label')) + `<div class="msg" id="fmsg" role="alert"></div><div class="actions"><button class="btn primary" type="submit" id="unlockBtn">${t('unlock')}</button><button class="btn" type="button" data-act="close">${t('cancel')}</button></div><button class="btn link" type="button" data-act="form" data-f="pinreset">${t('forgot_pin')}</button>`; },
    init() { setTimeout(() => { const el = $('#u-pin'); if (el) el.focus(); }, 50); },
    async save() { if (!(await verifyPin(v('u-pin'), pinRec()))) { $('#u-pin').value = ''; return fail(t('pin_wrong')); } ui.unlocked = true; const after = ui.after; ui.after = null; return after || true; }
  },
  pinreset: {
    title: () => t('reset_title'), custom: true,
    html() { return `<p class="hint">${t('reset_hint')}</p>` + (L.syncUrl ? inp('r-url', t('sync_link'), '', 'type="url" autocapitalize="off" autocomplete="off" spellcheck="false"') : '') + `<div class="msg" id="fmsg" role="alert"></div><div class="actions"><button class="btn primary" type="submit">${t('pin_off')}</button><button class="btn" type="button" data-act="close">${t('cancel')}</button></div>`; },
    save() { if (L.syncUrl && v('r-url').trim() !== L.syncUrl) return fail(t('reset_bad')); setMeta('pin', ''); ui.unlocked = false; toast(t('pin_removed')); return true; }
  },
  notify: {
    title: () => t('notify_title'), custom: true,
    html() {
      const sup = 'Notification' in window, perm = sup ? Notification.permission : 'denied', on = L.notify && perm === 'granted';
      return `<p>${t('notify_text')}</p>` + (!sup ? `<div class="warnbox">${t('notify_unsup')}</div>` : perm === 'denied' ? `<div class="warnbox">${t('notify_denied')}</div>` : '') +
        `<div class="msg" id="fmsg" role="status"></div><div class="actions">${on ? `<button class="btn" type="button" data-act="notify-test">${t('notify_test')}</button><button class="btn danger" type="button" data-act="notify-off">${t('notify_stop')}</button>` : sup && perm !== 'denied' ? `<button class="btn primary" type="button" data-act="notify-on" id="notifyOn">${t('notify_btn')}</button>` : ''}<button class="btn" type="button" data-act="close">${t('close')}</button></div>`;
    },
    save() { return true; }
  },
  consent: {
    title: () => t('consent_title'), custom: true,
    html() { const l = rows('customers').filter(c => phone255(c.phone) && !c.offersOk).sort(byName); return `<p class="hint">${t('consent_text')}</p><div class="checklist">${l.map(c => `<label class="check"><input type="checkbox" class="ck" value="${c.id}"><span>${esc(c.name)}<br><small class="hint">${esc([c.area, c.phone].filter(Boolean).join(', '))}</small></span></label>`).join('')}</div><div class="msg" id="fmsg"></div><div class="actions"><button class="btn primary" type="submit">${t('save')}</button><button class="btn" type="button" data-act="close">${t('cancel')}</button></div>`; },
    save() { const ids = [...document.querySelectorAll('#form .ck:checked')].map(x => x.value); ids.forEach(id => { const c = get('customers', id); if (c) put('customers', Object.assign({}, c, { offersOk: true, offersAt: today() })); }); toast(t('consent_saved', ids.length)); return true; }
  },
  alloc: {
    title: () => t('alloc_edit'), custom: true,
    html() {
      ui.al = alloc().map(a => ({ id: a.id, key: a.key || '', name: aname(a), pct: n(a.pct) }));
      return `<p class="hint">${t('alloc_hint')}</p><div class="alloc" id="alRows"></div><button type="button" class="btn" data-act="al-add">+ ${t('alloc_add')}</button><div class="al-total" id="alTotal"></div><div class="msg" id="fmsg" role="alert"></div>` +
        `<div class="actions"><button class="btn primary" type="submit" id="alSave">${t('save')}</button><button class="btn" type="button" data-act="al-reset">${t('alloc_reset')}</button><button class="btn" type="button" data-act="close">${t('cancel')}</button></div>`;
    },
    init() { drawAl(); $('#alRows').addEventListener('input', () => { readAl(); totalAl(); }); },
    save() {
      readAl(); const sum = ui.al.reduce((a, x) => a + x.pct, 0);
      if (ui.al.some(a => !a.name.trim())) return fail(t('alloc_names'));
      if (!ui.al.length || Math.abs(sum - 100) > 0.01) return fail(t('alloc_need', qn(sum)));
      setMeta('alloc', JSON.stringify(ui.al.map(a => { const isDefault = a.key && (a.name.trim() === I18N.en['al_' + a.key] || a.name.trim() === I18N.sw['al_' + a.key]); return isDefault ? { id: a.id, key: a.key, pct: a.pct } : { id: a.id, name: a.name.trim(), pct: a.pct }; })));
      return true;
    }
  },
  sync: {
    title: () => t('sync_title'), custom: true,
    html() {
      if (DEMO) return `<p class="hint">${t('demo_note')}</p><div class="actions"><button class="btn" type="button" data-act="close">${t('close')}</button></div><div class="msg" id="fmsg"></div>`;
      const d = dirtyCount(), st = !L.syncUrl ? t('sync_none') : L.lastError === 'net' ? t('sync_off') : L.lastError ? t('sync_err') : t('sync_ok');
      const lockd = DEFAULT_URL || (L.linked && !ui.relink), id = (L.syncUrl.match(/\/s\/([^/]+)\//) || [])[1] || L.syncUrl;
      const field = inp('y-url', t('sync_link'), L.syncUrl, 'type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocomplete="off" spellcheck="false"');
      return `<p class="hint">${t(DEFAULT_URL ? 'sync_fixed' : L.linked ? 'sync_linked' : 'sync_hint')}</p>` + (scriptOld() ? `<div class="warnbox">${t('script_old')}</div>` : '') + (lockd ? '' : (L.linked ? `<div class="warnbox">${t('relink_warn')}</div>` : '') + field) +
        `<div class="ledger">${lockd ? `<div><span>${t('sync_link')}</span><span id="linkId">${esc(id.length > 14 ? id.slice(0, 8) + '…' + id.slice(-4) : id)}</span></div>` : ''}<div><span>${t('st_status')}</span><span>${esc(st)}</span></div><div><span>${t('st_last')}</span><span>${esc(ago(L.lastSync))}</span></div><div><span>${t('st_wait')}</span><span>${d}</span></div></div><div class="msg" id="fmsg" role="alert"></div>` +
        `<div class="actions"><button class="btn primary" type="submit" id="syncSave">${t(lockd ? 'sync_now' : 'sync_save')}</button>${L.sheetUrl ? `<a class="btn" href="${esc(L.sheetUrl)}" target="_blank" rel="noopener">${t('open_sheet')}</a>` : ''}${lockd && !DEFAULT_URL ? `<button class="btn" type="button" data-act="relink">${t('change_link')}</button>` : ''}<button class="btn" type="button" data-act="close">${t('cancel')}</button></div>`;
    },
    async save() {
      if (DEMO) return true;
      const url = DEFAULT_URL || ($('#y-url') ? v('y-url').trim() : L.syncUrl);
      if (!validUrl(url)) return fail(t('sync_bad_url'));
      const b = $('#syncSave'), label = b ? b.textContent : ''; if (b) { b.disabled = true; b.textContent = t('sync_busy') + '…'; }
      await idle();
      const prev = { syncUrl: L.syncUrl, cursor: L.cursor, sheetUrl: L.sheetUrl, serverTables: L.serverTables };
      setLink(url); await persistLocal();
      const ok = await sync();
      if (!ok) { const why = errText(); if (url !== prev.syncUrl) { Object.assign(L, prev); await persistLocal(); renderChrome(); } if (b) { b.disabled = false; b.textContent = label; } return fail(why); }
      toast(t('sync_done')); return true;
    }
  }
};
function drawAl() {
  $('#alRows').innerHTML = ui.al.map((a, i) => `<div class="al-row"><input class="al-name" data-i="${i}" value="${esc(a.name)}" aria-label="${t('category')} ${i + 1}" maxlength="40"><span class="pct"><input class="al-pct" data-i="${i}" type="number" inputmode="decimal" min="0" max="100" step="any" value="${a.pct}" aria-label="${t('percent')} ${i + 1}"></span><button type="button" class="icon-btn" data-act="al-del" data-i="${i}" aria-label="${t('remove')}">×</button></div>`).join('');
  totalAl();
}
function readAl() { document.querySelectorAll('#alRows .al-row').forEach((row, i) => { if (!ui.al[i]) return; ui.al[i].name = row.querySelector('.al-name').value; ui.al[i].pct = n(row.querySelector('.al-pct').value); }); }
function totalAl() { const sum = ui.al.reduce((a, x) => a + x.pct, 0), ok = Math.abs(sum - 100) <= 0.01; const el = $('#alTotal'); el.className = 'al-total' + (ok ? '' : ' bad'); el.innerHTML = `<span>${t('alloc_total')}</span><span>${qn(sum)}%</span>`; $('#fmsg').textContent = ok ? '' : t('alloc_need', qn(sum)); }

const NEEDS_UNLOCK = { alloc: 1, purchase: 1, loss: 1 };
function openForm(f, id) {
  const F = FORMS[f]; if (!F) return;
  if (NEEDS_UNLOCK[f] && locked()) { needUnlock(() => openForm(f, id)); return; }
  if (id && F.tb && !get(F.tb, id)) return;
  ui.form = { f, id: id || '' };
  $('#sheet').innerHTML = head(F.title(id)) + `<form id="form" novalidate>${F.html(id)}${F.custom ? '' : foot(id)}</form>`;
  $('#sheet').setAttribute('aria-labelledby', 'sheetTitle');
  $('#sheet').hidden = false; $('#scrim').hidden = false; $('#sheet').scrollTop = 0;
  if (F.init) F.init(id);
  $('#form').addEventListener('submit', async e => {
    e.preventDefault(); $('#fmsg').textContent = '';
    const ok = await F.save(ui.form.id);
    if (ok) { closeForm(); if (!['sync', 'unlock', 'pin', 'pinreset', 'consent', 'calendar', 'notify'].includes(f)) toast(t('saved')); renderAll(); if (typeof ok === 'function') ok(); }
  });
}
function closeForm() { ui.form = null; ui.prefill = null; $('#sheet').hidden = true; $('#scrim').hidden = true; $('#sheet').innerHTML = ''; }
let toastTimer = 0;
function toast(m, ms) { const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2600); }

/* ======================= backup ======================= */
function backup() { download('daftari-backup-' + today() + '.json', 'application/json', JSON.stringify({ app: 'daftari', v: 2, exported: new Date().toISOString(), db: DB })); }
async function restore(file) {
  try {
    const data = JSON.parse(await file.text()); if (!data || data.app !== 'daftari' || !data.db) throw 0;
    let c = 0; TABLES.forEach(tb => { Object.values(data.db[tb] || {}).forEach(r => { if (applyRow(tb, r)) { DB[tb][String(r.id)]._dirty = 1; c++; } }); persist(tb); });
    toast(t('restored', c)); queueSync(); renderAll();
  } catch (e) { toast(t('restore_bad')); }
}

/* ======================= demo shop ======================= */
function seedDemo() {
  TABLES.forEach(tb => { DB[tb] = {}; });
  const now = new Date().toISOString(), td = today(), rec = (tb, o) => { o.id = o.id || uid(); o.createdAt = o.createdAt || now; o.updatedAt = now; DB[tb][o.id] = o; return o.id; };
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }, pick = a => a[Math.floor(rnd() * a.length)];
  if (!BRAND.name) rec('meta', { id: 'business', value: 'Mfano Rabbit Meat' });
  const whole = rec('products', { name: 'Whole rabbit', unit: 'rabbit', price: 25000, cost: 0, description: 'Cleaned, about 2 kg', active: true, trackStock: true, lowAt: 5 });
  const cuts = rec('products', { name: 'Rabbit cuts', unit: 'kg', price: 14000, cost: 0, description: 'Cut to order', active: true, trackStock: true, lowAt: 4 });
  const liver = rec('products', { name: 'Rabbit liver pack', unit: 'pack', price: 5000, cost: 2500, description: '', active: true });
  const supA = rec('suppliers', { name: 'Kibaha Rabbit Farm', phone: '0700 000 101', area: 'Kibaha', notes: 'Whole rabbits, every Monday' });
  const supB = rec('suppliers', { name: 'Bagamoyo Farm', phone: '0700 000 102', area: 'Bagamoyo', notes: 'Cuts and livers' });
  DB.products[whole].supplierId = supA; DB.products[cuts].supplierId = supB; DB.products[liver].supplierId = supB;
  const people = [['Mama Asha', 'Kimara', true], ['Sinza Grill', 'Sinza', true], ['John Mushi', 'Mbezi', true], ['Neema Kweka', 'Ubungo', false], ['Baraka Hotel', 'Kinondoni', true], ['Zuhura Ally', 'Tegeta', false], ['Peter Lyimo', 'Kimara', true], ['Rehema Said', 'Sinza', false]];
  const cust = people.map((p, i) => rec('customers', { createdAt: addDays(td, i < 6 ? -60 : -3) + 'T08:00:00.000Z', name: p[0], phone: '0700 000 ' + String(201 + i), area: p[1], notes: '', offersOk: p[2], offersAt: p[2] ? addDays(td, -30) : '' }));
  for (let w = 5; w >= 0; w--) {
    const d = addDays(td, -w * 7 - 2); if (d > td) continue;
    rec('purchases', { date: d, productId: whole, supplierId: supA, supplier: 'Kibaha Rabbit Farm', qty: 14, cost: 15000, transport: 20000, notes: '' });
    rec('purchases', { date: d, productId: cuts, supplierId: supB, supplier: 'Bagamoyo Farm', qty: 10, cost: 8000, transport: 10000, notes: '' });
  }
  for (let k = 38; k >= 0; k--) {
    const d = addDays(td, -k), count = pd(d).getDay() === 0 ? 1 : 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < count; j++) {
      const r = rnd(), pid = r < 0.55 ? whole : r < 0.9 ? cuts : liver, p = DB.products[pid], c = rnd() < 0.75 ? pick(cust) : '';
      const qty = pid === cuts ? 1 + Math.floor(rnd() * 3) : pid === whole ? 1 + Math.floor(rnd() * 2) : 1;
      rec('sales', { date: d, productId: pid, customerId: c, qty, price: p.price, method: pick(['Cash', 'M-Pesa', 'M-Pesa', 'Mixx by Yas (Tigo Pesa)', 'Airtel Money']), paid: k > 6 || rnd() < 0.8, notes: '' });
    }
  }
  rec('losses', { date: addDays(td, -9), reason: 'Spoiled', productId: cuts, qty: 2, extra: 0, notes: 'Power cut' });
  rec('orders', { due: td, time: '17:00', customerId: cust[1], productId: whole, qty: 4, price: 24000, remind: 60, status: 'open', notes: 'Weekend grill' });
  rec('orders', { due: addDays(td, 1), time: '10:00', customerId: cust[4], productId: cuts, qty: 6, price: 14000, remind: 1440, status: 'open', notes: 'Hotel kitchen' });
  rec('orders', { due: addDays(td, 4), time: '', customerId: cust[0], productId: whole, qty: 2, price: 25000, remind: 60, status: 'open', notes: '' });
  S = stockMap(); [[whole, 6], [cuts, 3]].forEach(([pid, have]) => rec('stock', { date: td, productId: pid, counted: have, delta: have - (S[pid] || 0), notes: '' }));
  TABLES.forEach(persist);
}

/* ======================= tutorial ======================= */
const STEPS = [['home', '.band'], ['home', '.nav'], ['home', '#periodSeg'], ['home', '.kpis'], ['home', '#ledgerPanel'], ['home', '#allocPanel'], ['home', '#chartPanel'], ['sales', '#addBtn'], ['sales', '#list'], ['costs', '#costSeg'], ['customers', '#list'], ['more', '#menuMain'], ['more', '#menuSync'], ['home', '.band']];
const tour = {
  open: false, i: 0, el: null, nodes: null,
  start() {
    closeForm(); this.open = true; ui.salesTab = 'sales'; ui.custTab = 'customers';
    const c = document.createElement('div'); c.className = 'tourcatch';
    const sp = document.createElement('div'); sp.className = 'spot';
    const card = document.createElement('div'); card.className = 'tour bottom'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'tourH');
    card.innerHTML = `<div class="bar"><b id="tourBar"></b></div><span class="cnt" id="tourCnt"></span><h4 id="tourH"></h4><p id="tourP"></p><div class="actions"><button class="btn" type="button" id="tourX">${t('close')}</button><span class="actions"><button class="btn" type="button" id="tourB">${t('prev')}</button><button class="btn primary" type="button" id="tourN">${t('next')}</button></span></div>`;
    document.body.append(c, sp, card); this.nodes = [c, sp, card]; this.sp = sp; this.card = card;
    $('#tourX').onclick = () => this.close(); $('#tourB').onclick = () => this.go(this.i - 1); $('#tourN').onclick = () => this.i === STEPS.length - 1 ? this.close() : this.go(this.i + 1);
    this.onKey = e => { if (e.key === 'Escape') this.close(); else if (e.key === 'ArrowRight') $('#tourN').click(); else if (e.key === 'ArrowLeft' && this.i > 0) this.go(this.i - 1); };
    this.onMove = () => this.place();
    document.addEventListener('keydown', this.onKey); window.addEventListener('scroll', this.onMove, { passive: true }); window.addEventListener('resize', this.onMove);
    this.go(0);
  },
  go(i) {
    this.i = Math.max(0, Math.min(STEPS.length - 1, i)); const st = STEPS[this.i];
    if (ui.view !== st[0]) { ui.view = st[0]; renderAll(); }
    this.el = document.querySelector(st[1]);
    $('#tourCnt').textContent = t('tour_step', this.i + 1, STEPS.length); $('#tourH').textContent = t('t' + (this.i + 1) + 'h'); $('#tourP').textContent = t('t' + (this.i + 1) + 'p');
    $('#tourBar').style.width = ((this.i + 1) / STEPS.length * 100) + '%';
    $('#tourB').disabled = this.i === 0; $('#tourN').textContent = this.i === STEPS.length - 1 ? t('finish') : t('next');
    const fixed = st[1] === '.band' || st[1] === '.nav';
    if (this.el && !fixed) { const r = this.el.getBoundingClientRect(), bandH = $('.band').offsetHeight; window.scrollTo({ top: Math.max(0, r.top + window.scrollY - bandH - 16), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
    else if (!fixed) window.scrollTo(0, 0);
    this.card.className = 'tour ' + (st[1] === '.nav' ? 'top' : 'bottom');
    this.place(); setTimeout(() => this.place(), 350); $('#tourN').focus({ preventScroll: true });
  },
  place() {
    if (!this.open || !this.sp) return; const el = this.el;
    if (!el) { this.sp.style.cssText = 'width:0;height:0;top:50%;left:50%'; return; }
    const r = el.getBoundingClientRect(), p = 5;
    Object.assign(this.sp.style, { top: (r.top - p) + 'px', left: Math.max(2, r.left - p) + 'px', width: Math.min(window.innerWidth - 4, r.width + p * 2) + 'px', height: (r.height + p * 2) + 'px' });
  },
  close() { this.open = false; (this.nodes || []).forEach(x => x.remove()); this.nodes = null; this.sp = null; document.removeEventListener('keydown', this.onKey); window.removeEventListener('scroll', this.onMove); window.removeEventListener('resize', this.onMove); go('home'); }
};

/* ======================= events ======================= */
const ACT = {
  nav: b => { if (b.dataset.v === 'costs' && locked()) { go('costs'); return; } go(b.dataset.v); },
  period: b => { ui.period = b.dataset.p; render(); },
  costtab: b => { ui.costTab = b.dataset.v; ui.limit = 60; render(); },
  salestab: b => { ui.salesTab = b.dataset.v; ui.limit = 60; render(); },
  custtab: b => { ui.custTab = b.dataset.v; ui.limit = 60; render(); },
  orders: () => { ui.salesTab = 'orders'; go('sales'); },
  peopletab: b => { ui.custTab = b.dataset.v; go('customers'); },
  report: () => { if (locked()) needUnlock(() => go('report')); else go('report'); },
  'rep-print': () => window.print(),
  'rep-pdf': b => saveReportPdf(b),
  'rep-share': () => { const D = reportData(ui.repMonth); shareText(t('rep_share_txt', bizName() || 'Daftari', D.r[2], money(D.s.rev), money(D.cash), money(D.s.profit), money(D.owed))); },
  theme: b => { L.theme = b.dataset.v; persistLocal(); renderAll(); },
  lang: b => { L.lang = b.dataset.v; persistLocal(); renderAll(); if (ui.installOpen) showInstall(); else if (!$('#gate').hidden) showGate(); },
  'open-install': () => showInstall(),
  install: async b => { if (!installEvt) return; b.disabled = true; const e = installEvt; installEvt = null; try { e.prompt(); const c = await e.userChoice; if (c && c.outcome === 'accepted') installed = true; } catch (x) {} showInstall(); },
  'skip-install': () => { if (!L.skipInstall) { L.skipInstall = true; persistLocal(); } window.__daftari.ready = proceed(); },
  new: b => { ui.prefill = b.dataset.pid ? { pid: b.dataset.pid } : null; openForm(b.dataset.f); },
  edit: b => openForm(b.dataset.f, b.dataset.id),
  form: b => { ui.relink = false; openForm(b.dataset.f); },
  relink: () => { ui.relink = true; openForm('sync'); },
  close: () => closeForm(),
  more: () => { ui.limit += 100; render(); },
  tour: () => { if (tour.open) tour.close(); else tour.start(); },
  paid: b => { const s = get('sales', b.dataset.id); if (s) { put('sales', Object.assign({}, s, { paid: true })); toast(t('saved')); renderAll(); } },
  deliver: b => { const o = get('orders', b.dataset.id); if (!o) return; ui.prefill = { orderId: o.id, customerId: o.customerId, productId: o.productId, qty: o.qty, price: o.price, date: today() }; const pre = ui.prefill; openForm('sale'); ui.prefill = pre; },
  cal: b => openForm('calendar', b.dataset.id),
  ics: b => { const o = get('orders', b.dataset.id); if (o) download('order-' + o.due + '.ics', 'text/calendar', icsFile(o)); },
  unlock: () => needUnlock(() => {}),
  lock: () => { ui.unlocked = false; render(); },
  'pin-off': async () => { const rec = pinRec(); if (rec && !(await verifyPin(v('pin-cur'), rec))) return fail(t('pin_wrong')); setMeta('pin', ''); ui.unlocked = false; closeForm(); toast(t('pin_removed')); renderAll(); },
  'logo-remove': () => { ui.pendingLogo = ''; $('#logoPrev').innerHTML = BRAND.logo ? `<img class="mark logo" src="${esc(BRAND.logo)}" alt="">` : `<span class="mark">${MARK}</span>`; },
  'notify-on': async () => { try { const p = await Notification.requestPermission(); L.notify = p === 'granted'; persistLocal(); if (L.notify) { toast(t('notify_ok')); checkReminders(); } } catch (e) {} openForm('notify'); },
  'notify-off': () => { L.notify = false; persistLocal(); openForm('notify'); },
  'notify-test': () => notifyNow(t('o_notify_title'), t('notify_test_body'), 'test'),
  del: b => {
    const f = ui.form; if (!f || !f.id) return; const F = FORMS[f.f];
    const why = F.canDelete ? F.canDelete(f.id) : ''; if (why) return fail(why);
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = t('confirm_delete'); setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = t('delete'); } }, 4000); return; }
    if (F.onDelete) F.onDelete(f.id); remove(F.tb, f.id); closeForm(); toast(t('deleted')); renderAll();
  },
  'al-add': () => { readAl(); ui.al.push({ id: uid(), key: '', name: '', pct: 0 }); drawAl(); const r = document.querySelectorAll('#alRows .al-name'); r[r.length - 1].focus(); },
  'al-del': b => { readAl(); ui.al.splice(+b.dataset.i, 1); drawAl(); },
  'al-reset': () => { ui.al = DEFAULT_ALLOC.map(a => ({ id: a.id, key: a.key, name: t('al_' + a.key), pct: a.pct })); drawAl(); },
  msgpurpose: b => { ui.msgPurpose = b.dataset.v; render(); },
  msgaud: b => { ui.msgAudience = b.dataset.v; render(); },
  msgchannel: b => { ui.msgChannel = b.dataset.v; render(); },
  msent: b => { const m = msgState(); if (!m.sent.includes(b.dataset.num)) { m.sent.push(b.dataset.num); persistLocal(); } setTimeout(refreshMsg, 400); },
  'msg-restart': () => { msgState().sent = []; persistLocal(); refreshMsg(); },
  'msg-share': async () => { const text = generic(msgState()); if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } } window.open(waLink('', text), '_blank'); },
  vcf: () => { const list = msgRecipients(); download('customers.vcf', 'text/vcard', list.map(r => ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + vcEsc(r.c.name), 'N:' + vcEsc(r.c.name) + ';;;;', 'TEL;TYPE=CELL:+' + r.num, 'NOTE:' + vcEsc(bizName() || 'Daftari'), 'END:VCARD'].join('\r\n')).join('\r\n') + '\r\n'); },
  'post-copy': async () => { const ok = await clip(v('postCaption')); $('#postMsg').textContent = ok ? t('post_copied') : ''; },
  'post-share': async () => {
    const text = v('postCaption'), files = ui.postFiles, msg = $('#postMsg');
    if (!text && !files.length) { msg.textContent = t('post_need'); return; }
    const copied = text ? await clip(text) : false;
    const data = files.length ? { files, text } : { text };
    if (navigator.share && (!files.length || (navigator.canShare && navigator.canShare({ files })))) { try { await navigator.share(data); msg.textContent = copied ? t('post_copied') : ''; return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    msg.textContent = t('post_noshare');
  },
  backup: () => needUnlock(backup),
  restore: () => { const f = $('#restoreFile'); if (f) f.click(); },
  'demo-reset': () => { seedDemo(); L.msg = {}; L.notified = {}; ui.unlocked = false; persistLocal(); toast(t('saved')); renderAll(); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; const fn = ACT[b.dataset.act]; if (fn) fn(b, e); });
let msgSave = 0;
async function shareText(text) { if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } } if (await clip(text)) toast(t('copied')); }
/* Report settings: month redraws the report, the other two are kept on this phone. */
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'r-for' || id === 'r-notes') { if (id === 'r-for') L.repFor = e.target.value; else { L.repNotes = L.repNotes || {}; L.repNotes[ui.repMonth] = e.target.value; } persistLocal(); $('#report').innerHTML = reportHtml(ui.repMonth, L.repFor || '', (L.repNotes || {})[ui.repMonth] || ''); return; }
  if (id === 'r-month') { ui.repMonth = e.target.value; render(); return; }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'q') { ui.q[el.dataset.q] = el.value; ui.limit = 60; $('#list').innerHTML = el.dataset.q === 'sales' ? listSales() : el.dataset.q === 'suppliers' ? listSuppliers() : listCustomers(); }
  if (el.id === 'm-text') { msgState().text = el.value; clearTimeout(msgSave); msgSave = setTimeout(persistLocal, 400); refreshMsg(); }
  if (el.id === 'postCaption') { L.post = el.value; clearTimeout(msgSave); msgSave = setTimeout(persistLocal, 400); const a = $('#postWa'); if (a) a.href = waLink('', el.value); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'restoreFile' && el.files[0]) restore(el.files[0]);
  if (el.id === 'm-area') { ui.msgArea = el.value; render(); }
  if (el.id === 'postFiles') { ui.postFiles = [...el.files]; $('#thumbs').innerHTML = thumbs(); }
  if (el.id === 'postProduct' && el.value) { const p = get('products', el.value), c = $('#postCaption'); if (p && c) { c.value = (c.value ? c.value.replace(/\s+$/, '') + '\n' : '') + p.name + ': ' + money(n(p.price)) + (p.unit ? ' / ' + p.unit : ''); c.dispatchEvent(new Event('input', { bubbles: true })); } el.value = ''; }
});
$('#scrim').addEventListener('click', closeForm);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.form && !tour.open) closeForm(); });

/* ======================= boot ======================= */
async function boot() {
  await store.open();
  const got = await Promise.all([store.get('local')].concat(TABLES.map(tb => store.get('t_' + tb))));
  if (got[0]) Object.assign(L, got[0]);
  L.notified = L.notified || {}; L.msg = L.msg || {};
  TABLES.forEach((tb, i) => { if (got[i + 1]) DB[tb] = got[i + 1]; });
  applyTheme();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (L.linked === undefined) L.linked = !!(L.syncUrl && L.lastSync);
  if (DEFAULT_URL && L.syncUrl !== DEFAULT_URL) { const was = L.linked; setLink(DEFAULT_URL); L.linked = was; persistLocal(); }
  if (DEMO && !rows('products').length) seedDemo();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('online', () => { syncState = ''; renderChrome(); if (ui.installOpen) return; if (!L.linked) { if (DEFAULT_URL) gateConnect(); } else sync(); });
  window.addEventListener('offline', () => renderChrome());
  let rz = 0, lastW = window.innerWidth; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (ui.view === 'home') render(); } }, 200); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { ui.hiddenAt = Date.now(); return; }
    if (ui.unlocked && ui.hiddenAt && Date.now() - ui.hiddenAt > 5 * 60000) { ui.unlocked = false; if (!ui.form) render(); }
    if (L.linked) sync(); checkReminders();
  });
  setInterval(() => { if (document.visibilityState === 'visible' && !ui.form && L.linked) sync(); }, 120000);
  setInterval(() => { if (document.visibilityState === 'visible') checkReminders(); }, 30000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  if (DEMO) { lock(false); renderAll(); checkReminders(); return; }
  if (!standalone() && !L.skipInstall) showInstall(); else await proceed();
  checkReminders();
}
window.__daftari = { get DB() { return DB; }, get L() { return L; }, ui, sync, checkReminders, ready: boot() };
})();
