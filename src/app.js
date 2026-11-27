{
'use strict';
/* ============ TIỆN ÍCH ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = n => Math.round(n || 0).toLocaleString('vi-VN');
const vnd = n => fmt(n) + 'đ';
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().trim();
const pad = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeStr = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dateStr = ts => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
function parseMoney(v) {
  let s = String(v ?? '').trim().toLowerCase().replace(/\s/g, '').replace(/đ|d$/, '');
  if (!s) return 0;
  let mult = 1;
  if (/(k|n|ng|nghin|ngan)$/.test(s)) { mult = 1000; s = s.replace(/(k|n|ng|nghin|ngan)$/, ''); }
  else if (/(tr|trieu)$/.test(s)) { mult = 1e6; s = s.replace(/(tr|trieu)$/, ''); }
  if (mult > 1) { const f = parseFloat(s.replace(',', '.')); return isNaN(f) ? 0 : Math.round(f * mult); }
  const n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}
function parseQty(v) { const f = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(f) ? 0 : Math.round(f * 1000) / 1000; }

/* ============ LƯU TRỮ (IndexedDB) ============ */
const STORES = ['products', 'customers', 'orders', 'debts', 'purchases', 'settings'];
let db = null, dbOk = false;
function openDB() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open('sotaphoa', 1);
      rq.onupgradeneeded = () => { const d = rq.result; for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
      rq.onsuccess = () => { db = rq.result; dbOk = true; res(true); };
      rq.onerror = () => res(false);
      rq.onblocked = () => res(false);
    } catch (e) { res(false); }
  });
}
function getAll(store) {
  return new Promise(res => {
    if (!dbOk) return res([]);
    try { const rq = db.transaction(store).objectStore(store).getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); }
    catch (e) { res([]); }
  });
}
function put(store, ...objs) {
  if (!dbOk) { setSave(false); return Promise.resolve(false); }
  return new Promise(res => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const o of objs) os.put(o);
      tx.oncomplete = () => { setSave(true); res(true); };
      tx.onerror = tx.onabort = () => { setSave(false); res(false); };
    } catch (e) { setSave(false); res(false); }
  });
}
function clearAll() {
  if (!dbOk) return Promise.resolve();
  return new Promise(res => {
    try { const tx = db.transaction(STORES, 'readwrite'); for (const s of STORES) tx.objectStore(s).clear(); tx.oncomplete = () => res(); tx.onerror = () => res(); }
    catch (e) { res(); }
  });
}
function setSave(ok) {
  const el = $('#saveState');
  el.textContent = ok ? 'Đã lưu trên máy' : 'Chưa lưu được!';
  el.style.background = ok ? '' : '#ffcc00';
  el.style.color = ok ? '' : '#1a1714';
}

/* ============ DỮ LIỆU TRONG BỘ NHỚ ============ */
const S = { products: [], customers: [], orders: [], debts: [], purchases: [], settings: {} };
const DEFAULT_SETTINGS = { id: 'main', shopName: 'Tiệm tạp hoá', bankBin: '', bankAcc: '', bankHolder: '', big: false, taxThreshold: 1000000000, otherMargin: 15, lastBackup: 0, sampled: false };
const prodById = id => S.products.find(p => p.id === id);
const tracked = p => p.stock != null && p.stock !== '';
const isLow = p => tracked(p) && p.minStock > 0 && p.stock <= p.minStock && p.stock > 0;
const isOut = p => tracked(p) && p.stock <= 0;
const custById = id => S.customers.find(c => c.id === id);
const activeProducts = () => S.products.filter(p => !p.deleted);
function balanceOf(cid) { let b = 0; for (const d of S.debts) if (d.customerId === cid && !d.canceled) b += d.type === 'add' ? d.amount : -d.amount; return b; }
function saveSettings() { return put('settings', S.settings); }

/* ============ NGHIỆP VỤ ============ */
let cart = [];
try { cart = JSON.parse(localStorage.getItem('stp-cart') || '[]'); } catch (e) { cart = []; }
function saveCart() { try { localStorage.setItem('stp-cart', JSON.stringify(cart)); } catch (e) {} renderCartBar(); }
const cartTotal = () => cart.reduce((s, i) => s + i.price * i.qty, 0);
const cartCount = () => cart.reduce((s, i) => s + i.qty, 0);
function addToCart(p, qty = 1) {
  const line = cart.find(i => i.pid && i.pid === p.id);
  if (line) line.qty = Math.round((line.qty + qty) * 1000) / 1000;
  else cart.push({ key: uid(), pid: p.id, name: p.name, unit: p.unit || '', price: p.price, cost: p.cost ?? null, qty });
  saveCart();
}
function addQuick(amount, name) {
  cart.push({ key: uid(), pid: null, name: name || 'Hàng khác', unit: '', price: amount, cost: null, qty: 1 });
  saveCart();
}
function lineCost(i) {
  const m = (S.settings.otherMargin ?? 15) / 100;
  return i.cost != null && i.cost > 0 ? i.cost : Math.round(i.price * (1 - m));
}
async function checkout({ cash = 0, bank = 0, debt = 0, customerId = null }) {
  const total = cartTotal();
  const order = { id: uid(), at: Date.now(), items: cart.map(i => ({ pid: i.pid, name: i.name, unit: i.unit, qty: i.qty, price: i.price, cost: i.cost })), total, pay: { cash, bank, debt }, customerId, canceled: false };
  S.orders.push(order);
  const changed = [];
  for (const it of order.items) {
    const p = it.pid && prodById(it.pid);
    if (p) { if (tracked(p)) p.stock = Math.round((p.stock - it.qty) * 1000) / 1000; p.sold = (p.sold || 0) + it.qty; p.updatedAt = Date.now(); changed.push(p); }
  }
  if (changed.length) await put('products', ...changed);
  if (debt > 0 && customerId) {
    const d = { id: uid(), customerId, type: 'add', amount: debt, note: 'Mua hàng', orderId: order.id, at: order.at };
    S.debts.push(d); await put('debts', d);
  }
  await put('orders', order);
  cart = []; saveCart();
  return order;
}
async function cancelOrder(o) {
  if (o.canceled) return;
  o.canceled = true; o.canceledAt = Date.now();
  const changed = [];
  for (const it of o.items) {
    const p = it.pid && prodById(it.pid);
    if (p) { if (tracked(p)) p.stock = Math.round((p.stock + it.qty) * 1000) / 1000; p.sold = Math.max(0, (p.sold || 0) - it.qty); changed.push(p); }
  }
  if (changed.length) await put('products', ...changed);
  const ds = S.debts.filter(d => d.orderId === o.id && !d.canceled);
  for (const d of ds) d.canceled = true;
  if (ds.length) await put('debts', ...ds);
  await put('orders', o);
}
async function savePurchase({ lines, supplierId, paid, note }) {
  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const pu = { id: uid(), at: Date.now(), items: lines.map(l => ({ pid: l.pid, name: l.name, qty: l.qty, cost: l.cost })), total, paid, supplierId, note, canceled: false };
  const changed = [];
  for (const l of lines) {
    const p = prodById(l.pid); if (!p) continue;
    const st = Math.max(0, tracked(p) ? p.stock : 0), oc = p.cost || l.cost;
    p.cost = st + l.qty > 0 ? Math.round((st * oc + l.qty * l.cost) / (st + l.qty)) : l.cost;
    p.stock = Math.round(((tracked(p) ? p.stock : 0) + l.qty) * 1000) / 1000; p.updatedAt = Date.now();
    changed.push(p);
  }
  S.purchases.push(pu);
  await put('purchases', pu);
  if (changed.length) await put('products', ...changed);
  const owe = total - paid;
  if (owe > 0 && supplierId) { const d = { id: uid(), customerId: supplierId, type: 'add', amount: owe, note: 'Nhập hàng', purchaseId: pu.id, at: pu.at }; S.debts.push(d); await put('debts', d); }
  return pu;
}

/* ============ VIETQR ============ */
const BANKS = [['970436','Vietcombank'],['970415','VietinBank'],['970418','BIDV'],['970405','Agribank'],['970407','Techcombank'],['970422','MB Bank'],['970416','ACB'],['970432','VPBank'],['970403','Sacombank'],['970423','TPBank'],['970441','VIB'],['970443','SHB'],['970437','HDBank'],['970448','OCB'],['970426','MSB'],['970440','SeABank'],['970449','LPBank'],['970431','Eximbank'],['970428','Nam A Bank'],['970409','Bac A Bank'],['970452','KienlongBank'],['970412','PVcomBank'],['970425','ABBANK'],['970419','NCB'],['970427','VietABank'],['970400','Saigonbank'],['970438','BaoViet Bank'],['970433','VietBank'],['970408','GPBank']];
function tlv(id, v) { return id + String(v.length).padStart(2, '0') + v; }
function crc16(s) { let c = 0xFFFF; for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; } return c.toString(16).toUpperCase().padStart(4, '0'); }
function vietQR(bin, acc, amount, info) {
  const acct = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', acc)) + tlv('02', 'QRIBFTTA');
  let p = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', acct) + tlv('53', '704');
  if (amount) p += tlv('54', String(Math.round(amount)));
  p += tlv('58', 'VN');
  const msg = norm(info || '').replace(/[^a-z0-9 ]/g, '').toUpperCase().slice(0, 25);
  if (msg) p += tlv('62', tlv('08', msg));
  p += '6304';
  return p + crc16(p);
}
function qrSvg(text) {
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  catch (e) { return '<p>Không tạo được mã QR</p>'; }
}

