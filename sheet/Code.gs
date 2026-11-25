/**
 * DAFTARI – Google Sheet copy
 *
 * The phone app keeps its data on the phone. This script lets it also keep a copy in this
 * Google Sheet, and lets several phones share the same records.
 *
 * Set-up (once):
 *   1. Paste this file into Extensions > Apps Script (replace everything in Code.gs).
 *   2. Choose "setup" in the toolbar dropdown and press Run.
 *   3. Deploy > Manage deployments > edit > Version: New version > Deploy
 *      (or Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone).
 *   4. Copy the Web app URL and paste it in the app under More > Google Sheet copy.
 *
 * View the Sheet freely, but make changes in the app, not here.
 */

// Column types: s = text, n = number, b = Yes/No (blank means Yes), f = Yes/No (blank means No).
// Columns from hideFrom onwards are hidden helpers. A fourth item lists older header names for the same column.
// Columns are matched by their header, so a Sheet made by an older version is rearranged on the first sync.
const TABLES = {
  sales: { sheet: 'Sales', hideFrom: 'id', cols: [
    ['date', 'Date', 's'], ['productName', 'Product', 's'], ['customerName', 'Customer', 's'], ['qty', 'Quantity', 'n'], ['price', 'Price each (TZS)', 'n'],
    ['total', 'Total (TZS)', 'n'], ['method', 'Paid with', 's'], ['paid', 'Paid', 'b'], ['notes', 'Notes', 's'],
    ['id', 'ID', 's'], ['productId', 'Product ID', 's'], ['customerId', 'Customer ID', 's'], ['createdAt', 'Created', 's'], ['updatedAt', 'Updated', 's']] },
  purchases: { sheet: 'Purchases', hideFrom: 'id', cols: [
    ['date', 'Date', 's'], ['productName', 'Product', 's'], ['supplier', 'Bought from', 's'], ['qty', 'Quantity', 'n'], ['cost', 'Cost each (TZS)', 'n'],
    ['transport', 'Transport (TZS)', 'n'], ['total', 'Total (TZS)', 'n'], ['notes', 'Notes', 's'],
    ['id', 'ID', 's'], ['productId', 'Product ID', 's'], ['supplierId', 'Supplier ID', 's'], ['createdAt', 'Created', 's'], ['updatedAt', 'Updated', 's']] },
  losses: { sheet: 'Losses', hideFrom: 'id', cols: [
    ['date', 'Date', 's'], ['reason', 'What happened', 's'], ['productName', 'Product', 's'], ['qty', 'Quantity lost', 'n'], ['extra', 'Other money lost (TZS)', 'n'],
    ['lossValue', 'Loss (TZS)', 'n'], ['notes', 'Notes', 's'],
    ['id', 'ID', 's'], ['productId', 'Product ID', 's'], ['createdAt', 'Created', 's'], ['updatedAt', 'Updated', 's']] },
  customers: { sheet: 'Customers', hideFrom: 'id', cols: [
    ['name', 'Name', 's'], ['phone', 'Phone', 's'], ['area', 'Location', 's', ['Area']], ['notes', 'Notes', 's'], ['offersOk', 'Agreed to offers', 'f'], ['offersAt', 'Agreed on', 's'],
    ['id', 'ID', 's'], ['createdAt', 'Created', 's'], ['updatedAt', 'Updated', 's']] },
  suppliers: { sheet: 'Suppliers', hideFrom: 'id', cols: [
    ['name', 'Name', 's'], ['phone', 'Phone', 's'], ['area', 'Location', 's'], ['notes', 'What they supply', 's'],
    ['id', 'ID', 's'], ['createdAt', 'Created', 's'], ['updatedAt', 'Updated', 's']] },
  orders: { sheet: 'Orders', hideFrom: 'id', cols: [
    ['due', 'Due date', 's'], ['time', 'Time', 's'], ['customerName', 'Customer', 's'], ['productName', 'Product', 's'], ['qty', 'Quantity', 'n'], ['price', 'Price each (TZS)', 'n'],
    ['total', 'Total (TZS)', 'n'], ['status', 'Status', 's'], ['remind', 'Remind (minutes before)', 'n'], ['notes', 'Notes', 's'],
    ['id', 'ID', 's'], ['customerId', 'Customer ID', 's'], ['productId', 'Product ID', 's'], ['saleId', 'Sale ID', 's'], ['createdAt', 'Created', 's'], ['updatedAt', 'Updated', 's']] },
  stock: { sheet: 'Stock counts', hideFrom: 'id', cols: [
    ['date', 'Date', 's'], ['productName', 'Product', 's'], ['counted', 'Counted', 'n'], ['delta', 'Change against the book', 'n'], ['notes', 'Notes', 's'],
    ['id', 'ID', 's'], ['productId', 'Product ID', 's'], ['createdAt', 'Created', 's'], ['updatedAt', 'Updated', 's']] },
  products: { sheet: 'Products', hideFrom: 'id', cols: [
    ['name', 'Product', 's'], ['unit', 'Sold by', 's'], ['price', 'Selling price (TZS)', 'n'], ['cost', 'Usual cost (TZS)', 'n'], ['description', 'Description', 's'], ['active', 'Available', 'b'],
    ['trackStock', 'Count stock', 'f'], ['lowAt', 'Warn when stock is at', 'n'], ['supplierName', 'Supplier', 's'],
    ['id', 'ID', 's'], ['supplierId', 'Supplier ID', 's'], ['createdAt', 'Created', 's'], ['updatedAt', 'Updated', 's']] },
  meta: { sheet: 'Settings', hideFrom: 'updatedAt', cols: [
    ['id', 'Setting', 's'], ['value', 'Value', 's'], ['updatedAt', 'Updated', 's']] }
};
const DELETED = '_deleted';