/* ============ GIAO DIỆN CHUNG ============ */
const ICON = {
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
  scan: '<svg viewBox="0 0 24 24"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M7 9v6M10 9v6M13 9v6M16 9v6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
};
let sheetClose = null;
function openSheet(title, html, onMount, onClose) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-act="closeSheet" aria-label="Đóng">×</button></div>${html}`;
  $('#sheetWrap').hidden = false;
  sheetClose = onClose || null;
  if (onMount) onMount(sh);
  const f = sh.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 60);
}
function closeSheet() { $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; const f = sheetClose; sheetClose = null; if (f) f(); }
function confirmDlg(msg, okText = 'Đồng ý', danger = true) {
  return new Promise(res => {
    openSheet('Xác nhận', `<p style="font-size:1.1rem">${esc(msg)}</p><div class="grid2" style="margin-top:16px"><button class="btn" id="cNo">Thôi</button><button class="btn ${danger ? 'primary' : 'green'}" id="cYes">${esc(okText)}</button></div>`, sh => {
      $('#cNo', sh).onclick = () => { closeSheet(); res(false); };
      $('#cYes', sh).onclick = () => { sheetClose = null; closeSheet(); res(true); };
    }, () => res(false));
  });
}
let toastT = null;
function toast(msg, actText, act) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${actText ? `<button id="tAct">${esc(actText)}</button>` : ''}`;
  t.hidden = false;
  if (actText) $('#tAct').onclick = () => { t.hidden = true; act(); };
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, actText ? 6000 : 2500);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Đã sao chép'); return true; }
  catch (e) { toast('Không sao chép được, hãy chọn chữ và sao chép tay'); return false; }
}
function downloadFile(name, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { toast('Máy không cho tải file, hãy dùng nút Sao chép'); }
}
function exportSheet(title, name, text, mime) {
  openSheet(title, `<p class="muted small">Nếu nút Tải không chạy (một số trình duyệt chặn), bấm Sao chép rồi dán vào Zalo "Cloud của tôi" hoặc ghi chú.</p>
    <div class="grid2"><button class="btn primary" id="xDl">Tải file</button><button class="btn" id="xCp">Sao chép</button></div>
    <textarea class="input" style="margin-top:12px;min-height:140px;font-size:.8rem" readonly>${esc(text.slice(0, 20000))}${text.length > 20000 ? '\n…' : ''}</textarea>`, sh => {
    $('#xDl', sh).onclick = () => downloadFile(name, text, mime);
    $('#xCp', sh).onclick = () => copyText(text);
  });
}