/* ---------------- web app ---------------- */
function doGet() {
  return ContentService.createTextOutput('Daftari sync is running. Paste this page\'s address into the app: More > Google Sheet copy.');
}
function doPost(e) {
  var out;
  try { out = syncAll_(JSON.parse(e.postData.contents)); }
  catch (err) { out = { ok: false, error: String((err && err.message) || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- setup: run once from the editor ---------------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  Object.keys(TABLES).forEach(function (name) { ensureSheet_(ss, TABLES[name]); });
  ensureDeleted_(ss);
  migrateOld_(ss);
  ['Sheet1', 'Karatasi1'].forEach(function (n) { const s = ss.getSheetByName(n); if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s); });
}
function ensureDeleted_(ss) {
  let d = ss.getSheetByName(DELETED);
  if (!d) { d = ss.insertSheet(DELETED); d.getRange(1, 1, 1, 4).setValues([['table', 'id', 'updatedAt', '_synced']]); d.getRange(1, 1, d.getMaxRows(), 3).setNumberFormat('@'); d.hideSheet(); }
  return d;
}
/* An older Sheet may hold fewer columns, or the same ones in another order: rewrite it in today's layout, matching by header. */
function relayout_(sh, T) {
  const w = T.cols.length + 1, want = T.cols.map(function (c) { return c[1]; }).concat(['_synced']);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const same = want.every(function (h, i) { return head[i] === h; }) && head.slice(w).every(function (h) { return h === ''; });
  if (same) return false;
  const keys = head.map(function (h) { if (h === '_synced') return '_synced'; const c = T.cols.filter(function (c) { return c[1] === h || (c[3] && c[3].indexOf(h) >= 0); })[0]; return c ? c[0] : null; });
  const n = Math.max(0, sh.getLastRow() - 1);
  const data = n ? sh.getRange(2, 1, n, lastCol).getValues() : [];
  const objs = data.map(function (r) { const o = {}; keys.forEach(function (k, i) { if (k) o[k] = r[i]; }); return o; }).filter(function (o) { return o.id !== undefined && o.id !== ''; });
  if (sh.getMaxColumns() < Math.max(w, lastCol)) sh.insertColumnsAfter(sh.getMaxColumns(), Math.max(w, lastCol) - sh.getMaxColumns());
  sh.showColumns(1, sh.getMaxColumns());
  sh.getRange(1, 1, n + 1, Math.max(w, lastCol)).clearContent();
  return objs;
}
function ensureSheet_(ss, T) {
  let sh = ss.getSheetByName(T.sheet);
  if (!sh) sh = ss.insertSheet(T.sheet);
  const moved = sh.getLastRow() > 0 ? relayout_(sh, T) : false;
  const w = T.cols.length + 1;
  if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
  const head = T.cols.map(function (c) { return c[1]; }).concat(['_synced']);
  sh.getRange(1, 1, 1, w).setValues([head]).setFontWeight('bold').setBackground('#111111').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  const rowsN = sh.getMaxRows();
  T.cols.forEach(function (c, i) { sh.getRange(1, i + 1, rowsN, 1).setNumberFormat(c[2] === 'n' ? '#,##0.##' : '@'); });
  sh.getRange(1, w, rowsN, 1).setNumberFormat('0');
  const from = T.cols.map(function (c) { return c[0]; }).indexOf(T.hideFrom);
  if (from >= 0) sh.hideColumns(from + 1, w - from);
  if (moved && moved.length) {
    if (sh.getMaxRows() < moved.length + 1) sh.insertRowsAfter(sh.getMaxRows(), moved.length + 1 - sh.getMaxRows() + 200);
    sh.getRange(2, 1, moved.length, w).setValues(moved.map(function (o) { return T.cols.map(function (c) { const v = o[c[0]]; return v === undefined ? '' : v; }).concat([Number(o._synced) || 0]); }));
  }
  return sh;
}

/* ---------------- sync ---------------- */
function syncAll_(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const props = PropertiesService.getScriptProperties();
    const ss = book_();
    const since = Number(req.since) || 0;
    const now = Math.max(Date.now(), (Number(props.getProperty('STAMP')) || 0) + 1);
    const out = { ok: true, now: now, rows: {}, deleted: [], sheetUrl: ss.getUrl(), tables: Object.keys(TABLES), version: 2 };

    // deleted records ("tombstones")
    const dsh = ensureDeleted_(ss);
    const dn = dsh.getLastRow() - 1;
    const tomb = {};
    (dn > 0 ? dsh.getRange(2, 1, dn, 4).getValues() : []).forEach(function (r) {
      if (r[0] === '' || r[1] === '') return;
      tomb[r[0] + '/' + r[1]] = { t: String(r[0]), id: String(r[1]), updatedAt: text_(r[2]), synced: Number(r[3]) || 0 };
    });
    let tombChanged = false;

    Object.keys(TABLES).forEach(function (name) {
      const T = TABLES[name];
      const sh = ensureLayout_(ss, T);
      const w = T.cols.length + 1;
      const oldN = Math.max(0, sh.getLastRow() - 1);
      let rows = (oldN ? sh.getRange(2, 1, oldN, w).getValues() : []).map(function (r) { return fromRow_(T, r); }).filter(function (o) { return o.id; });
      const idx = {}; rows.forEach(function (o, i) { idx[o.id] = i; });
      const incoming = (req.changes && req.changes[name]) || [];
      const accepted = {}, bounce = [];
      let changed = false;

      incoming.forEach(function (inc) {
        if (!inc || !inc.id) return;
        const id = String(inc.id), u = String(inc.updatedAt || '');
        const cur = idx[id] !== undefined ? rows[idx[id]] : null;
        const tb = tomb[name + '/' + id];
        if (inc.deleted) {
          if (cur && cur.updatedAt > u) { bounce.push(cur); return; }
          if (cur) { rows[idx[id]] = null; delete idx[id]; changed = true; }
          if (!tb || tb.updatedAt < u) { tomb[name + '/' + id] = { t: name, id: id, updatedAt: u, synced: now, mine: true }; tombChanged = true; }
          return;
        }
        if (tb && tb.updatedAt > u) { tb.tell = true; return; }
        if (cur && cur.updatedAt > u) { bounce.push(cur); return; }
        const o = clean_(T, inc); o._synced = now;
        if (cur) rows[idx[id]] = o; else { idx[id] = rows.length; rows.push(o); }
        accepted[id] = true; changed = true;
      });

      rows = rows.filter(function (o) { return o; });
      if (changed) write_(sh, T, rows, oldN);
      const pull = rows.filter(function (o) { return o._synced > since && !accepted[o.id]; })
        .concat(bounce.filter(function (o) { return !(o._synced > since); }));
      if (pull.length) out.rows[name] = pull;
    });

    const all = Object.keys(tomb).map(function (k) { return tomb[k]; });
    if (tombChanged) {
      if (dsh.getMaxRows() < all.length + 1) dsh.insertRowsAfter(dsh.getMaxRows(), all.length + 1 - dsh.getMaxRows() + 200);
      dsh.getRange(2, 1, all.length, 4).setValues(all.map(function (x) { return [x.t, x.id, x.updatedAt, x.synced]; }));
    }
    all.forEach(function (x) { if (x.tell || (x.synced > since && !x.mine)) out.deleted.push({ t: x.t, id: x.id, updatedAt: x.updatedAt }); });

    props.setProperty('STAMP', String(now));
    return out;
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- helpers ---------------- */
/* Cheap check on every sync: a missing tab is made, and a tab in an older layout is rearranged. */
function ensureLayout_(ss, T) {
  const sh = ss.getSheetByName(T.sheet);
  if (!sh) return ensureSheet_(ss, T);
  const w = T.cols.length + 1, last = sh.getLastColumn();
  const head = last ? sh.getRange(1, 1, 1, Math.max(last, w)).getValues()[0].map(String) : [];
  const ok = T.cols.every(function (c, i) { return head[i] === c[1]; }) && head[w - 1] === '_synced' && head.slice(w).every(function (h) { return h === ''; });
  return ok ? sh : ensureSheet_(ss, T);
}
function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function text_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  return String(v);
}
function fromRow_(T, r) {
  const o = {};
  T.cols.forEach(function (c, i) {
    let v = r[i];
    if (c[2] === 'n') v = Number(v) || 0;
    else if (c[2] === 'b') v = !(v === false || /^(no|hapana|false)$/i.test(String(v)));
    else if (c[2] === 'f') v = v === true || /^(yes|ndiyo|true)$/i.test(String(v));
    else if (c[0] === 'date' && Object.prototype.toString.call(v) === '[object Date]') v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    else v = text_(v);
    o[c[0]] = v;
  });
  o._synced = Number(r[T.cols.length]) || 0;
  return o;
}
function clean_(T, inc) {
  const o = {};
  T.cols.forEach(function (c) {
    const v = inc[c[0]];
    if (c[2] === 'n') o[c[0]] = Number(v) || 0;
    else if (c[2] === 'b') o[c[0]] = !(v === false || v === 'false' || v === 'No');
    else if (c[2] === 'f') o[c[0]] = v === true || v === 'true' || v === 'Yes';
    else o[c[0]] = v === null || v === undefined ? '' : String(v);
  });
  return o;
}
function cell_(c, v) {
  if (c[2] === 'n') return Number(v) || 0;
  if (c[2] === 'b') return v === false ? 'No' : 'Yes';
  if (c[2] === 'f') return v === true ? 'Yes' : 'No';
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;   // never let text be read as a formula
}
function write_(sh, T, rows, oldN) {
  const w = T.cols.length + 1;
  if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows() + 200);
  if (rows.length) sh.getRange(2, 1, rows.length, w).setValues(rows.map(function (o) { return T.cols.map(function (c) { return cell_(c, o[c[0]]); }).concat([o._synced || 0]); }));
  if (oldN > rows.length) sh.getRange(2 + rows.length, 1, oldN - rows.length, w).clearContent();
}

/* ---------------- one-time move of records from the first (Swahili) version of the Sheet ---------------- */
function migrateOld_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('MIGRATED')) return;
  const old = { sales: ss.getSheetByName('Mauzo'), stock: ss.getSheetByName('Manunuzi'), losses: ss.getSheetByName('Hasara'), customers: ss.getSheetByName('Wateja'), settings: ss.getSheetByName('Mipangilio') };
  if (!old.sales && !old.stock && !old.customers && !old.losses) { props.setProperty('MIGRATED', 'none'); return; }
  const hasNew = ['sales', 'purchases', 'losses', 'customers', 'products'].some(function (n) { return ss.getSheetByName(TABLES[n].sheet).getLastRow() > 1; });
  if (hasNew) { props.setProperty('MIGRATED', 'skipped'); return; }

  const read = function (sh, w) { if (!sh) return []; const n = sh.getLastRow() - 1; return n > 0 ? sh.getRange(2, 1, n, w).getValues().filter(function (r) { return r[0] !== ''; }) : []; };
  const nowIso = new Date().toISOString();
  const stamp = Math.max(Date.now(), (Number(props.getProperty('STAMP')) || 0) + 1);
  const day = function (v) { return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v); };
  const phone = function (v) { const s = String(v == null ? '' : v).trim(); return /^[67]\d{8}$/.test(s) ? '0' + s : s; };
  const reasons = { 'Nyama iliharibika': 'Spoiled', 'Meat spoiled': 'Spoiled', 'Died before sale': 'Spoiled', 'Iliharibika njiani': 'Damaged in transit', 'Damaged in transport': 'Damaged in transit',
    'Imepotea au kuibiwa': 'Missing or stolen', 'Mteja hakulipa': 'Customer never paid', 'Nyingine': 'Other' };
  const price = old.settings ? Number(old.settings.getRange('B2').getValue()) || 0 : 0;
  const PID = 'rabbit';
  const put = function (name, list) { if (list.length) write_(ss.getSheetByName(TABLES[name].sheet), TABLES[name], list.map(function (o) { o.updatedAt = nowIso; o._synced = stamp; return o; }), 0); };

  const customers = read(old.customers, 7).map(function (r) { return { id: String(r[0]), name: String(r[1]), phone: phone(r[2]), area: String(r[3]), notes: String(r[4]), createdAt: text_(r[5]) || nowIso }; });
  const names = {}; customers.forEach(function (c) { names[c.id] = c.name; });
  const sales = read(old.sales, 12).map(function (r) {
    return { id: String(r[0]), date: day(r[1]), productId: PID, productName: 'Rabbit', customerId: names[String(r[2])] ? String(r[2]) : '', customerName: names[String(r[2])] || '',
      qty: Number(r[4]) || 0, price: Number(r[5]) || 0, total: (Number(r[4]) || 0) * (Number(r[5]) || 0), method: String(r[7] || 'Cash'), paid: !/^(hapana|no|false)$/i.test(String(r[8])), notes: String(r[9]), createdAt: text_(r[10]) || nowIso };
  });
  const purchases = read(old.stock, 10).map(function (r) {
    return { id: String(r[0]), date: day(r[1]), productId: PID, productName: 'Rabbit', supplier: String(r[2]), qty: Number(r[3]) || 0, cost: Number(r[4]) || 0, transport: Number(r[5]) || 0,
      total: (Number(r[3]) || 0) * (Number(r[4]) || 0) + (Number(r[5]) || 0), notes: String(r[7]), createdAt: text_(r[8]) || nowIso };
  });
  const losses = read(old.losses, 8).map(function (r) {
    const q = Number(r[3]) || 0;
    return { id: String(r[0]), date: day(r[1]), reason: reasons[String(r[2])] || String(r[2]), productId: q ? PID : '', productName: q ? 'Rabbit' : '', qty: q, extra: Number(r[4]) || 0, lossValue: 0, notes: String(r[5]), createdAt: text_(r[6]) || nowIso };
  });
  let pq = 0, pc = 0; purchases.forEach(function (p) { pq += p.qty; pc += p.total; });
  const landed = pq > 0 ? pc / pq : 0;
  losses.forEach(function (l) { l.lossValue = Math.round(l.qty * landed + l.extra); });
  put('products', [{ id: PID, name: 'Rabbit', unit: 'rabbit', price: price, cost: 0, description: '', active: true, createdAt: nowIso }]);
  put('customers', customers); put('sales', sales); put('purchases', purchases); put('losses', losses);
  props.setProperty('STAMP', String(stamp));
  props.setProperty('MIGRATED', 'done');
}