/* ============ ĐIỀU HƯỚNG ============ */
const ui = { q: '', prodFilter: 'all', prodQ: '', noKind: 'kh', noQ: '', period: 'today', orderDay: null };
function route() { const h = (location.hash || '#ban').slice(1); return ['ban', 'hang', 'no', 'baocao', 'them', 'donhang', 'nhaphang', 'caidat'].includes(h) ? h : 'ban'; }
function render() {
  const r = route();
  const tab = ['donhang', 'nhaphang', 'caidat'].includes(r) ? 'them' : r;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  $('#shopName').textContent = S.settings.shopName || 'Sổ Tạp Hoá';
  document.documentElement.classList.toggle('big', !!S.settings.big);
  ({ ban: renderBan, hang: renderHang, no: renderNo, baocao: renderBaoCao, them: renderThem, donhang: renderDonHang, nhaphang: renderNhapHang, caidat: renderCaiDat })[r]();
  renderCartBar(); renderBanner();
}
function renderBanner() {
  const b = $('#banner');
  const s = S.settings;
  if (!dbOk) { b.innerHTML = `<div class="banner"><div class="card small"><b>Trình duyệt này không cho lưu dữ liệu.</b> Mọi thứ sẽ mất khi tải lại trang. Hãy mở app ở trang riêng để dùng thật.</div></div>`; return; }
  const live = S.orders.filter(o => !o.canceled).length;
  if (live >= 5 && Date.now() - (s.lastBackup || 0) > 7 * 864e5) { b.innerHTML = `<div class="banner"><div class="card small row"><span class="grow">Đã hơn 7 ngày chưa sao lưu. Mất máy là mất sổ.</span><a class="btn sm" href="#caidat">Sao lưu</a></div></div>`; return; }
  b.innerHTML = '';
}
function renderCartBar() {
  const el = $('#cartBar');
  if (!cart.length || route() !== 'ban') { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="bar" data-act="openCart"><div class="grow"><div class="small" style="opacity:.75">${fmt(cartCount())} món · bấm để xem</div><div class="money" style="font-size:1.35rem">${vnd(cartTotal())}</div></div><button class="btn primary" data-act="openCart">Tính tiền</button></div>`;
}

/* ============ TÌM KIẾM ============ */
function nameMatch(name, toks) { const ws = norm(name).split(/[^a-z0-9]+/).filter(Boolean); return toks.every(t => ws.some(w => w.startsWith(t))); }
function searchProducts(q, limit = 40) {
  const nq = norm(q); if (!nq) return [];
  const toks = nq.split(/\s+/);
  const out = [];
  for (const p of activeProducts()) {
    if (p.barcode && p.barcode === q.trim()) return [p];
    if (nameMatch(p.name, toks)) out.push(p);
  }
  out.sort((a, b) => (b.sold || 0) - (a.sold || 0));
  return out.slice(0, limit);
}
function topProducts(n = 24) {
  const ps = activeProducts().slice();
  ps.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.sold || 0) - (a.sold || 0) || a.name.localeCompare(b.name, 'vi'));
  return ps.slice(0, n);
}

/* ============ MÀN BÁN HÀNG ============ */
const canScan = 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function tileHtml(p) {
  const inCart = cart.filter(i => i.pid === p.id).reduce((s, i) => s + i.qty, 0);
  const low = isLow(p) || isOut(p);
  return `<button class="tile${low ? ' low' : ''}" data-act="addP" data-id="${esc(p.id)}">
    ${inCart ? `<span class="badge">${fmt(inCart)}</span>` : ''}
    <span>${esc(p.name)}</span>
    <span class="row" style="justify-content:space-between"><span class="p">${fmt(p.price)}</span><span class="s small muted">${p.unit ? esc(p.unit) : ''}</span></span></button>`;
}
function renderBan() {
  const m = $('#main');
  const hasP = activeProducts().length > 0;
  m.innerHTML = `<div class="stack">
    <div class="search">
      <input class="input grow" id="q" type="search" placeholder="Tìm món hoặc quét mã…" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search">
      ${SR ? `<button class="icon-btn" data-act="voice" aria-label="Nói để bán">${ICON.mic}</button>` : ''}
      ${canScan ? `<button class="icon-btn" data-act="scanSell" aria-label="Quét mã vạch">${ICON.scan}</button>` : ''}
    </div>
    <div id="results"></div>
  </div>`;
  const q = $('#q');
  q.addEventListener('input', () => { ui.q = q.value; renderResults(); });
  q.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const v = q.value.trim(); if (!v) return;
    const byCode = activeProducts().find(p => p.barcode && p.barcode === v);
    if (byCode) { addToCart(byCode); toast('Đã thêm ' + byCode.name); q.value = ''; ui.q = ''; renderResults(); return; }
    const r = searchProducts(v); if (r.length === 1) { addToCart(r[0]); toast('Đã thêm ' + r[0].name); q.value = ''; ui.q = ''; renderResults(); }
    else if (/^\d{8,14}$/.test(v)) askNewBarcode(v);
  });
  renderResults();
  if (!hasP && !S.settings.sampled) setTimeout(offerSample, 300);
}
function renderResults() {
  const box = $('#results'); if (!box) return;
  const quick = `<button class="tile quick" data-act="quickSale"><span>Bán nhanh</span><span class="small">Nhập số tiền như máy tính</span></button>`;
  if (ui.q.trim()) {
    const r = searchProducts(ui.q);
    box.innerHTML = r.length ? `<div class="tiles">${r.map(tileHtml).join('')}${quick}</div>`
      : `<div class="empty">Không thấy "${esc(ui.q)}".<div class="row" style="justify-content:center;margin-top:12px;flex-wrap:wrap"><button class="btn primary" data-act="newProduct" data-name="${esc(ui.q)}">+ Thêm món này</button><button class="btn" data-act="quickSale">Bán nhanh</button></div></div>`;
    return;
  }
  const top = topProducts();
  box.innerHTML = top.length ? `<div class="row" style="justify-content:space-between;margin-bottom:8px"><h3>Hay bán</h3><span class="small muted">Ghim món trong Hàng hoá</span></div><div class="tiles">${quick}${top.map(tileHtml).join('')}</div>`
    : `<div class="tiles">${quick}</div><div class="empty">Chưa có món nào. <a href="#hang">Thêm hàng hoá</a> hoặc dùng Bán nhanh.</div>`;
}
function offerSample() {
  if (route() !== 'ban' || !$('#sheetWrap').hidden) return;
  openSheet('Bắt đầu nhanh', `<p>Thêm sẵn khoảng 50 món tạp hoá phổ biến để bán được ngay?</p><p class="muted small">Giá chỉ là giá gợi ý, cô/anh sửa lại theo giá của tiệm. Có thể xoá bất cứ lúc nào.</p>
    <div class="grid2" style="margin-top:14px"><button class="btn" id="sNo">Tự nhập</button><button class="btn primary" id="sYes">Thêm sẵn</button></div>`, sh => {
    $('#sNo', sh).onclick = async () => { S.settings.sampled = true; await saveSettings(); closeSheet(); };
    $('#sYes', sh).onclick = async () => { await addSampleCatalog(); closeSheet(); render(); toast('Đã thêm ' + SAMPLE.length + ' món'); };
  });
}
function openCart() {
  if (!cart.length) return;
  const rows = cart.map(i => `<div class="li" style="cursor:default">
      <div class="grow"><div class="t">${esc(i.name)}</div><button class="btn ghost sm" style="padding:0;min-height:30px;color:var(--red)" data-act="editPrice" data-key="${i.key}">${vnd(i.price)}${i.unit ? ' / ' + esc(i.unit) : ''} ✎</button></div>
      <div class="qty"><button data-act="qtyMinus" data-key="${i.key}" aria-label="Bớt">−</button><button class="n" style="border:0;background:none;width:auto" data-act="qtySet" data-key="${i.key}">${fmt(i.qty)}</button><button data-act="qtyPlus" data-key="${i.key}" aria-label="Thêm">+</button></div>
    </div>`).join('');
  openSheet('Giỏ hàng', `<div class="list">${rows}</div>
    <div class="row" style="justify-content:space-between;margin:16px 2px"><span class="muted">Tổng cộng</span><span class="big-money">${vnd(cartTotal())}</span></div>
    <div class="stack">
      <button class="btn green block" data-act="payCash" style="min-height:58px;font-size:1.15rem">Tiền mặt</button>
      <div class="grid2"><button class="btn block" data-act="payBank">Chuyển khoản (QR)</button><button class="btn block" data-act="payDebt">Ghi nợ</button></div>
      <button class="btn ghost block danger" data-act="clearCart">Xoá giỏ</button>
    </div>`);
}
function refreshCartSheet() { if (!cart.length) { closeSheet(); render(); return; } openCart(); renderCartBar(); }

function keypadSheet(title, { initial = 0, quick = [], note = '', okText = 'Xong', onOk, extraTop = '' }) {
  let val = String(initial || '');
  const draw = () => { $('#kpV').textContent = vnd(parseInt(val || '0', 10)); if ($('#kpExtra') && onChange) onChange(parseInt(val || '0', 10)); };
  let onChange = null;
  openSheet(title, `${extraTop}<div class="card" style="text-align:right"><div class="big-money" id="kpV">0đ</div></div>
    <div id="kpExtra"></div>
    ${quick.length ? `<div class="chips" style="margin:12px 0">${quick.map(q => `<button class="chip" data-v="${q[1]}">${esc(q[0])}</button>`).join('')}</div>` : '<div style="height:12px"></div>'}
    <div class="keys">${['1','2','3','4','5','6','7','8','9','000','0','⌫'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>
    ${note ? `<p class="hint">${esc(note)}</p>` : ''}
    <button class="btn primary block" id="kpOk" style="margin-top:12px;min-height:58px;font-size:1.15rem">${esc(okText)}</button>`, sh => {
    $$('.keys button', sh).forEach(b => b.onclick = () => { const k = b.dataset.k; if (k === '⌫') val = val.slice(0, -1); else if (val.length < 12) val = (val === '0' ? '' : val) + k; draw(); });
    $$('.chips .chip', sh).forEach(b => b.onclick = () => { val = b.dataset.v; draw(); });
    $('#kpOk', sh).onclick = () => onOk(parseInt(val || '0', 10));
    draw();
  });
  return { setOnChange(f) { onChange = f; draw(); } };
}
function payCash() {
  const total = cartTotal();
  const notes = [10000, 20000, 50000, 100000, 200000, 500000];
  const quick = [['Đưa đủ', total], ...notes.filter(n => n > total).slice(0, 4).map(n => [fmt(n), n])];
  const kp = keypadSheet('Khách đưa', { initial: 0, quick, okText: 'Xong — lưu đơn', extraTop: `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="muted">Phải trả</span><span class="money" style="font-size:1.3rem">${vnd(total)}</span></div>`,
    onOk: async given => {
      if (given && given < total) { toast('Khách đưa chưa đủ. Thiếu thì chọn Ghi nợ.'); return; }
      const o = await checkout({ cash: total });
      closeSheet(); render(); doneToast(o, given ? given - total : 0);
    } });
  kp.setOnChange(v => { const c = v - total; $('#kpExtra').innerHTML = v ? `<div class="row" style="justify-content:space-between;margin-top:10px"><span class="muted">${c >= 0 ? 'Tiền thối lại' : 'Còn thiếu'}</span><span class="big-money" style="color:${c >= 0 ? 'var(--green)' : 'var(--red)'}">${vnd(Math.abs(c))}</span></div>` : ''; });
}
function doneToast(o, change) {
  toast(`Đã lưu đơn ${vnd(o.total)}${change > 0 ? ' · thối ' + vnd(change) : ''}`, 'Hoàn tác', async () => { await cancelOrder(o); cart = o.items.map(i => ({ ...i, key: uid() })); saveCart(); render(); toast('Đã huỷ đơn, món đã trả lại giỏ'); });
}
function payBank() {
  const s = S.settings, total = cartTotal();
  if (!s.bankBin || !s.bankAcc) {
    openSheet('Chưa có tài khoản ngân hàng', `<p>Vào Cài đặt nhập ngân hàng và số tài khoản của tiệm để app tự tạo mã QR có sẵn số tiền.</p><div class="grid2" style="margin-top:14px"><a class="btn primary" href="#caidat" data-act="closeSheet">Mở Cài đặt</a><button class="btn" id="bOk">Khách đã chuyển</button></div>`, sh => {
      $('#bOk', sh).onclick = async () => { const o = await checkout({ bank: total }); closeSheet(); render(); doneToast(o, 0); };
    });
    return;
  }
  const info = (s.shopName || 'TAP HOA') + ' ' + timeStr(Date.now()).replace(':', 'h');
  const payload = vietQR(s.bankBin, s.bankAcc, total, info);
  const bank = (BANKS.find(b => b[0] === s.bankBin) || [s.bankBin, 'Ngân hàng'])[1];
  openSheet('Quét mã để trả', `<div class="qr">${qrSvg(payload)}</div>
    <div style="text-align:center;margin-top:12px"><div class="big-money">${vnd(total)}</div><div class="muted">${esc(bank)} · ${esc(s.bankAcc)}${s.bankHolder ? ' · ' + esc(s.bankHolder) : ''}</div></div>
    <p class="card small" style="background:var(--warn-soft);border:0;margin-top:12px"><b>Xem thông báo ngân hàng trên điện thoại của tiệm</b> rồi mới bấm. Đừng tin ảnh chụp màn hình khách đưa.</p>
    <button class="btn green block" id="bOk" style="min-height:58px;font-size:1.15rem">Đã nhận đủ tiền — lưu đơn</button>`, sh => {
    $('#bOk', sh).onclick = async () => { const o = await checkout({ bank: total }); closeSheet(); render(); doneToast(o, 0); };
  });
}
function pickCustomer(kind, title, onPick) {
  const draw = (q) => {
    const nq = norm(q);
    const list = S.customers.filter(c => c.kind === kind && !c.deleted && (!nq || norm(c.name + ' ' + (c.phone || '')).includes(nq)))
      .sort((a, b) => balanceOf(b.id) - balanceOf(a.id)).slice(0, 30);
    $('#pcL').innerHTML = (q.trim() ? `<button class="li" data-new="1"><span class="grow t">+ Thêm "${esc(q.trim())}"</span></button>` : '') +
      list.map(c => `<button class="li" data-id="${esc(c.id)}"><span class="grow"><span class="t">${esc(c.name)}</span>${c.phone ? `<br><span class="small muted">${esc(c.phone)}</span>` : ''}</span><span class="money ${balanceOf(c.id) > 0 ? '' : 'muted'}">${vnd(balanceOf(c.id))}</span></button>`).join('') ||
      (q.trim() ? '' : `<div class="empty">Gõ tên để thêm người mới</div>`);
  };
  openSheet(title, `<input class="input" id="pcQ" placeholder="Gõ tên (vd: Cô Tư đầu hẻm)" autofocus autocomplete="off"><div class="list" id="pcL" style="margin-top:10px"></div>`, sh => {
    const q = $('#pcQ', sh); q.oninput = () => draw(q.value); draw('');
    $('#pcL', sh).onclick = async e => {
      const b = e.target.closest('.li'); if (!b) return;
      if (b.dataset.new) { const c = { id: uid(), name: q.value.trim(), phone: '', kind, at: Date.now() }; S.customers.push(c); await put('customers', c); onPick(c); }
      else onPick(custById(b.dataset.id));
    };
  });
}
function payDebt() {
  const total = cartTotal();
  pickCustomer('kh', 'Ghi nợ cho ai?', c => {
    keypadSheet(`Khách trả trước (nếu có)`, { initial: 0, quick: [['Không trả', 0]], okText: 'Ghi nợ — lưu đơn',
      extraTop: `<div class="card" style="margin-bottom:10px"><b>${esc(c.name)}</b><div class="small muted">Đang nợ ${vnd(balanceOf(c.id))} · đơn này ${vnd(total)}</div></div>`,
      onOk: async pre => {
        pre = Math.min(pre, total);
        const o = await checkout({ cash: pre, debt: total - pre, customerId: c.id });
        closeSheet(); render(); toast(`Đã ghi nợ ${c.name} ${vnd(total - pre)}`, 'Hoàn tác', async () => { await cancelOrder(o); cart = o.items.map(i => ({ ...i, key: uid() })); saveCart(); render(); });
      } });
  });
}
function quickSale() {
  keypadSheet('Bán nhanh', { note: 'Dùng khi bán món chưa có trong danh sách. Lãi được ước tính theo tỉ lệ trong Cài đặt.', okText: 'Thêm vào giỏ',
    onOk: v => { if (!v) return; addQuick(v); closeSheet(); render(); toast('Đã thêm ' + vnd(v)); } });
}

/* ============ GIỌNG NÓI ============ */
const NUMW = { mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10 };
const UNITS = new Set('goi chai lon hop cai bich thung ky kg ki ky qua trai tui cay bao lit vi hu cuon ly tuyp cuc the doi loc ket chuc lo can binh hu'.split(' '));
const STOP = new Set('ban cho toi lay mua va voi them nhe nha a oi con cua di em anh chi co'.split(' '));
function parseVoice(text) {
  const toks = norm(text).replace(/[,.;]/g, ' va ').split(/\s+/).filter(Boolean);
  const segs = []; let cur = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const prev = toks[i - 1];
    const isDigit = /^\d+([.,]\d+)?$/.test(t);
    const isWord = NUMW[t] != null && (i === 0 || prev === 'va' || prev === 'voi' || prev === 'them');
    if (isDigit || isWord) { cur = { qty: isDigit ? parseFloat(t.replace(',', '.')) : NUMW[t], words: [] }; segs.push(cur); continue; }
    if (t === 'va' || t === 'voi') { cur = null; continue; }
    if (STOP.has(t) || UNITS.has(t)) continue;
    if (!cur) { cur = { qty: 1, words: [] }; segs.push(cur); }
    cur.words.push(t);
  }
  return segs.filter(s => s.words.length).map(s => ({ qty: s.qty, query: s.words.join(' '), product: matchProduct(s.words) }));
}
function matchProduct(words) {
  let best = null, bs = 0;
  for (const p of activeProducts()) {
    const nt = norm(p.name).split(/[\s\-()/]+/);
    let hit = 0;
    for (const w of words) if (nt.some(x => x === w || (w.length >= 3 && x.startsWith(w)))) hit++;
    const sc = hit / words.length + hit / (nt.length * 4) + Math.min(p.sold || 0, 100) / 10000;
    if (hit && sc > bs) { bs = sc; best = p; }
  }
  return bs >= 0.5 ? best : null;
}
let rec = null;
function startVoice(btn) {
  if (!SR) return;
  if (rec) { try { rec.stop(); } catch (e) {} return; }
  try {
    rec = new SR(); rec.lang = 'vi-VN'; rec.interimResults = false; rec.maxAlternatives = 1;
    btn.classList.add('rec');
    rec.onresult = e => { const t = e.results[0][0].transcript; showVoice(t); };
    rec.onerror = e => { toast(e.error === 'not-allowed' ? 'Chưa cho phép dùng micro' : 'Không nghe rõ, nói lại nhé'); };
    rec.onend = () => { btn.classList.remove('rec'); rec = null; };
    rec.start(); toast('Đang nghe… nói ví dụ "2 gói mì hảo hảo, 1 chai nước mắm"');
  } catch (e) { rec = null; btn.classList.remove('rec'); toast('Máy không hỗ trợ nói'); }
}
function showVoice(text) {
  const items = parseVoice(text);
  openSheet('Nghe được', `<p class="card">"${esc(text)}"</p>
    <div class="list" style="margin-top:10px">${items.map((it, i) => `<label class="li"><input type="checkbox" data-i="${i}" ${it.product ? 'checked' : 'disabled'} style="width:24px;height:24px">
      <span class="grow"><span class="t">${fmt(it.qty)} × ${it.product ? esc(it.product.name) : `<span style="color:var(--red)">không tìm thấy "${esc(it.query)}"</span>`}</span>${it.product ? `<br><span class="small muted">${vnd(it.product.price * it.qty)}</span>` : ''}</span></label>`).join('') || '<div class="empty">Không nhận ra món nào</div>'}</div>
    <div class="grid2" style="margin-top:14px"><button class="btn" data-act="closeSheet">Bỏ</button><button class="btn primary" id="vOk">Thêm vào giỏ</button></div>`, sh => {
    $('#vOk', sh).onclick = () => {
      let n = 0;
      $$('input[data-i]', sh).forEach(cb => { if (cb.checked) { const it = items[+cb.dataset.i]; addToCart(it.product, it.qty); n++; } });
      closeSheet(); render(); if (n) toast(`Đã thêm ${n} món`);
    };
  });
}

/* ============ QUÉT MÃ VẠCH ============ */
let scanStream = null;
async function openScanner(onCode, title = 'Quét mã vạch') {
  if (!canScan) { toast('Máy này chưa quét được, hãy gõ mã'); return; }
  openSheet(title, `<div class="scan-box"><video id="scV" playsinline muted></video><i></i></div><p class="muted small" style="text-align:center">Đưa mã vạch vào giữa khung</p>`, async sh => {
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = $('#scV', sh); v.srcObject = scanStream; await v.play();
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
      const loop = async () => {
        if (!scanStream) return;
        try { const r = await det.detect(v); if (r.length) { const code = r[0].rawValue; stopScan(); closeSheet(); if (navigator.vibrate) navigator.vibrate(80); onCode(code); return; } } catch (e) {}
        setTimeout(loop, 180);
      };
      loop();
    } catch (e) { stopScan(); closeSheet(); toast('Chưa cho phép dùng camera'); }
  }, stopScan);
}
function stopScan() { if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } }
function askNewBarcode(code) {
  openSheet('Mã chưa có', `<p>Mã <b>${esc(code)}</b> chưa có trong danh sách hàng.</p><div class="grid2" style="margin-top:14px"><button class="btn" data-act="closeSheet">Bỏ qua</button><button class="btn primary" id="nbOk">Thêm món mới</button></div>`, sh => {
    $('#nbOk', sh).onclick = () => editProduct(null, { barcode: code, thenAdd: true });
  });
}

/* ============ MÀN HÀNG HOÁ ============ */
const UNIT_LIST = ['gói', 'chai', 'lon', 'hộp', 'cái', 'bịch', 'thùng', 'kg', 'quả', 'túi', 'cây', 'lốc', 'tuýp', 'cuộn', 'ly', 'vỉ'];
function renderHang() {
  const ps = activeProducts();
  const nq = norm(ui.prodQ);
  let list = ps.filter(p => !nq || nameMatch(p.name, nq.split(/\s+/)) || (p.barcode || '').includes(ui.prodQ.trim()));
  if (ui.prodFilter === 'low') list = list.filter(isLow);
  if (ui.prodFilter === 'out') list = list.filter(isOut);
  if (ui.prodFilter === 'fav') list = list.filter(p => p.fav);
  list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const cnt = f => ({ low: ps.filter(isLow).length, out: ps.filter(isOut).length })[f];
  $('#main').innerHTML = `<div class="stack">
    <div class="row"><h2 class="grow">Hàng hoá <span class="muted small">${ps.length} món</span></h2><button class="btn primary sm" data-act="newProduct">+ Thêm</button></div>
    <div class="search"><input class="input grow" id="pq" type="search" placeholder="Tìm tên hoặc mã" value="${esc(ui.prodQ)}">${canScan ? `<button class="icon-btn" data-act="scanFind" aria-label="Quét">${ICON.scan}</button>` : ''}</div>
    <div class="chips">${[['all', 'Tất cả'], ['fav', 'Ghim'], ['low', `Sắp hết (${cnt('low')})`], ['out', `Hết / âm kho (${cnt('out')})`]].map(([k, l]) => `<button class="chip${ui.prodFilter === k ? ' on' : ''}" data-act="pf" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="list">${list.map(p => {
      const st = p.stock, low = isLow(p);
      return `<button class="li" data-act="editP" data-id="${esc(p.id)}"><span class="grow"><span class="t">${p.fav ? '★ ' : ''}${esc(p.name)}</span><br><span class="small muted">Vốn ${p.cost ? vnd(p.cost) : '—'}${p.barcode ? ' · ' + esc(p.barcode) : ''}</span></span>
        <span style="text-align:right"><span class="money">${vnd(p.price)}</span><br>${tracked(p) ? `<span class="tag ${st <= 0 ? 'red' : low ? 'warn' : ''}">còn ${fmt(st)} ${esc(p.unit || '')}</span>` : '<span class="tag">chưa đếm kho</span>'}</span></button>`;
    }).join('') || `<div class="empty">${ps.length ? 'Không có món phù hợp' : 'Chưa có món nào'}</div>`}</div>
    ${!ps.length ? `<button class="btn block" data-act="sample">Thêm sẵn ~50 món phổ biến (giá gợi ý)</button>` : ''}
  </div>`;
  const q = $('#pq'); q.oninput = () => { ui.prodQ = q.value; const pos = q.selectionStart; renderHang(); const n = $('#pq'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
}
function editProduct(id, opts = {}) {
  const p = id ? prodById(id) : null;
  const v = p || { name: opts.name || '', price: '', cost: '', unit: 'gói', barcode: opts.barcode || '', stock: '', minStock: '', fav: false };
  openSheet(p ? 'Sửa món' : 'Thêm món', `<form id="pf" class="stack">
    <label class="field"><span>Tên món *</span><input class="input" name="name" required value="${esc(v.name)}" ${p ? '' : 'autofocus'} placeholder="vd: Mì Hảo Hảo tôm chua cay"></label>
    <div class="grid2">
      <label class="field"><span>Giá bán *</span><input class="input" name="price" inputmode="decimal" required value="${v.price ? fmt(v.price) : ''}" placeholder="vd: 5k"></label>
      <label class="field"><span>Giá vốn</span><input class="input" name="cost" inputmode="decimal" value="${v.cost ? fmt(v.cost) : ''}" placeholder="để tính lãi"></label>
    </div>
    <p class="hint" style="margin-top:2px">Gõ 5k = 5.000đ, 1,2tr = 1.200.000đ</p>
    <div class="grid2">
      <label class="field"><span>Đơn vị</span><input class="input" name="unit" list="units" value="${esc(v.unit || '')}"></label>
      <label class="field"><span>Mã vạch</span><span class="row" style="gap:6px;margin:0"><input class="input" name="barcode" inputmode="numeric" value="${esc(v.barcode || '')}">${canScan ? `<button type="button" class="icon-btn" id="pfScan" aria-label="Quét">${ICON.scan}</button>` : ''}</span></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Tồn kho hiện có (bỏ trống = không đếm)</span><input class="input" name="stock" inputmode="decimal" value="${v.stock !== '' && v.stock != null ? v.stock : ''}"></label>
      <label class="field"><span>Báo khi còn dưới</span><input class="input" name="minStock" inputmode="decimal" value="${v.minStock || ''}"></label>
    </div>
    <label class="row" style="min-height:44px"><input type="checkbox" name="fav" ${v.fav ? 'checked' : ''} style="width:24px;height:24px"> Ghim lên màn Bán hàng</label>
    <datalist id="units">${UNIT_LIST.map(u => `<option value="${u}">`).join('')}</datalist>
    <button class="btn primary block" type="submit">Lưu</button>
    ${p ? `<div class="grid2"><button type="button" class="btn" id="pfBuy">Nhập thêm hàng</button><button type="button" class="btn danger" id="pfDel">Xoá món</button></div>` : ''}
  </form>`, sh => {
    const f = $('#pf', sh);
    for (const n of ['price', 'cost']) f[n].addEventListener('blur', () => { const x = parseMoney(f[n].value); f[n].value = x ? fmt(x) : ''; });
    if ($('#pfScan', sh)) $('#pfScan', sh).onclick = () => { const keep = readForm(); openScanner(code => { editProduct(id, { ...opts, ...keep, barcode: code, keep: true }); }); };
    if (opts.keep) { for (const k of ['name', 'unit', 'stock', 'minStock']) if (opts[k] != null) f[k].value = opts[k]; for (const k of ['price', 'cost']) if (opts[k]) f[k].value = opts[k]; f.fav.checked = !!opts.fav; }
    function readForm() { return { name: f.name.value, price: f.price.value, cost: f.cost.value, unit: f.unit.value, stock: f.stock.value, minStock: f.minStock.value, fav: f.fav.checked }; }
    f.onsubmit = async e => {
      e.preventDefault();
      const name = f.name.value.trim(), price = parseMoney(f.price.value);
      if (!name || !price) { toast('Cần tên và giá bán'); return; }
      const bc = f.barcode.value.trim();
      const dup = bc && activeProducts().find(x => x.barcode === bc && (!p || x.id !== p.id));
      if (dup) { toast('Mã vạch này đã thuộc "' + dup.name + '"'); return; }
      const o = p || { id: uid(), at: Date.now(), sold: 0 };
      Object.assign(o, { name, price, cost: parseMoney(f.cost.value) || null, unit: f.unit.value.trim(), barcode: bc, stock: f.stock.value.trim() === '' ? null : parseQty(f.stock.value), minStock: parseQty(f.minStock.value), fav: f.fav.checked, updatedAt: Date.now() });
      if (!p) S.products.push(o);
      await put('products', o);
      closeSheet();
      if (opts.thenAdd) { addToCart(o); location.hash = '#ban'; }
      render(); toast(p ? 'Đã lưu' : 'Đã thêm ' + name);
    };
    if (p) {
      $('#pfDel', sh).onclick = async () => { if (await confirmDlg(`Xoá "${p.name}"? Đơn cũ vẫn giữ nguyên.`, 'Xoá')) { p.deleted = true; await put('products', p); render(); toast('Đã xoá'); } };
      $('#pfBuy', sh).onclick = () => { closeSheet(); nhapDraft = [{ pid: p.id, name: p.name, qty: 1, cost: p.cost || 0 }]; location.hash = '#nhaphang'; };
    }
  });
}

/* ============ MÀN SỔ NỢ ============ */
function renderNo() {
  const kind = ui.noKind;
  const nq = norm(ui.noQ);
  const people = S.customers.filter(c => c.kind === kind && !c.deleted && (!nq || norm(c.name + ' ' + (c.phone || '')).includes(nq)))
    .map(c => ({ c, b: balanceOf(c.id) })).sort((a, b) => b.b - a.b || a.c.name.localeCompare(b.c.name, 'vi'));
  const total = people.reduce((s, x) => s + Math.max(0, x.b), 0);
  const owing = people.filter(x => x.b > 0).length;
  $('#main').innerHTML = `<div class="stack">
    <div class="chips"><button class="chip${kind === 'kh' ? ' on' : ''}" data-act="noKind" data-k="kh">Khách nợ tiệm</button><button class="chip${kind === 'ncc' ? ' on' : ''}" data-act="noKind" data-k="ncc">Tiệm nợ nhà cung cấp</button></div>
    <div class="card"><div class="muted small">${kind === 'kh' ? 'Tổng khách đang nợ' : 'Tổng tiệm đang nợ'}</div><div class="big-money" style="color:var(--red)">${vnd(total)}</div><div class="small muted">${owing} người còn nợ</div></div>
    <div class="row"><input class="input grow" id="nq" type="search" placeholder="Tìm tên, số điện thoại" value="${esc(ui.noQ)}"><button class="btn primary" data-act="newDebt">+ Ghi nợ</button></div>
    <div class="list">${people.map(({ c, b }) => `<button class="li" data-act="openCust" data-id="${esc(c.id)}"><span class="grow"><span class="t">${esc(c.name)}</span>${c.phone ? `<br><span class="small muted">${esc(c.phone)}</span>` : ''}</span><span class="money" style="color:${b > 0 ? 'var(--red)' : 'var(--muted)'}">${b > 0 ? vnd(b) : 'Hết nợ'}</span></button>`).join('') || '<div class="empty">Chưa có ai trong sổ</div>'}</div>
  </div>`;
  const q = $('#nq'); q.oninput = () => { ui.noQ = q.value; const pos = q.selectionStart; renderNo(); const n = $('#nq'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
}
function debtEntry(c, type) {
  const title = type === 'add' ? `Ghi nợ thêm · ${c.name}` : (c.kind === 'kh' ? `Thu tiền · ${c.name}` : `Trả tiền · ${c.name}`);
  const b = balanceOf(c.id);
  keypadSheet(title, { quick: type === 'pay' && b > 0 ? [['Trả hết ' + fmt(b), b]] : [], okText: 'Lưu',
    extraTop: `<input class="input" id="dNote" placeholder="Ghi chú (không bắt buộc)" style="margin-bottom:10px">`,
    onOk: async v => {
      if (!v) return;
      const d = { id: uid(), customerId: c.id, type, amount: v, note: ($('#dNote') || {}).value || '', at: Date.now() };
      S.debts.push(d); await put('debts', d);
      closeSheet(); openCustomer(c.id); toast(type === 'add' ? 'Đã ghi nợ ' + vnd(v) : 'Đã ghi trả ' + vnd(v));
    } });
}
function reminderText(c) {
  const b = balanceOf(c.id); const s = S.settings;
  const recent = S.debts.filter(d => d.customerId === c.id && !d.canceled).sort((a, b) => b.at - a.at).slice(0, 5);
  let t = `${s.shopName || 'Tiệm'} xin gửi ${c.name}:\nTổng nợ hiện tại: ${vnd(b)}\n`;
  if (recent.length) t += 'Gần đây:\n' + recent.map(d => `- ${dateStr(d.at)} ${d.type === 'add' ? 'mua' : 'đã trả'} ${vnd(d.amount)}${d.note ? ' (' + d.note + ')' : ''}`).join('\n') + '\n';
  if (s.bankAcc) t += `Chuyển khoản: ${(BANKS.find(x => x[0] === s.bankBin) || ['', ''])[1]} ${s.bankAcc}${s.bankHolder ? ' - ' + s.bankHolder : ''}\n`;
  return t + 'Cảm ơn nhiều ạ!';
}
function openCustomer(id) {
  const c = custById(id); if (!c) return;
  const b = balanceOf(c.id);
  const hist = S.debts.filter(d => d.customerId === c.id && !d.canceled).sort((a, b) => b.at - a.at);
  const s = S.settings;
  openSheet(c.name, `<div class="card" style="text-align:center"><div class="muted small">${c.kind === 'kh' ? 'Đang nợ tiệm' : 'Tiệm đang nợ'}</div><div class="big-money" style="color:${b > 0 ? 'var(--red)' : 'var(--green)'}">${vnd(b)}</div></div>
    <div class="grid2" style="margin-top:12px"><button class="btn" id="cAdd">Ghi nợ thêm</button><button class="btn green" id="cPay">${c.kind === 'kh' ? 'Thu tiền' : 'Trả tiền'}</button></div>
    ${c.kind === 'kh' && b > 0 ? `<button class="btn block" id="cRem" style="margin-top:10px">Nhắn nhắc nợ (Zalo/SMS)</button>` : ''}
    ${c.kind === 'kh' && b > 0 && s.bankAcc ? `<button class="btn block" id="cQR" style="margin-top:10px">Hiện mã QR trả nợ</button>` : ''}
    <h3 style="margin:16px 0 8px">Lịch sử</h3>
    <div class="list">${hist.map(d => `<div class="li" style="cursor:default"><span class="grow"><span class="t">${d.type === 'add' ? (c.kind === 'kh' ? 'Mua nợ' : 'Nợ thêm') : 'Đã trả'}</span><br><span class="small muted">${dateStr(d.at)} ${timeStr(d.at)}${d.note ? ' · ' + esc(d.note) : ''}</span></span><span class="money" style="color:${d.type === 'add' ? 'var(--red)' : 'var(--green)'}">${d.type === 'add' ? '+' : '−'}${vnd(d.amount)}</span>${!d.orderId && !d.purchaseId ? `<button class="btn ghost sm" data-del="${esc(d.id)}" aria-label="Xoá dòng">✕</button>` : ''}</div>`).join('') || '<div class="empty">Chưa có</div>'}</div>
    <details style="margin-top:14px"><summary class="muted">Sửa thông tin</summary>
      <div class="stack" style="margin-top:10px"><input class="input" id="cName" value="${esc(c.name)}"><input class="input" id="cPhone" inputmode="tel" placeholder="Số điện thoại" value="${esc(c.phone || '')}">
      <div class="grid2"><button class="btn" id="cSave">Lưu</button><button class="btn danger" id="cDel">Xoá người này</button></div></div></details>`, sh => {
    $('#cAdd', sh).onclick = () => debtEntry(c, 'add');
    $('#cPay', sh).onclick = () => debtEntry(c, 'pay');
    if ($('#cRem', sh)) $('#cRem', sh).onclick = () => {
      const t = reminderText(c);
      openSheet('Tin nhắc nợ', `<textarea class="input" id="rT" style="min-height:200px">${esc(t)}</textarea><p class="hint">Lời lẽ lịch sự, sửa thoải mái trước khi gửi.</p>
        <div class="grid2" style="margin-top:10px"><button class="btn primary" id="rCp">Sao chép</button>${navigator.share ? '<button class="btn" id="rSh">Gửi qua…</button>' : `<button class="btn" data-act="closeSheet">Xong</button>`}</div>
        ${c.phone ? `<p class="small muted" style="margin-top:10px">Số của khách: ${esc(c.phone)} — dán tin vào Zalo hoặc tin nhắn.</p>` : ''}`, s2 => {
        $('#rCp', s2).onclick = () => copyText($('#rT', s2).value);
        if ($('#rSh', s2)) $('#rSh', s2).onclick = async () => { try { await navigator.share({ text: $('#rT', s2).value }); } catch (e) { copyText($('#rT', s2).value); } };
      });
    };
    if ($('#cQR', sh)) $('#cQR', sh).onclick = () => {
      openSheet('Trả nợ ' + c.name, `<div class="qr">${qrSvg(vietQR(s.bankBin, s.bankAcc, b, 'TRA NO ' + c.name))}</div><div style="text-align:center;margin-top:10px" class="big-money">${vnd(b)}</div>
        <p class="hint" style="text-align:center">Khách trả một phần cũng được, họ tự sửa số tiền trong app ngân hàng.</p><button class="btn block" style="margin-top:10px" id="qBack">Quay lại</button>`, s2 => { $('#qBack', s2).onclick = () => openCustomer(c.id); });
    };
    $('#cSave', sh).onclick = async () => { c.name = $('#cName', sh).value.trim() || c.name; c.phone = $('#cPhone', sh).value.trim(); await put('customers', c); openCustomer(c.id); render(); toast('Đã lưu'); };
    $('#cDel', sh).onclick = async () => { if (b !== 0) { toast('Còn nợ ' + vnd(b) + ', chưa xoá được'); return; } if (await confirmDlg(`Xoá ${c.name} khỏi sổ?`, 'Xoá')) { c.deleted = true; await put('customers', c); render(); } };
    $$('[data-del]', sh).forEach(btn => btn.onclick = async () => {
      const d = S.debts.find(x => x.id === btn.dataset.del);
      if (d && await confirmDlg(`Xoá dòng ${vnd(d.amount)} ngày ${dateStr(d.at)}?`, 'Xoá')) { d.canceled = true; await put('debts', d); openCustomer(c.id); render(); }
      else openCustomer(c.id);
    });
  }, () => render());
}

/* ============ BÁO CÁO ============ */
function periodRange(k) {
  const now = new Date(), t0 = startOfDay(now);
  const y = now.getFullYear(), m = now.getMonth();
  switch (k) {
    case 'today': return [t0, t0 + 864e5, 'Hôm nay'];
    case 'yest': return [t0 - 864e5, t0, 'Hôm qua'];
    case '7d': return [t0 - 6 * 864e5, t0 + 864e5, '7 ngày qua'];
    case 'month': return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime(), 'Tháng này'];
    case 'lmonth': return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime(), 'Tháng trước'];
    case 'year': return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime(), 'Năm ' + y];
  }
}
function summarize(from, to) {
  const os = S.orders.filter(o => !o.canceled && o.at >= from && o.at < to);
  let rev = 0, cost = 0, cash = 0, bank = 0, debt = 0, est = false;
  const byP = new Map();
  for (const o of os) {
    rev += o.total; cash += o.pay.cash || 0; bank += o.pay.bank || 0; debt += o.pay.debt || 0;
    for (const i of o.items) {
      const c = lineCost(i); if (!(i.cost > 0)) est = true;
      cost += c * i.qty;
      const k = i.pid || ('~' + i.name);
      const e = byP.get(k) || { name: i.name, qty: 0, rev: 0, profit: 0 };
      e.qty += i.qty; e.rev += i.price * i.qty; e.profit += (i.price - c) * i.qty; byP.set(k, e);
    }
  }
  return { n: os.length, rev, cost, profit: rev - cost, cash, bank, debt, est, top: [...byP.values()].sort((a, b) => b.rev - a.rev) };
}
function renderBaoCao() {
  const [from, to, label] = periodRange(ui.period);
  const r = summarize(from, to);
  const y = new Date().getFullYear();
  const yr = summarize(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime());
  const th = S.settings.taxThreshold || 1e9;
  const dayOfYear = Math.max(1, Math.ceil((Date.now() - new Date(y, 0, 1).getTime()) / 864e5));
  const forecast = yr.rev / dayOfYear * 365;
  const pct = Math.min(100, yr.rev / th * 100);
  const debtOut = S.customers.filter(c => c.kind === 'kh' && !c.deleted).reduce((s, c) => s + Math.max(0, balanceOf(c.id)), 0);
  const low = activeProducts().filter(p => isLow(p) || (isOut(p) && p.minStock > 0)).sort((a, b) => a.stock - b.stock).slice(0, 12);
  const maxM = Math.max(r.cash, r.bank, r.debt, 1);
  $('#main').innerHTML = `<div class="stack">
    <div class="chips">${[['today', 'Hôm nay'], ['yest', 'Hôm qua'], ['7d', '7 ngày'], ['month', 'Tháng này'], ['lmonth', 'Tháng trước'], ['year', 'Năm nay']].map(([k, l]) => `<button class="chip${ui.period === k ? ' on' : ''}" data-act="period" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="card"><div class="muted small">${esc(label)} · tiền lời</div><div class="big-money" style="color:var(--green)">${vnd(r.profit)}</div>
      <div class="small muted">${r.est ? 'Có món chưa nhập giá vốn: lãi được ước tính ' + (S.settings.otherMargin ?? 15) + '% giá bán.' : 'Tính theo giá vốn đã nhập.'}</div></div>
    <div class="kpis">
      <div class="card kpi"><div class="l">Doanh thu</div><div class="v">${vnd(r.rev)}</div></div>
      <div class="card kpi"><div class="l">Số đơn</div><div class="v">${fmt(r.n)}</div></div>
      <div class="card kpi"><div class="l">Tiền vốn hàng bán</div><div class="v">${vnd(r.cost)}</div></div>
      <div class="card kpi"><div class="l">Khách còn nợ (tổng)</div><div class="v" style="color:var(--red)">${vnd(debtOut)}</div></div>
    </div>
    <div class="card stack"><h3>Tiền vào bằng gì</h3>
      ${[['Tiền mặt', r.cash], ['Chuyển khoản', r.bank], ['Ghi nợ', r.debt]].map(([l, v]) => `<div class="barrow"><span>${l}</span><div class="meter"><i style="width:${v / maxM * 100}%"></i></div><span class="money">${vnd(v)}</span></div>`).join('')}
    </div>
    <div class="card"><h3 style="margin-bottom:8px">Bán chạy</h3>${r.top.length ? `<table class="t"><thead><tr><th>Món</th><th class="n">SL</th><th class="n">Doanh thu</th><th class="n">Lời</th></tr></thead><tbody>${r.top.slice(0, 10).map(t => `<tr><td>${esc(t.name)}</td><td class="n">${fmt(t.qty)}</td><td class="n">${fmt(t.rev)}</td><td class="n">${fmt(t.profit)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chưa bán đơn nào</div>'}</div>
    ${low.length ? `<div class="card"><h3 style="margin-bottom:8px">Sắp hết hàng</h3><div class="row wrap">${low.map(p => `<span class="tag warn">${esc(p.name)}: ${fmt(p.stock || 0)}</span>`).join('')}</div></div>` : ''}
    <div class="card stack"><h3>Sổ doanh thu năm ${y} (để kê khai thuế)</h3>
      <div class="row" style="justify-content:space-between"><span class="muted">Cộng dồn từ 1/1</span><span class="money" style="font-size:1.2rem">${vnd(yr.rev)}</span></div>
      <div class="meter${pct < 80 ? ' green' : ''}"><i style="width:${pct}%"></i></div>
      <div class="small muted">Ngưỡng đang cài: ${vnd(th)}/năm. Ước tính cả năm theo tốc độ hiện tại: <b>${vnd(forecast)}</b>.</div>
      ${forecast >= th ? `<div class="card small" style="background:var(--warn-soft);border:0">Doanh thu có thể vượt ngưỡng. Nên hỏi cán bộ thuế hoặc kế toán về kê khai và hoá đơn điện tử.</div>` : ''}
      <p class="hint">Số liệu để tham khảo khi thông báo/kê khai doanh thu, chưa phải tờ khai chính thức. Quy định có thể thay đổi, ngưỡng sửa trong Cài đặt.</p>
      <div class="grid2"><button class="btn" data-act="csvDays">Sổ theo ngày (CSV)</button><button class="btn" data-act="csvOrders">Chi tiết từng đơn (CSV)</button></div>
    </div>
  </div>`;
}
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csvDays() {
  const y = new Date().getFullYear();
  const map = new Map();
  for (const o of S.orders) { if (o.canceled || new Date(o.at).getFullYear() !== y) continue; const k = dayKey(o.at); const e = map.get(k) || [0, 0, 0, 0, 0]; e[0]++; e[1] += o.total; e[2] += o.pay.cash || 0; e[3] += o.pay.bank || 0; e[4] += o.pay.debt || 0; map.set(k, e); }
  const rows = [['Ngày', 'Số đơn', 'Doanh thu', 'Tiền mặt', 'Chuyển khoản', 'Ghi nợ']];
  let tot = [0, 0, 0, 0, 0];
  for (const k of [...map.keys()].sort()) { const e = map.get(k); rows.push([k.split('-').reverse().join('/'), ...e]); tot = tot.map((x, i) => x + e[i]); }
  rows.push(['Tổng', ...tot]);
  exportSheet('Sổ doanh thu theo ngày', `so-doanh-thu-${y}.csv`, '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}
function csvOrders() {
  const y = new Date().getFullYear();
  const rows = [['Ngày', 'Giờ', 'Mã đơn', 'Món', 'SL', 'Đơn giá', 'Thành tiền', 'Thanh toán', 'Khách nợ']];
  for (const o of S.orders.filter(o => !o.canceled && new Date(o.at).getFullYear() === y).sort((a, b) => a.at - b.at)) {
    const pay = [o.pay.cash ? 'TM ' + o.pay.cash : '', o.pay.bank ? 'CK ' + o.pay.bank : '', o.pay.debt ? 'Nợ ' + o.pay.debt : ''].filter(Boolean).join(' + ');
    const cust = o.customerId ? (custById(o.customerId) || {}).name : '';
    for (const i of o.items) rows.push([dateStr(o.at), timeStr(o.at), o.id, i.name, i.qty, i.price, i.price * i.qty, pay, cust || '']);
  }
  exportSheet('Chi tiết đơn hàng', `chi-tiet-don-${y}.csv`, '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}

/* ============ MÀN THÊM ============ */
function renderThem() {
  const today = summarize(startOfDay(Date.now()), startOfDay(Date.now()) + 864e5);
  $('#main').innerHTML = `<div class="stack">
    <h2>Thêm</h2>
    <div class="list">
      <a class="li" href="#donhang" style="color:inherit;text-decoration:none"><span class="grow"><span class="t">Đơn đã bán</span><br><span class="small muted">Hôm nay ${fmt(today.n)} đơn · xem lại, huỷ đơn bán nhầm</span></span>›</a>
      <a class="li" href="#nhaphang" style="color:inherit;text-decoration:none"><span class="grow"><span class="t">Nhập hàng</span><br><span class="small muted">Cộng kho, cập nhật giá vốn, ghi nợ nhà cung cấp</span></span>›</a>
      <a class="li" href="#caidat" style="color:inherit;text-decoration:none"><span class="grow"><span class="t">Cài đặt & sao lưu</span><br><span class="small muted">Tên tiệm, ngân hàng, cỡ chữ, sao lưu dữ liệu</span></span>›</a>
    </div>
    <p class="small muted">Sổ Tạp Hoá · bản thử nghiệm 0.1 · dữ liệu chỉ nằm trên máy này.</p>
  </div>`;
}
function renderDonHang() {
  if (!ui.orderDay) ui.orderDay = dayKey(Date.now());
  const days = [...new Set(S.orders.map(o => dayKey(o.at)))].sort().reverse().slice(0, 30);
  if (!days.includes(ui.orderDay)) days.unshift(ui.orderDay);
  const os = S.orders.filter(o => dayKey(o.at) === ui.orderDay).sort((a, b) => b.at - a.at);
  const sum = os.filter(o => !o.canceled).reduce((s, o) => s + o.total, 0);
  $('#main').innerHTML = `<div class="stack">
    <div class="row"><a href="#them" class="btn sm ghost">‹ Thêm</a><h2 class="grow">Đơn đã bán</h2></div>
    <div class="chips">${days.map(d => `<button class="chip${d === ui.orderDay ? ' on' : ''}" data-act="oDay" data-k="${d}">${d === dayKey(Date.now()) ? 'Hôm nay' : d.split('-').reverse().slice(0, 2).join('/')}</button>`).join('')}</div>
    <div class="card row" style="justify-content:space-between"><span class="muted">${os.filter(o => !o.canceled).length} đơn</span><span class="money" style="font-size:1.3rem">${vnd(sum)}</span></div>
    <div class="list">${os.map(o => `<button class="li" data-act="openOrder" data-id="${esc(o.id)}" style="${o.canceled ? 'opacity:.5' : ''}"><span class="grow"><span class="t">${timeStr(o.at)} · ${esc(o.items.map(i => (i.qty !== 1 ? fmt(i.qty) + ' ' : '') + i.name).join(', ').slice(0, 60))}</span><br>
      <span class="small muted">${o.canceled ? 'Đã huỷ' : [o.pay.cash ? 'Tiền mặt' : '', o.pay.bank ? 'Chuyển khoản' : '', o.pay.debt ? 'Nợ: ' + esc((custById(o.customerId) || {}).name || '') : ''].filter(Boolean).join(' + ')}</span></span><span class="money">${vnd(o.total)}</span></button>`).join('') || '<div class="empty">Không có đơn</div>'}</div>
  </div>`;
}
function openOrder(id) {
  const o = S.orders.find(x => x.id === id); if (!o) return;
  openSheet(`Đơn ${timeStr(o.at)} ${dateStr(o.at)}`, `<table class="t"><tbody>${o.items.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${fmt(i.qty)} × ${fmt(i.price)}</td><td class="n">${fmt(i.qty * i.price)}</td></tr>`).join('')}</tbody></table>
    <div class="row" style="justify-content:space-between;margin:14px 2px"><span class="muted">Tổng</span><span class="big-money">${vnd(o.total)}</span></div>
    <p class="muted">${o.pay.cash ? 'Tiền mặt ' + vnd(o.pay.cash) + '. ' : ''}${o.pay.bank ? 'Chuyển khoản ' + vnd(o.pay.bank) + '. ' : ''}${o.pay.debt ? 'Ghi nợ ' + vnd(o.pay.debt) + ' cho ' + esc((custById(o.customerId) || {}).name || '') + '.' : ''}</p>
    ${o.canceled ? '<p class="tag red">Đơn đã huỷ</p>' : `<button class="btn danger block" id="oCancel">Huỷ đơn này (trả lại kho${o.pay.debt ? ', xoá nợ' : ''})</button>`}`, sh => {
    if ($('#oCancel', sh)) $('#oCancel', sh).onclick = async () => { if (await confirmDlg('Huỷ đơn ' + vnd(o.total) + '?', 'Huỷ đơn')) { await cancelOrder(o); render(); toast('Đã huỷ đơn'); } };
  });
}

/* ============ NHẬP HÀNG ============ */
let nhapDraft = [];
let nhapSupplier = null;
function renderNhapHang() {
  const total = nhapDraft.reduce((s, l) => s + l.qty * l.cost, 0);
  const sup = nhapSupplier && custById(nhapSupplier);
  $('#main').innerHTML = `<div class="stack">
    <div class="row"><a href="#them" class="btn sm ghost">‹ Thêm</a><h2 class="grow">Nhập hàng</h2></div>
    <div class="search"><input class="input grow" id="nq2" type="search" placeholder="Tìm món để nhập…" autocomplete="off">${canScan ? `<button class="icon-btn" data-act="scanNhap" aria-label="Quét">${ICON.scan}</button>` : ''}</div>
    <div id="nhapRes"></div>
    <div class="list">${nhapDraft.map((l, i) => `<div class="li" style="cursor:default;flex-wrap:wrap"><span class="grow t" style="flex-basis:100%">${esc(l.name)}</span>
      <label class="field grow"><span>Số lượng</span><input class="input" data-nq="${i}" inputmode="decimal" value="${l.qty}"></label>
      <label class="field grow"><span>Giá nhập / 1</span><input class="input" data-nc="${i}" inputmode="decimal" value="${l.cost ? fmt(l.cost) : ''}"></label>
      <button class="btn ghost sm" data-act="nhapDel" data-i="${i}" aria-label="Bỏ dòng" style="align-self:flex-end">✕</button></div>`).join('') || '<div class="empty">Tìm và chọn món ở trên. Món mới thì thêm trong Hàng hoá trước.</div>'}</div>
    ${nhapDraft.length ? `<div class="card stack">
      <div class="row" style="justify-content:space-between"><span class="muted">Tổng tiền hàng</span><span class="big-money" id="nTot">${vnd(total)}</span></div>
      <button class="btn block" data-act="nhapSup">${sup ? 'Nhà cung cấp: ' + esc(sup.name) : 'Chọn nhà cung cấp (không bắt buộc)'}</button>
      <label class="field"><span>Đã trả bao nhiêu</span><input class="input" id="nPaid" inputmode="decimal" value="${fmt(total)}"></label>
      <p class="hint">Trả thiếu thì phần còn lại tự ghi vào sổ nợ nhà cung cấp (cần chọn nhà cung cấp).</p>
      <button class="btn primary block" data-act="nhapSave">Lưu phiếu nhập</button></div>` : ''}
  </div>`;
  const q = $('#nq2');
  q.oninput = () => {
    const r = searchProducts(q.value, 8);
    $('#nhapRes').innerHTML = r.length ? `<div class="list">${r.map(p => `<button class="li" data-act="nhapAdd" data-id="${esc(p.id)}"><span class="grow t">${esc(p.name)}</span><span class="small muted">${tracked(p) ? 'còn ' + fmt(p.stock) : 'chưa đếm kho'}</span></button>`).join('')}</div>` : (q.value.trim() ? '<div class="empty">Không thấy món</div>' : '');
  };
  $$('[data-nq]').forEach(inp => inp.onchange = () => { nhapDraft[+inp.dataset.nq].qty = parseQty(inp.value); updNhapTotal(); });
  $$('[data-nc]').forEach(inp => inp.onchange = () => { const v = parseMoney(inp.value); nhapDraft[+inp.dataset.nc].cost = v; inp.value = v ? fmt(v) : ''; updNhapTotal(); });
}
function updNhapTotal() { const t = nhapDraft.reduce((s, l) => s + l.qty * l.cost, 0); if ($('#nTot')) $('#nTot').textContent = vnd(t); if ($('#nPaid')) $('#nPaid').value = fmt(t); }
function nhapAddProduct(p) {
  const l = nhapDraft.find(x => x.pid === p.id);
  if (l) l.qty += 1; else nhapDraft.push({ pid: p.id, name: p.name, qty: 1, cost: p.cost || 0 });
  renderNhapHang();
}

/* ============ CÀI ĐẶT ============ */
function renderCaiDat() {
  const s = S.settings;
  $('#main').innerHTML = `<div class="stack">
    <div class="row"><a href="#them" class="btn sm ghost">‹ Thêm</a><h2 class="grow">Cài đặt</h2></div>
    <form id="sf" class="card stack">
      <label class="field"><span>Tên tiệm</span><input class="input" name="shopName" value="${esc(s.shopName)}"></label>
      <label class="field"><span>Ngân hàng nhận tiền</span><select class="input" name="bankBin"><option value="">— Chọn —</option>${BANKS.map(b => `<option value="${b[0]}" ${s.bankBin === b[0] ? 'selected' : ''}>${b[1]}</option>`).join('')}</select></label>
      <label class="field"><span>Số tài khoản</span><input class="input" name="bankAcc" inputmode="numeric" value="${esc(s.bankAcc)}"></label>
      <label class="field"><span>Tên chủ tài khoản</span><input class="input" name="bankHolder" value="${esc(s.bankHolder)}" placeholder="VD: NGUYEN THI HANH"></label>
      <label class="row" style="min-height:44px"><input type="checkbox" name="big" ${s.big ? 'checked' : ''} style="width:24px;height:24px"> Chữ rất to</label>
      <label class="field"><span>Ngưỡng doanh thu chịu thuế (đ/năm)</span><input class="input" name="taxThreshold" inputmode="numeric" value="${fmt(s.taxThreshold)}"></label>
      <label class="field"><span>Lãi ước tính cho món chưa có giá vốn (%)</span><input class="input" name="otherMargin" inputmode="numeric" value="${esc(s.otherMargin)}"></label>
      <button class="btn primary block" type="submit">Lưu cài đặt</button>
    </form>
    <div class="card stack"><h3>Sao lưu</h3>
      <p class="small muted">Dữ liệu chỉ nằm trên điện thoại này. Nên sao lưu mỗi tuần và gửi file vào Zalo "Cloud của tôi". Lần gần nhất: ${s.lastBackup ? dateStr(s.lastBackup) : 'chưa có'}.</p>
      <button class="btn primary block" data-act="backup">Sao lưu ngay</button>
      <button class="btn block" data-act="restore">Khôi phục từ file sao lưu</button>
    </div>
    <div class="card stack"><h3>Vùng nguy hiểm</h3><button class="btn danger block" data-act="wipe">Xoá toàn bộ dữ liệu</button></div>
  </div>`;
  $('#sf').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    Object.assign(s, { shopName: f.shopName.value.trim() || 'Tiệm tạp hoá', bankBin: f.bankBin.value, bankAcc: f.bankAcc.value.replace(/\s/g, ''), bankHolder: f.bankHolder.value.trim().toUpperCase(), big: f.big.checked, taxThreshold: parseMoney(f.taxThreshold.value) || 1e9, otherMargin: Math.min(90, Math.max(0, parseInt(f.otherMargin.value, 10) || 0)) });
    await saveSettings(); render(); toast('Đã lưu cài đặt');
  };
}
function backupJson() { return JSON.stringify({ app: 'sotaphoa', v: 1, at: Date.now(), data: { products: S.products, customers: S.customers, orders: S.orders, debts: S.debts, purchases: S.purchases, settings: [S.settings] } }); }
async function doBackup() {
  S.settings.lastBackup = Date.now(); await saveSettings();
  exportSheet('Sao lưu dữ liệu', `sotaphoa-${dayKey(Date.now())}.json`, backupJson(), 'application/json');
  renderBanner();
}
async function restoreFrom(text) {
  let j; try { j = JSON.parse(text); } catch (e) { toast('File không đúng định dạng'); return; }
  if (!j || j.app !== 'sotaphoa' || !j.data) { toast('Không phải file sao lưu của Sổ Tạp Hoá'); return; }
  const d = j.data;
  if (!await confirmDlg(`Thay toàn bộ dữ liệu hiện tại bằng bản sao lưu ngày ${dateStr(j.at)} (${(d.products || []).length} món, ${(d.orders || []).length} đơn)?`, 'Khôi phục')) return;
  await clearAll();
  for (const k of ['products', 'customers', 'orders', 'debts', 'purchases']) { S[k] = Array.isArray(d[k]) ? d[k] : []; if (S[k].length) await put(k, ...S[k]); }
  S.settings = Object.assign({}, DEFAULT_SETTINGS, (d.settings || [])[0] || {}, { id: 'main' }); await saveSettings();
  render(); toast('Đã khôi phục');
}

/* ============ HÀNG MẪU ============ */
const SAMPLE = [
['Mì Hảo Hảo tôm chua cay','gói',4500],['Mì Omachi xốt bò hầm','gói',8000],['Mì Kokomi','gói',4000],['Mì ly Modern','ly',10000],['Cháo gói','gói',5000],['Phở gói ăn liền','gói',9000],
['Nước mắm Nam Ngư','chai',35000],['Nước tương Chinsu','chai',15000],['Tương ớt Chinsu','chai',15000],['Dầu ăn 1 lít','chai',55000],['Đường trắng 1kg','bịch',25000],['Muối i-ốt','gói',6000],
['Bột ngọt 400g','gói',32000],['Hạt nêm 400g','gói',38000],['Bột canh','gói',5000],['Dầu hào','chai',30000],['Giấm','chai',10000],['Gạo (lẻ)','kg',22000],['Trứng gà','quả',3500],
['Sữa Vinamilk 180ml','hộp',8000],['Sữa tươi TH 180ml','hộp',9000],['Sữa đặc Ông Thọ','lon',28000],['Sữa chua','hộp',7000],
['Nước suối 500ml','chai',5000],['Coca-Cola lon','lon',10000],['Pepsi lon','lon',10000],['7Up lon','lon',10000],['Sting dâu','chai',11000],['Trà xanh Không Độ','chai',11000],['Red Bull','lon',12000],
['Bia Tiger lon','lon',18000],['Bia Sài Gòn lon','lon',14000],['Bia Hà Nội lon','lon',13000],['Cà phê G7 hộp','hộp',55000],['Nước đá','bịch',5000],
['Bánh Chocopie hộp','hộp',58000],['Bánh quy','gói',25000],['Snack Oishi','gói',6000],['Kẹo','gói',10000],['Xúc xích','cây',6000],
['Bột giặt 800g','túi',45000],['Nước rửa chén 750g','chai',30000],['Nước lau sàn','chai',35000],['Dầu gội gói','gói',2000],['Kem đánh răng','tuýp',30000],['Bàn chải đánh răng','cái',15000],
['Xà bông cục','cục',18000],['Giấy vệ sinh','cuộn',6000],['Khăn giấy hộp','hộp',20000],['Băng vệ sinh','gói',25000],['Bật lửa','cái',5000],['Pin AA','đôi',10000]];
async function addSampleCatalog() {
  const ps = SAMPLE.map(([name, unit, price], i) => ({ id: uid() + i, name, unit, price, cost: null, barcode: '', stock: null, minStock: 0, fav: i < 12, sold: 0, at: Date.now(), updatedAt: Date.now(), sample: true }));
  S.products.push(...ps); await put('products', ...ps);
  S.settings.sampled = true; await saveSettings();
}

/* ============ SỰ KIỆN ============ */
const ACT = {
  closeSheet: () => closeSheet(),
  addP: el => { const p = prodById(el.dataset.id); if (p) { addToCart(p); renderResults(); } },
  quickSale, openCart,
  newProduct: el => editProduct(null, { name: el.dataset.name || '' }),
  editP: el => editProduct(el.dataset.id),
  sample: async () => { await addSampleCatalog(); render(); toast('Đã thêm ' + SAMPLE.length + ' món'); },
  qtyPlus: el => { const i = cart.find(x => x.key === el.dataset.key); if (i) { i.qty = Math.round((i.qty + 1) * 1000) / 1000; saveCart(); refreshCartSheet(); } },
  qtyMinus: el => { const i = cart.find(x => x.key === el.dataset.key); if (i) { i.qty = Math.round((i.qty - 1) * 1000) / 1000; if (i.qty <= 0) cart = cart.filter(x => x !== i); saveCart(); refreshCartSheet(); } },
  qtySet: el => {
    const i = cart.find(x => x.key === el.dataset.key); if (!i) return;
    openSheet('Số lượng · ' + i.name, `<input class="input lg" id="qS" inputmode="decimal" value="${i.qty}" autofocus><p class="hint">Bán cân ký thì gõ số lẻ, vd 0,5</p><button class="btn primary block" id="qOk" style="margin-top:10px">Xong</button>`, sh => {
      $('#qOk', sh).onclick = () => { const v = parseQty($('#qS', sh).value); if (v > 0) i.qty = v; else cart = cart.filter(x => x !== i); saveCart(); refreshCartSheet(); };
    });
  },
  editPrice: el => {
    const i = cart.find(x => x.key === el.dataset.key); if (!i) return;
    keypadSheet('Giá bán · ' + i.name, { initial: i.price, okText: 'Đổi giá cho đơn này', onOk: v => { if (v) { i.price = v; saveCart(); } refreshCartSheet(); } });
  },
  clearCart: async () => { if (await confirmDlg('Xoá hết món trong giỏ?', 'Xoá')) { cart = []; saveCart(); render(); } else openCart(); },
  payCash, payBank, payDebt,
  voice: el => startVoice(el),
  scanSell: () => openScanner(code => { const p = activeProducts().find(x => x.barcode === code); if (p) { addToCart(p); render(); toast('Đã thêm ' + p.name); } else askNewBarcode(code); }),
  scanFind: () => openScanner(code => { const p = activeProducts().find(x => x.barcode === code); if (p) editProduct(p.id); else editProduct(null, { barcode: code }); }),
  scanNhap: () => openScanner(code => { const p = activeProducts().find(x => x.barcode === code); if (p) nhapAddProduct(p); else toast('Mã chưa có, thêm món trong Hàng hoá trước'); }),
  pf: el => { ui.prodFilter = el.dataset.k; renderHang(); },
  noKind: el => { ui.noKind = el.dataset.k; renderNo(); },
  newDebt: () => pickCustomer(ui.noKind, ui.noKind === 'kh' ? 'Ghi nợ cho ai?' : 'Nhà cung cấp nào?', c => debtEntry(c, 'add')),
  openCust: el => openCustomer(el.dataset.id),
  period: el => { ui.period = el.dataset.k; renderBaoCao(); },
  csvDays, csvOrders,
  oDay: el => { ui.orderDay = el.dataset.k; renderDonHang(); },
  openOrder: el => openOrder(el.dataset.id),
  nhapAdd: el => { const p = prodById(el.dataset.id); if (p) nhapAddProduct(p); },
  nhapDel: el => { nhapDraft.splice(+el.dataset.i, 1); renderNhapHang(); },
  nhapSup: () => pickCustomer('ncc', 'Nhà cung cấp', c => { nhapSupplier = c.id; closeSheet(); renderNhapHang(); }),
  nhapSave: async () => {
    const lines = nhapDraft.filter(l => l.qty > 0);
    if (!lines.length) { toast('Chưa có món nào'); return; }
    if (lines.some(l => !l.cost)) { toast('Nhập giá nhập cho từng món'); return; }
    const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
    const paid = Math.min(total, parseMoney($('#nPaid').value));
    if (paid < total && !nhapSupplier) { toast('Trả thiếu thì cần chọn nhà cung cấp để ghi nợ'); return; }
    await savePurchase({ lines, supplierId: nhapSupplier, paid, note: '' });
    nhapDraft = []; nhapSupplier = null; renderNhapHang();
    toast(`Đã nhập ${lines.length} món · ${vnd(total)}${paid < total ? ' · nợ ' + vnd(total - paid) : ''}`);
  },
  backup: () => doBackup(),
  restore: () => $('#fileIn').click(),
  wipe: async () => {
    if (!await confirmDlg('Xoá TOÀN BỘ hàng hoá, đơn, sổ nợ trên máy này? Không lấy lại được nếu chưa sao lưu.', 'Xoá hết')) return;
    if (!await confirmDlg('Chắc chắn lần nữa: xoá hết?', 'Xoá hết')) return;
    await clearAll(); for (const k of ['products', 'customers', 'orders', 'debts', 'purchases']) S[k] = [];
    S.settings = { ...DEFAULT_SETTINGS }; await saveSettings(); cart = []; saveCart(); location.hash = '#ban'; render(); toast('Đã xoá dữ liệu');
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (e.target.id === 'sheetWrap') closeSheet(); return; }
  const f = ACT[el.dataset.act]; if (!f) return;
  if (el.tagName === 'A' && el.dataset.act === 'closeSheet') { closeSheet(); return; }
  e.preventDefault(); e.stopPropagation(); f(el);
});
$('#fileIn').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreFrom(await f.text()); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });
window.addEventListener('hashchange', () => { closeSheet(); $('#toast').hidden = true; window.scrollTo(0, 0); render(); });

/* ============ KHỞI ĐỘNG ============ */
(async () => {
  await openDB();
  if (dbOk) for (const k of ['products', 'customers', 'orders', 'debts', 'purchases']) S[k] = await getAll(k);
  const st = dbOk ? (await getAll('settings')).find(x => x.id === 'main') : null;
  S.settings = Object.assign({}, DEFAULT_SETTINGS, st || {});
  setSave(dbOk);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  render();
  try { if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
})();
window.__S = S; window.__parseVoice = parseVoice; window.__vietQR = vietQR; window.__parseMoney = parseMoney;
}
