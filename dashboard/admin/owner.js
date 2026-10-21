/* Owner panel — phase 2 (loaded after app.js; reuses its helpers: apiFetch, toast, confirmModal, openInputModal …).
   No inline handlers (CSP): buttons carry data-act="own" data-fn="<name>" and are dispatched to the fixed list OWNER_FN. */

const ownerSelected = new Set();     // server ids ticked in the Servers table
const cleanSelected = new Set();     // server ids ticked in the Cleanup table
let cleanRows = [];
const ownCharts = {};
let logTimer = null, logDebounce = null, lastLogRows = [];

const num = n => Number(n ?? 0).toLocaleString('ar-EG');
const fmtBytes = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(0) + ' MB' : (b / 1024).toFixed(0) + ' KB';
const $ = id => document.getElementById(id);
const post = (path, body) => apiFetch(path, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) });

/* ══ Bulk selection (Servers page) ══════════════════════════════════════ */
let lastSelId = null, shiftHeld = false;
document.addEventListener('click', (e) => { shiftHeld = e.shiftKey; }, true);       // read by selGuild (shift+click = range)

function ownerSyncSelection() {
  const known = new Set(allGuilds.map(g => g.id));
  for (const id of [...ownerSelected]) if (!known.has(id)) ownerSelected.delete(id);   // left meanwhile
  $('bulkBar').classList.toggle('show', ownerSelected.size > 0);
  $('bulkCount').textContent = `${num(ownerSelected.size)} محدد`;
  const vis = visibleGuilds();
  const all = $('selAllGuilds');
  all.checked = vis.length > 0 && vis.every(g => ownerSelected.has(g.id));
  all.indeterminate = !all.checked && vis.some(g => ownerSelected.has(g.id));
  document.querySelectorAll('#guildsBody tr[data-gid]').forEach(tr => tr.classList.toggle('is-sel', ownerSelected.has(tr.dataset.gid)));
  const sl = $('schedSelLabel'); if (sl) sl.textContent = `للسيرفرات المحددة فقط (${num(ownerSelected.size)})`;
}
function selGuild(d, el) {
  const rows = visibleGuilds().slice(0, gShown).map(g => g.id);
  if (shiftHeld && lastSelId && rows.includes(lastSelId) && rows.includes(d.id)) {          // range: from the last click to this one
    const [a, b] = [rows.indexOf(lastSelId), rows.indexOf(d.id)].sort((x, y) => x - y);
    for (const id of rows.slice(a, b + 1)) el.checked ? ownerSelected.add(id) : ownerSelected.delete(id);
    renderGuilds();
  } else {
    el.checked ? ownerSelected.add(d.id) : ownerSelected.delete(d.id);
    ownerSyncSelection();
  }
  lastSelId = d.id;
}
function selAllGuilds(_d, el) {                       // every server matching the current filters, not only the rows on screen
  for (const g of visibleGuilds()) el.checked ? ownerSelected.add(g.id) : ownerSelected.delete(g.id);
  renderGuilds();
}
function bulkClear() { ownerSelected.clear(); renderGuilds(); }

/* Choice dialog (lock duration, language …) */
function pickOpen(icon, title, sub, options, onOk, okLabel = 'متابعة', def = null) {
  $('pickIcon').textContent = icon; $('pickTitle').textContent = title; $('pickSub').textContent = sub;
  $('pickSel').innerHTML = options.map(([v, l]) => `<option value="${escHtml(v)}">${escHtml(l)}</option>`).join('');
  if (def != null) $('pickSel').value = def;
  $('pickOk').textContent = okLabel;
  $('pickOk').onclick = () => { const v = $('pickSel').value; pickClose(false); onOk(v); };
  _lastFocus = document.activeElement;
  $('pickModal').classList.add('open'); $('pickSel').focus();
}
function pickClose(restore = true) {
  $('pickModal').classList.remove('open');
  if (restore && _lastFocus?.focus) _lastFocus.focus();
}
$('pickModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) pickClose(); });

const LOCK_OPTIONS = [['60', 'ساعة واحدة'], ['360', '٦ ساعات'], ['1440', 'يوم واحد'], ['4320', '٣ أيام'], ['10080', 'أسبوع'], ['43200', '٣٠ يومًا'], ['', 'حتى أفتحه يدويًا']];
const askLock = (title, sub, cb) => pickOpen('', title, sub, LOCK_OPTIONS, (v) => cb(v ? Number(v) : null), 'قفل', '1440');
const LOCK_EXPLAIN = 'يتحول السيرفر إلى وضع القراءة فقط: لا أوامر ولا أزرار للبوت (الأذكار المجدولة وصفحات المصحف تبقى). المدة المحددة تنتهي وحدها حتى لو أُعيد تشغيل البوت.';

async function lockGuild(id, locked, minutes = null) {
  try {
    await post(`/api/admin/guilds/${encodeURIComponent(id)}/lock`, { locked, ...(minutes ? { minutes } : {}) });
    toast(locked ? 'تم قفل السيرفر ✓' : 'تم فتح السيرفر ✓', 'success');
    afterGuildChange(id);
  } catch (err) { toast(err.message, 'error'); }
}
function quickLock(d) {
  if (d.locked === '1') {
    return confirmModal('', `فتح "${d.name}"`, 'يعود استخدام أوامر البوت وأزراره في هذا السيرفر فورًا.', () => lockGuild(d.id, false), 'فتح');
  }
  askLock(`قفل "${d.name}"`, LOCK_EXPLAIN, (m) => lockGuild(d.id, true, m));
}
function lockAsk(d) { askLock(`قفل "${d.name}"`, LOCK_EXPLAIN, (m) => lockGuild(d.id, true, m)); }

async function runBulk(action, ids, confirm, extra = {}) {
  const tot = { done: 0, failed: 0, skipped: 0 };
  try {
    toast('جارٍ التنفيذ… قد يستغرق دقيقة', 'info');
    for (let i = 0; i < ids.length; i += 100) {                      // the server takes 100 at a time; more are sent in turns
      const r = await post('/api/admin/guilds/bulk', { action, ids: ids.slice(i, i + 100), confirm, ...extra });
      tot.done += r.done; tot.failed += r.failed; tot.skipped += r.skipped;
      if (ids.length > 100 && i + 100 < ids.length) toast(`${num(i + 100)} من ${num(ids.length)}…`, 'info');
    }
    toast(`نجح ${num(tot.done)} · فشل ${num(tot.failed)} · تخطّي ${num(tot.skipped)}`, tot.failed ? 'warning' : 'success');
  } catch (err) { toast(`${err.message}${tot.done ? ` — اكتمل ${num(tot.done)} قبل التوقف` : ''}`, 'error'); }
  ownerSelected.clear(); cleanSelected.clear();
  isDrawerOpen() ? refreshDrawer() : loadGuilds();
  if ($('page-cleanup').classList.contains('active')) scanCleanup();
}
const selIds = () => [...ownerSelected];
function bulkMessage() {
  const ids = selIds(); if (!ids.length) return;
  openInputModal('', `رسالة إلى ${num(ids.length)} سيرفر`, 'تُرسل كإعلان في قناة الإعلانات لكل سيرفر.', { placeholder: 'اكتب الرسالة…', multiline: true, okLabel: 'متابعة' },
    (v) => {
      if (!v) return toast('اكتب الرسالة أولاً', 'error');
      setTimeout(() => confirmModal('', 'تأكيد الإرسال', `سترسل الرسالة إلى ${num(ids.length)} سيرفر.`, () => runBulk('message', ids, 'BULK_MESSAGE', { message: v }), 'إرسال'), 50);
    });
}
function bulkLock() {
  const ids = selIds(); if (!ids.length) return;
  askLock(`قفل ${num(ids.length)} سيرفر`, LOCK_EXPLAIN, (m) => runBulk('lock', ids, 'BULK_LOCK', m ? { minutes: m } : {}));
}
function bulkUnlock() {
  const ids = selIds(); if (!ids.length) return;
  confirmModal('', `فتح ${num(ids.length)} سيرفر`, 'يرجع استخدام أوامر البوت وأزراره فيها فورًا.', () => runBulk('unlock', ids, 'BULK_UNLOCK'), 'فتح');
}
function bulkStop() {
  const ids = selIds(); if (!ids.length) return;
  confirmModal('', `إيقاف الجلسات في ${num(ids.length)} سيرفر`, 'يخرج البوت من القنوات الصوتية في المحدد. السيرفرات التي لا جلسة فيها تُتخطّى.', () => runBulk('stop', ids, 'BULK_STOP'), 'إيقاف');
}
function bulkLanguage() {
  const ids = selIds(); if (!ids.length) return;
  pickOpen('', `لغة ${num(ids.length)} سيرفر`, 'تتغير لغة رسائل البوت في كل السيرفرات المحددة.', [['ar', 'عربي'], ['en', 'English']],
    (v) => runBulk('language', ids, 'BULK_LANGUAGE', { language: v }), 'تطبيق');
}
function bulkSchedules() {
  const ids = selIds(); if (!ids.length) return;
  confirmModal('', `إيقاف النشر التلقائي في ${num(ids.length)} سيرفر`, 'يتوقف نشر الأذكار وآية اليوم. يستطيع إداريو كل سيرفر تفعيله من /adhkar.', () => runBulk('schedules', ids, 'BULK_SCHEDULES'), 'إيقاف');
}
function bulkTag() {
  const ids = selIds(); if (!ids.length) return;
  openInputModal('', `وسم ${num(ids.length)} سيرفر`, 'يُضاف الوسم إلى وسوم كل سيرفر (حتى ٨ وسوم، كل وسم ٢٠ حرفًا). خاص بك ولا يُرسل إلى Discord.', { placeholder: 'مثال: شريك', multiline: false, okLabel: 'إضافة' },
    (v) => { if (!v) return toast('اكتب الوسم أولاً', 'error'); runBulk('tag', ids, 'BULK_TAG', { tag: v }); });
}
function bulkExport() { exportGuildsCsv(allGuilds.filter(g => ownerSelected.has(g.id))); }
function bulkLeave(ids = selIds()) {
  if (!ids.length) return;
  confirmModal('', `مغادرة ${num(ids.length)} سيرفر`, 'يغادر البوت كل السيرفرات المحددة ويوقف جلساتها وتُحذف بياناتها. لا رجوع إلا بإعادة الدعوة.',
    () => runBulk('leave', ids, 'BULK_LEAVE'), 'مغادرة', String(ids.length));
}
function bulkBlacklist() {
  const ids = selIds(); if (!ids.length) return;
  openInputModal('', `حظر ${num(ids.length)} سيرفر`, 'اكتب سبب الحظر (اختياري). سيغادر البوت ولن يقبل دعوتها مجددًا.', { placeholder: 'السبب', multiline: false, okLabel: 'متابعة' },
    (reason) => setTimeout(() => confirmModal('', `تأكيد حظر ${num(ids.length)} سيرفر`, 'سيُضافون للقائمة السوداء.',
      () => runBulk('blacklist', ids, 'BULK_BLACKLIST', { reason: reason || undefined }), 'حظر', String(ids.length)), 50));
}

/* ══ Filters: toggles, saved views, paging ══════════════════════════════ */
function gfPersistAndRender() { gShown = G_PAGE; gPrefsWrite(); renderGuilds(); }
function gfToggle(d) { gState.filters.has(d.f) ? gState.filters.delete(d.f) : gState.filters.add(d.f); gfPersistAndRender(); }
function gfReverse() {
  gState.rev = !gState.rev;
  const b = $('guildRevBtn'); b.setAttribute('aria-pressed', String(gState.rev)); b.classList.toggle('on', gState.rev);
  gfPersistAndRender();
}
function gfClear() {
  gApplyView({ f: [], size: '', sort: gState.sort, rev: gState.rev });
  $('guildSearch').value = '';
  gfPersistAndRender();
}
function gfMore() { gShown += G_PAGE; renderGuilds(); }
function gfAll()  { gShown = Number.MAX_SAFE_INTEGER; renderGuilds(); }

const viewsRead = () => { try { const v = JSON.parse(localStorage.getItem('ownerGuildViews') || '[]'); return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string').slice(0, 12) : []; } catch { return []; } };
const viewsWrite = (v) => { try { localStorage.setItem('ownerGuildViews', JSON.stringify(v.slice(0, 12))); } catch { /* optional */ } };
function renderGuildViews() {
  $('gfViews').innerHTML = viewsRead().map((x, i) => `<span class="gf-view">
      <button type="button" data-act="own" data-fn="gfApplyView" data-i="${i}" title="تطبيق العرض">${escHtml(x.name)}</button>
      <button type="button" data-act="own" data-fn="gfDelView" data-i="${i}" aria-label="حذف العرض ${escHtml(x.name)}">✕</button></span>`).join('');
}
function gfSaveView() {
  const q = $('guildSearch').value.trim();
  if (!gState.filters.size && !gState.size && !q) return toast('اختر فلترًا أو اكتب بحثًا أولاً ثم احفظ العرض', 'warning');
  openInputModal('', 'حفظ العرض', 'يحفظ الفلاتر والبحث والترتيب الحالي لتعود إليه بضغطة واحدة (على هذا المتصفح).', { placeholder: 'اسم العرض', multiline: false, okLabel: 'حفظ' },
    (name) => {
      name = name.slice(0, 30); if (!name) return toast('اكتب اسمًا للعرض', 'error');
      viewsWrite([{ name, f: [...gState.filters], size: gState.size, sort: gState.sort, rev: gState.rev, q: q.slice(0, 100) }, ...viewsRead().filter(x => x.name !== name)]);
      renderGuildViews(); toast('تم حفظ العرض ✓', 'success');
    });
}
function gfApplyView(d) {
  const x = viewsRead()[Number(d.i)]; if (!x) return;
  gApplyView({ f: x.f, size: x.size, sort: x.sort, rev: x.rev });
  $('guildSearch').value = typeof x.q === 'string' ? x.q.slice(0, 100) : '';
  gfPersistAndRender();
}
function gfDelView(d) { viewsWrite(viewsRead().filter((_, i) => i !== Number(d.i))); renderGuildViews(); }

/* ══ Server drawer: tabs, navigation, loading ═══════════════════════════ */
let drw = null;                                            // { id, d, ch, rs, nt } of the server shown in the drawer
const BOOST = ['بلا', 'المستوى ١', 'المستوى ٢', 'المستوى ٣'];

function drawerTab(d) {
  const t = d.tab;
  document.querySelectorAll('#gTabs button').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
  document.querySelectorAll('.dr-pane').forEach(p => p.classList.toggle('active', p.id === 'gPane-' + t));
  const body = document.querySelector('.dr-body'); if (body) body.scrollTop = 0;
}
function drawerStep(dir) {
  const list = visibleGuilds(), i = list.findIndex(g => g.id === drawerId);
  if (i < 0 || list.length < 2) return;
  const tab = document.querySelector('#gTabs button.active')?.dataset.tab ?? 'overview';
  openGuildModal(list[(i + dir + list.length) % list.length]);
  drawerTab({ tab });                                      // keep the tab you were on while stepping through servers
}
const drawerNext = () => drawerStep(1), drawerPrev = () => drawerStep(-1);
function copyGuildId() {
  if (!drawerId) return;
  navigator.clipboard?.writeText(drawerId).then(() => toast('نُسخ معرّف السيرفر ✓', 'success'), () => toast('تعذّر النسخ', 'error'));
}

function guildWarnings(d, ch) {
  const w = [];
  const ok = (n) => d.botPerms.find(p => p.name === n)?.ok;
  const miss = ok('Administrator') ? [] : ['SendMessages', 'EmbedLinks', 'Connect', 'Speak'].filter(n => !ok(n));
  if (miss.length) w.push(['red', `ينقص البوت صلاحيات: ${miss.join('، ')}`]);
  const chk = (on, id, label) => {
    if (!on) return;
    const c = ch.text.find(x => x.id === id);
    if (!id || !c) w.push(['red', `${label}: القناة محذوفة أو غير محددة`]);
    else if (!c.canSend) w.push(['red', `${label}: لا يستطيع البوت الكتابة في #${c.name}`]);
  };
  chk(d.settings.adhkar, d.settings.adhkarChannelId, 'الأذكار');
  chk(d.settings.ayah, d.settings.ayahChannelId, 'آية اليوم');
  chk(d.settings.hadith, d.settings.hadithChannelId, 'حديث اليوم');
  if (!d.announceChannel) w.push(['gold', 'لا توجد قناة يستطيع البوت إرسال الإعلانات فيها']);
  if (d.counts.voice && !d.voiceChannels.some(v => v.canJoin)) w.push(['gold', 'لا توجد قناة صوتية يستطيع البوت دخولها']);
  return w;
}

async function ownerGuildDeep(id) {
  const spin = '<span class="spinner"></span>';
  if (drw?.id !== id) for (const t of ['overview', 'voice', 'settings', 'restrict', 'notes']) { const p = t === 'overview' ? $('gModalDeep') : $('gPane-' + t); if (p) p.innerHTML = spin; }
  const owner = isOwner(), q = encodeURIComponent(id);
  let d, ch, rs = null, nt = null;
  try {
    [d, ch, rs, nt] = await Promise.all([
      apiFetch(`/api/admin/guilds/${q}/details`),
      apiFetch(`/api/admin/guilds/${q}/channels`),
      owner ? apiFetch(`/api/admin/guilds/${q}/restrictions`) : null,
      owner ? apiFetch(`/api/admin/guilds/${q}/notes`) : null
    ]);
    if (!surahCache) surahCache = await apiFetch('/api/admin/surahs');
  } catch (err) {
    if (drawerId === id) $('gModalDeep').innerHTML = `<div class="empty">تعذّر تحميل التفاصيل: ${escHtml(err.message)}</div>`;
    return;
  }
  if (drawerId !== id) return;                             // another server was opened meanwhile
  drw = { id, d, ch, rs, nt };
  paneOverview(); paneVoice(); paneSettings(); paneActions();
  if (owner) { paneRestrict(); paneNotes(); }
}
function disableSched(d) {
  confirmModal('', 'إيقاف النشر التلقائي', 'يتوقف نشر الأذكار وآية اليوم في هذا السيرفر. يستطيع إداريوه تفعيله من /adhkar.', async () => {
    try { await post(`/api/admin/guilds/${d.id}/disable-schedules`, {}); toast('تم الإيقاف ✓', 'success'); afterGuildChange(d.id); }
    catch (err) { toast(err.message, 'error'); }
  }, 'إيقاف');
}

/* ══ System monitor ═════════════════════════════════════════════════════ */
function lineChart(key, canvasId, series, labels) {
  const cv = $(canvasId); if (!cv || typeof Chart === 'undefined') return;
  const ds = series.map(s => ({ label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color + '22', fill: !!s.fill, tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: s.axis ?? 'y' }));
  if (ownCharts[key]) { ownCharts[key].data.labels = labels; ownCharts[key].data.datasets.forEach((d, i) => { d.data = ds[i].data; }); ownCharts[key].update('none'); return; }
  const grid = { color: 'rgba(120,130,180,0.1)' }, tick = { color: '#a39d8c', font: { size: 10 } };
  ownCharts[key] = new Chart(cv, {
    type: 'line', data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#a39d8c', boxWidth: 10, font: { size: 11 } } } },
      scales: { x: { grid, ticks: { ...tick, maxTicksLimit: 6 } }, y: { grid, ticks: tick, beginAtZero: true },
                ...(series.some(s => s.axis === 'y1') ? { y1: { position: 'right', grid: { display: false }, ticks: tick, beginAtZero: true } } : {}) } }
  });
}
function sysCard(icon, cls, label, val, sub, pct) {
  const bar = pct == null ? '' : `<div class="sys-bar"><i class="${pct > 90 ? 'bad' : pct > 75 ? 'warn' : ''}" style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>`;
  return `<div class="stat-card"><div class="stat-top"><span>${label}</span><div class="stat-icon-wrap ${cls}">${icon}</div></div><div class="stat-val" style="font-size:1.35rem">${val}</div><div class="stat-sub">${sub}</div>${bar}</div>`;
}
async function loadSystem() {
  try {
    const [s, h, g] = await Promise.all([apiFetch('/api/admin/system'), apiFetch('/api/admin/system/history'), apiFetch('/api/admin/growth?days=30').catch(() => null)]);
    const used = s.hostMem.total - s.hostMem.free;
    const dbOk = s.mongo.state === 'connected';
    $('sysCards').innerHTML =
      sysCard('', 'si-blue', 'المعالج', `${s.cpu}%`, `${s.cores} نواة · load ${s.load.map(x => x.toFixed(2)).join(' / ')}`, s.cpu / s.cores) +
      sysCard('', 'si-purple', 'ذاكرة البوت', fmtBytes(s.proc.rss), `heap ${fmtBytes(s.proc.heapUsed)} / ${fmtBytes(s.proc.heapTotal)}`, (s.proc.heapUsed / s.proc.heapTotal) * 100) +
      sysCard('', 'si-teal', 'ذاكرة الجهاز', fmtBytes(used), `من ${fmtBytes(s.hostMem.total)}`, (used / s.hostMem.total) * 100) +
      sysCard('', s.lag > 100 ? 'si-red' : 'si-green', 'تأخر الحلقة', `${s.lag} ms`, 'p99 آخر ١٥ ثانية', null) +
      sysCard('', s.ping > 300 ? 'si-gold' : 'si-green', 'Discord ping', s.ping < 0 ? '—' : `${s.ping} ms`, `WS status ${s.wsStatus}`, null) +
      sysCard('', dbOk ? 'si-green' : 'si-red', 'MongoDB', dbOk ? 'متصل' : escHtml(s.mongo.state), s.mongo.pingMs != null ? `${s.mongo.pingMs} ms` : 'لا استجابة', null) +
      sysCard('', 'si-orange', 'السيرفرات', num(s.guilds), `${num(s.members)} عضو · ${num(s.sessions)} جلسة`, null) +
      sysCard('', 'si-gold', 'مدة التشغيل', fmtTime(s.uptime), `${escHtml(s.node)} · ${escHtml(s.platform)}${s.maintenance ? ' · صيانة' : ''}`, null);
    $('sysUpdated').textContent = 'آخر تحديث ' + new Date(s.now).toLocaleTimeString('ar-EG');
    const labels = h.map(x => new Date(x.t).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
    lineChart('res', 'sysChartRes', [
      { label: 'CPU %', data: h.map(x => x.cpu), color: '#c9c9cd', fill: true },
      { label: 'RAM MB', data: h.map(x => Math.round(x.rss / 1048576)), color: '#a58bc2', axis: 'y1' }], labels);
    lineChart('lat', 'sysChartLat', [
      { label: 'Ping', data: h.map(x => Math.max(x.ping, 0)), color: '#8f8f96' },
      { label: 'Loop lag', data: h.map(x => x.lag), color: '#c9a24b' }], labels);
    if (g) {
      const gl = g.series.map(x => x.day.slice(5));
      if (ownCharts.growth) { ownCharts.growth.destroy(); delete ownCharts.growth; }
      ownCharts.growth = new Chart($('growthChart'), {
        type: 'bar',
        data: { labels: gl, datasets: [
          { label: 'انضمام', data: g.series.map(x => x.join), backgroundColor: '#c9c9cd99' },
          { label: 'مغادرة', data: g.series.map(x => x.leave), backgroundColor: '#e0675c99' }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { labels: { color: '#a39d8c', boxWidth: 10, font: { size: 11 } } } },
          scales: { x: { grid: { display: false }, ticks: { color: '#a39d8c', font: { size: 10 }, maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { color: '#a39d8c', precision: 0 }, grid: { color: 'rgba(120,130,180,0.1)' } } } }
      });
    }
  } catch (err) { $('sysCards').innerHTML = `<div class="stat-card" style="grid-column:1/-1">فشل التحميل: ${escHtml(err.message)}</div>`; }
}

/* ══ Logs ═══════════════════════════════════════════════════════════════ */
async function loadLogFiles() {
  const sel = $('logFile');
  if (sel.options.length) return;
  try {
    const files = await apiFetch('/api/admin/logs/files');
    sel.innerHTML = files.map(f => `<option value="${escHtml(f.name)}">${escHtml(f.name)} (${fmtBytes(f.size)})</option>`).join('') || '<option value="combined.log">combined.log</option>';
  } catch { sel.innerHTML = '<option value="combined.log">combined.log</option>'; }
}
async function loadLogs() {
  await loadLogFiles();
  const qs = new URLSearchParams({ file: $('logFile').value || 'combined.log', level: $('logLevel').value, limit: $('logLimit').value, q: $('logQuery').value.trim() });
  try {
    const r = await apiFetch('/api/admin/logs?' + qs);
    lastLogRows = r.rows;
    $('logBox').innerHTML = r.rows.length
      ? r.rows.map(x => `<div class="logline lv-${escHtml(x.level)}"><span class="lt">${x.ts ? escHtml(x.ts.replace('T', ' ').slice(5, 19)) : ''}</span><span class="ll">${escHtml(x.level)}</span><span class="lm">${escHtml(x.message)}</span></div>`).join('')
      : '<div class="empty" style="direction:rtl">لا توجد أسطر مطابقة</div>';
  } catch (err) { $('logBox').innerHTML = `<div class="empty" style="direction:rtl">فشل التحميل: ${escHtml(err.message)}</div>`; }
}
function loadLogsDebounced() { clearTimeout(logDebounce); logDebounce = setTimeout(loadLogs, 350); }
function toggleLogAuto() {
  const b = $('logAutoBtn'), on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on);
  clearInterval(logTimer); logTimer = on ? setInterval(() => { if (!document.hidden && $('page-logs').classList.contains('active')) loadLogs(); }, 5000) : null;
}
function downloadLogs() {
  if (!lastLogRows.length) return toast('لا توجد أسطر للتنزيل', 'warning');
  const txt = [...lastLogRows].reverse().map(x => `${x.ts ?? ''} [${x.level}] ${x.message}`).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' })), download: `bot-log-${new Date().toISOString().slice(0, 10)}.txt` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ══ Cleanup ════════════════════════════════════════════════════════════ */
function syncCleanSel() {
  $('cleanLeaveBtn').disabled = !cleanSelected.size;
  $('cleanSelCount').textContent = cleanSelected.size ? `${num(cleanSelected.size)} محدد` : '';
  const all = $('selAllClean');
  all.checked = cleanRows.length > 0 && cleanRows.every(r => cleanSelected.has(r.id));
  all.indeterminate = !all.checked && cleanSelected.size > 0;
}
async function scanCleanup() {
  const body = $('cleanBody');
  body.innerHTML = '<tr><td colspan="6"><span class="spinner"></span></td></tr>';
  cleanSelected.clear();
  try {
    const r = await apiFetch(`/api/admin/guilds/inactive?days=${$('cleanDays').value}&maxMembers=${$('cleanMax').value}`);
    cleanRows = r.rows;
    $('cleanTitle').textContent = `سيرفرات يبدو أنها مهجورة (${num(r.total)})`;
    body.innerHTML = r.rows.length ? r.rows.map(g => `<tr>
      <td><input type="checkbox" class="sel" data-act="own" data-fn="selClean" data-id="${escHtml(g.id)}" aria-label="تحديد ${escHtml(g.name)}"></td>
      <td><div class="guild-cell" style="cursor:pointer" data-act="openGuild" data-id="${escHtml(g.id)}">
        ${g.icon ? `<img class="guild-icon-img" src="${escHtml(g.icon)}" alt="" data-initial="${escHtml((g.name ?? '?')[0])}">` : `<div class="guild-icon-text">${escHtml((g.name ?? '?')[0])}</div>`}
        <div><div class="guild-name">${escHtml(g.name)}</div><div class="guild-id">${escHtml(g.id)}</div></div></div></td>
      <td data-label="الأعضاء">${num(g.memberCount)}</td>
      <td data-label="انضم">${fmtDate(g.joinedAt)}</td>
      <td data-label="آخر نشاط">${g.lastActivity ? timeAgo(g.lastActivity) : '<span class="chip chip-muted">لا يوجد</span>'}</td>
      <td data-label="تلاوة؟">${g.neverPlayed ? '<span class="chip chip-red">لم يشغّل أبدًا</span>' : '<span class="chip chip-muted">سبق</span>'}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">لا توجد سيرفرات مطابقة</td></tr>';
    if (r.total > r.rows.length) toast(`عُرض أقدم ${num(r.rows.length)} فقط من ${num(r.total)}`, 'info');
    syncCleanSel();
  } catch (err) { body.innerHTML = `<tr><td colspan="6" class="empty">فشل الفحص: ${escHtml(err.message)}</td></tr>`; }
}
function selClean(d, el) { el.checked ? cleanSelected.add(d.id) : cleanSelected.delete(d.id); syncCleanSel(); }
function selAllClean(_d, el) {
  cleanRows.forEach(r => el.checked ? cleanSelected.add(r.id) : cleanSelected.delete(r.id));
  document.querySelectorAll('#cleanBody input.sel').forEach(c => { c.checked = el.checked; });
  syncCleanSel();
}
function cleanLeave() { bulkLeave([...cleanSelected].slice(0, 100)); }

/* ══ Bot presence status ════════════════════════════════════════════════ */
async function botStatus(d) {
  try { await post('/api/admin/bot/status', { status: d.status }); toast('تم تغيير الحالة ✓', 'success'); }
  catch (err) { toast(err.message, 'error'); }
}


/* ══ Roles ══════════════════════════════════════════════════════════════ */
// Moderators (MOD_IDS) get a limited dashboard: everything marked data-owner is hidden (the server refuses those routes anyway).
function applyRole() {
  const mod = currentUser?.role === 'mod';
  document.body.classList.toggle('role-mod', mod);
  const b = $('roleBadge'); if (b) b.textContent = mod ? 'مشرف' : 'المالك';
}

/* ══ Drawer panes ═══════════════════════════════════════════════════════ */
let surahCache = null, reciterTimer = null;
const optList = (list, sel, ok = () => true, extra = () => '') => list.map(c =>
  `<option value="${escHtml(c.id)}"${c.id === sel ? ' selected' : ''}${ok(c) ? '' : ' disabled'}>${c.stage ? '[منصة] ' : ''}#${escHtml(c.name)}${c.parent ? ' — ' + escHtml(c.parent) : ''}${extra(c)}${ok(c) ? '' : ' (لا صلاحية)'}</option>`).join('');
const chk = (idn, on, label) => `<label class="adv-check"><input type="checkbox" class="sel" id="${idn}"${on ? ' checked' : ''}> ${label}</label>`;
const gname = () => escHtml($('gModalName').textContent);

function paneOverview() {
  const { d } = drw, ch = drw.ch, s = d.settings;
  const chip = (ok, label) => `<span class="chip ${ok ? 'chip-green' : 'chip-red'}">${ok ? '✓' : '✗'} ${escHtml(label)}</span>`;
  const cell = (l, v) => `<div class="detail-item"><div class="detail-label">${l}</div><div class="detail-val" style="font-size:0.8rem">${v}</div></div>`;
  const warns = guildWarnings(d, ch);
  $('gModalDeep').innerHTML = `
    ${warns.length ? `<div class="dr-card danger"><h4>يحتاج انتباه</h4>${warns.map(([c, t]) => `<div><span class="chip chip-${c}">${escHtml(t)}</span></div>`).join('')}
      ${(s.adhkar || s.ayah || s.hadith) && warns.some(([, t]) => /الأذكار|آية|حديث/.test(t)) ? `<div><button class="btn btn-warning btn-sm" data-act="own" data-fn="disableSched" data-id="${escHtml(d.id)}">إيقاف النشر التلقائي المعطّل</button></div>` : ''}</div>` : ''}
    <div class="guild-detail-grid" style="margin-top:0.8rem">
      ${cell('OWNER', escHtml(d.ownerName ?? d.ownerId ?? '—'))}
      ${cell('CREATED', fmtDate(d.createdAt))}
      ${cell('CHANNELS', `${num(d.counts.text)} نصية · ${num(d.counts.voice)} صوتية`)}
      ${cell('ROLES', num(d.counts.roles))}
      ${cell('BOOST', `${BOOST[d.boostTier] ?? d.boostTier} · ${num(d.boosts)}`)}
      ${cell('ANNOUNCE IN', d.announceChannel ? '#' + escHtml(d.announceChannel) : '<span class="chip chip-red">لا قناة متاحة</span>')}
    </div>
    <div class="deep-sec"><div class="deep-h">صلاحيات البوت</div><div class="perm-row">${d.botPerms.map(p => chip(p.ok, p.name)).join('')}</div></div>
    <div class="deep-sec"><div class="deep-h">الميزات المفعّلة</div><div class="perm-row">
      ${chip(s.adhkar, 'أذكار')}${chip(s.adhkarScatter, 'أذكار متفرقة')}${chip(s.ayah, 'آية اليوم')}${chip(s.hadith, 'حديث اليوم')}${chip(s.wirdRoom, 'غرفة الورد')}${chip(s.setupDone, '/setup')}
      ${d.blacklisted ? '<span class="chip chip-red">محظور</span>' : ''}
    </div></div>
    <div class="deep-sec"><div class="deep-h">القنوات الصوتية (${num(d.counts.voice)})</div>
      ${d.voiceChannels.length ? d.voiceChannels.map(v => `<div class="vc-row"><span style="flex:1">${escHtml(v.name)}</span><span style="color:var(--muted)">${num(v.members)} عضو</span>${v.canJoin ? '<span class="chip chip-green">يستطيع الدخول</span>' : '<span class="chip chip-red">لا صلاحية</span>'}</div>`).join('') : '<span style="color:var(--muted);font-size:0.8rem">لا توجد</span>'}
    </div>`;
}

function paneVoice() {
  const { d, ch } = drw, live = d.session, id = escHtml(d.id);
  const paused = live?.status === 'paused';
  $('gPane-voice').innerHTML = `
    ${live ? `<div class="dr-card np-card"><h4>الجلسة الحالية</h4>
      <div class="np-title">${escHtml(live.surah ?? 'لا شيء يُشغَّل الآن')}</div>
      <div class="dr-hint">${live.reciter ? escHtml(live.reciter) + ' · ' : ''}#${escHtml(live.channel ?? '—')} · الطابور ${num(live.queue)} · <span class="chip ${paused ? 'chip-gold' : 'chip-green'}">${paused ? 'متوقفة مؤقتًا' : escHtml(live.status)}</span></div>
      <div class="np-ctl">
        <button class="btn btn-ghost btn-sm" data-act="own" data-fn="drvCtl" data-id="${id}" data-op="${paused ? 'resume' : 'pause'}">${paused ? 'استئناف' : 'إيقاف مؤقت'}</button>
        <button class="btn btn-ghost btn-sm" data-act="own" data-fn="drvCtl" data-id="${id}" data-op="skip">التالي</button>
        <button class="btn btn-ghost btn-sm${live.loop ? ' on' : ''}" data-act="own" data-fn="drvCtl" data-id="${id}" data-op="loop" aria-pressed="${live.loop}">تكرار</button>
        <button class="btn btn-danger btn-sm" data-act="stopSession" data-id="${id}" data-name="${gname()}">إيقاف وخروج</button>
      </div>
      <div class="np-ctl"><label class="np-vol"><input type="range" id="drvVol" data-id="${id}" min="0" max="150" step="5" value="${live.volume}" aria-label="مستوى الصوت"><output id="drvVolOut">${live.volume}%</output></label></div>
    </div>
    <div class="dr-card" id="drvQueue"><h4>الطابور</h4><div class="dr-hint"><span class="spinner"></span></div></div>` : ''}
    <div class="dr-card"><h4>${live ? 'إضافة سورة للطابور' : 'دخول وتشغيل'}</h4>
      ${live
        ? `<div class="dr-hint">البوت الآن في <b>#${escHtml(live.channel ?? '—')}</b> — أي سورة تشغّلها تُضاف لطابوره. لنقله لقناة أخرى أوقف الجلسة أولاً.</div>`
        : `<label>القناة الصوتية</label>
           <select class="field" id="advVc">${ch.voice.length ? optList(ch.voice, '', c => c.canJoin, c => ` · ${c.members} عضو`) : '<option value="">لا توجد قنوات صوتية</option>'}</select>`}
      <label>السورة</label>
      <select class="field" id="advSurah">${surahCache.map(x => `<option value="${x.number}">${x.number}. ${escHtml(x.arabic)} — ${escHtml(x.english)}</option>`).join('')}</select>
      <label>القارئ (اختياري — الافتراضي قارئ السيرفر)</label>
      <input class="field" id="advReciter" list="advReciterList" placeholder="ابدأ الكتابة للبحث…" autocomplete="off">
      <datalist id="advReciterList"></datalist>
      <div class="adv-row">
        ${live ? '' : `<button class="btn btn-ghost btn-sm" data-act="own" data-fn="advJoin" data-id="${id}">دخول فقط</button>`}
        <button class="btn btn-primary btn-sm" data-act="own" data-fn="advPlay" data-id="${id}">${live ? 'إضافة للطابور' : 'دخول وتشغيل'}</button>
      </div>
    </div>`;
  if (live) drvQueueLoad(d.id);
}

function paneSettings() {
  const { d, ch } = drw, s = d.settings, id = escHtml(d.id);
  const sendOk = c => c.canSend;
  const textOpts = sel => `<option value="">— بدون / غير محددة —</option>` + optList(ch.text, sel, sendOk);
  $('gPane-settings').innerHTML = `
    <div class="dr-card"><h4>إعدادات السيرفر</h4>
      <label>اللغة</label>
      <select class="field" id="advLang"><option value="ar"${s.language === 'ar' ? ' selected' : ''}>عربي</option><option value="en"${s.language === 'en' ? ' selected' : ''}>English</option></select>
      <label>قناة الأذكار</label>
      <select class="field" id="advAdhkarCh">${textOpts(s.adhkarChannelId)}</select>
      ${chk('advAdhkarOn', s.adhkar, 'تفعيل أذكار الصباح والمساء')}
      <label>قناة آية اليوم</label>
      <select class="field" id="advAyahCh">${textOpts(s.ayahChannelId)}</select>
      ${chk('advAyahOn', s.ayah, 'تفعيل آية اليوم')}
      <label>قناة حديث اليوم</label>
      <select class="field" id="advHadithCh">${textOpts(s.hadithChannelId)}</select>
      ${chk('advHadithOn', s.hadith, 'تفعيل حديث اليوم')}
      <div class="adv-row"><button class="btn btn-primary btn-sm" data-act="own" data-fn="advSaveConfig" data-id="${id}">حفظ الإعدادات</button></div>
    </div>
    <div class="dr-card"><h4>رسالة إلى هذا السيرفر</h4>
      <label>القناة</label>
      <select class="field" id="advMsgCh"><option value="">القناة الافتراضية (${d.announceChannel ? '#' + escHtml(d.announceChannel) : 'لا توجد'})</option>${optList(ch.text, '', sendOk)}</select>
      <input class="field" id="advMsgTitle" maxlength="200" placeholder="العنوان (اختياري)">
      <textarea class="field" id="advMsgBody" rows="4" maxlength="1500" placeholder="نص الرسالة…"></textarea>
      <div class="adv-row"><button class="btn btn-primary btn-sm" data-act="own" data-fn="advSend" data-id="${id}">إرسال</button></div>
    </div>`;
}

function paneRestrict() {
  const { d, rs } = drw, id = escHtml(d.id), r = rs.restrictions;
  const locked = d.settings.locked, until = d.settings.lockedUntil;
  $('gPane-restrict').innerHTML = `
    <div class="dr-card ${locked ? 'danger' : ''}"><h4>قفل السيرفر</h4>
      <div>${locked
        ? `<span class="chip chip-orange">مقفل</span> <span class="dr-hint">${until ? `يُفتح تلقائيًا بعد ${fmtRemain(until - Date.now())} (${fmtDate(new Date(until).toISOString())})` : 'حتى تفتحه يدويًا'}</span>`
        : '<span class="chip chip-green">مفتوح</span>'}</div>
      <div class="dr-hint">وضع القراءة فقط: لا أحد يستخدم أوامر البوت وأزراره. تبقى الأذكار المجدولة وصفحات المصحف والأوامر /help /invite /donation.</div>
      <div class="adv-row">${locked
        ? `<button class="btn btn-primary btn-sm" data-act="own" data-fn="quickLock" data-id="${id}" data-name="${gname()}" data-locked="1">فتح الآن</button>
           <button class="btn btn-ghost btn-sm" data-act="own" data-fn="lockAsk" data-id="${id}" data-name="${gname()}">تغيير المدة</button>`
        : `<button class="btn btn-warning btn-sm" data-act="own" data-fn="quickLock" data-id="${id}" data-name="${gname()}" data-locked="0">قفل…</button>`}</div>
    </div>
    <div class="dr-card"><h4>أوامر معطّلة وحد الطابور</h4>
      <label>الأوامر المعطّلة (اضغط لتعطيل/تفعيل)</label>
      <div class="perm-row" id="advCmds">${rs.commands.map(c => `<span class="chip chip-muted cmd-chip${r.disabledCommands.includes(c) ? ' on' : ''}" data-act="own" data-fn="advToggleCmd" data-cmd="${escHtml(c)}">/${escHtml(c)}</span>`).join('')}</div>
      <div class="adv-row"><button class="btn btn-ghost btn-sm" data-act="own" data-fn="advVoicePreset" data-voice="${escHtml(rs.voiceCommands.join(','))}">منع أوامر الصوت</button></div>
      <label>أقصى طول للطابور (اتركه فارغًا = الافتراضي ${num(rs.maxQueueGlobal)})</label>
      <input class="field" id="advMaxQueue" type="number" min="1" max="${rs.maxQueueGlobal}" value="${r.maxQueue ?? ''}">
      <label>ملاحظة تظهر لمن يحاول (اختياري)</label>
      <input class="field" id="advNote" maxlength="200" value="${escHtml(r.note)}">
      <div class="adv-row"><button class="btn btn-danger btn-sm" data-act="own" data-fn="advSaveRestrict" data-id="${id}">حفظ القيود</button></div>
    </div>`;
}

function paneNotes() {
  const { d, nt } = drw;
  $('gPane-notes').innerHTML = `
    <div class="dr-card"><h4>ملاحظات ووسوم (خاصة بك)</h4>
      <label>الوسوم (افصل بفاصلة — حتى ٨، كل وسم ٢٠ حرفًا)</label>
      <input class="field" id="advTags" maxlength="200" value="${escHtml(nt.tags.join(', '))}" placeholder="مثال: VIP, شريك, مراقبة">
      <label>ملاحظة</label>
      <textarea class="field" id="advGNote" rows="4" maxlength="1000" placeholder="لا تظهر لأحد غيرك ولا تُرسل إلى Discord">${escHtml(nt.note)}</textarea>
      ${nt.updatedBy ? `<div class="dr-hint">آخر تعديل: ${escHtml(nt.updatedBy)} · ${fmtDate(nt.updatedAt)}</div>` : ''}
      <div class="adv-row"><button class="btn btn-primary btn-sm" data-act="own" data-fn="advSaveNotes" data-id="${escHtml(d.id)}">حفظ</button></div>
    </div>`;
}

function paneActions() {
  const { d } = drw, s = d.settings, id = escHtml(d.id), name = gname(), g = allGuilds.find(x => x.id === d.id);
  const lang = (g?.language ?? s.language) === 'ar' ? 'en' : 'ar';
  $('gModalActions').innerHTML = `
    <div class="dr-card"><h4>إدارة</h4>
      <div class="adv-row">
        <button class="btn btn-ghost btn-sm" data-act="changeLang" data-id="${id}" data-lang="${lang}">تغيير اللغة إلى ${lang === 'ar' ? 'العربية' : 'English'}</button>
        ${(s.adhkar || s.ayah || s.hadith) ? `<button class="btn btn-warning btn-sm" data-act="own" data-fn="disableSched" data-id="${id}">إيقاف النشر التلقائي</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-act="own" data-fn="drawerTab" data-tab="settings">إرسال رسالة</button>
      </div>
    </div>
    <div class="dr-card danger" data-owner><h4>منطقة الخطر</h4>
      <div class="dr-hint">هذه الإجراءات لا يمكن التراجع عنها بضغطة واحدة، وكلها تطلب تأكيدًا.</div>
      <div class="adv-row">
        <button class="btn btn-danger btn-sm" data-act="resetStats" data-id="${id}" data-name="${name}">إعادة ضبط الإحصائيات</button>
        <button class="btn btn-danger btn-sm" data-act="leaveGuild" data-id="${id}" data-name="${name}" data-close="1">مغادرة السيرفر</button>
        <button class="btn btn-danger btn-sm" data-act="blacklistFromModal" data-id="${id}" data-name="${name}">حظر السيرفر</button>
      </div>
    </div>`;
}

/* ══ Drawer actions ═════════════════════════════════════════════════════ */
const advErr = err => toast(err.message, 'error');

async function drvCtl(d) {
  try {
    const r = await post(`/api/admin/sessions/${encodeURIComponent(d.id)}/control`, { action: d.op });
    toast(d.op === 'loop' ? (r.loop ? 'التكرار: مفعّل ✓' : 'التكرار: متوقف ✓') : 'تم ✓', 'success');
    setTimeout(() => { if (drawerId === d.id) ownerGuildDeep(d.id); }, 600);
  } catch (e) { advErr(e); }
}
document.addEventListener('input', (e) => { if (e.target?.id === 'drvVol') $('drvVolOut').textContent = `${e.target.value}%`; });
document.addEventListener('change', async (e) => {
  if (e.target?.id !== 'drvVol') return;
  try { await post(`/api/admin/sessions/${encodeURIComponent(e.target.dataset.id)}/control`, { action: 'volume', value: Number(e.target.value) }); toast(`مستوى الصوت ${e.target.value}% ✓`, 'success'); }
  catch (err) { advErr(err); }
});

async function advJoin(d) {
  const vc = $('advVc')?.value; if (!vc) return toast('اختر قناة صوتية', 'error');
  try { const r = await post(`/api/admin/guilds/${d.id}/join`, { voiceChannelId: vc }); toast(`دخل البوت #${r.channel} ✓`, 'success'); afterGuildChange(d.id); } catch (e) { advErr(e); }
}
async function advPlay(d) {
  const vc = $('advVc')?.value;
  const body = { surah: Number($('advSurah').value), reciter: $('advReciter').value.trim() || undefined, ...(vc ? { voiceChannelId: vc } : {}) };
  if ($('advVc') && !vc) return toast('اختر قناة صوتية', 'error');
  try {
    const r = await post(`/api/admin/guilds/${d.id}/play`, body);
    toast(r.queued ? `أُضيفت للطابور: ${r.surah} ✓` : `يشغّل الآن: ${r.surah} — ${r.reciter} ✓`, 'success');
    afterGuildChange(d.id);
  } catch (e) { advErr(e); }
}
async function advSaveConfig(d) {
  const body = { language: $('advLang').value,
    adhkarChannelId: $('advAdhkarCh').value || null, adhkarEnabled: $('advAdhkarOn').checked && !!$('advAdhkarCh').value,
    ayahChannelId: $('advAyahCh').value || null, ayahEnabled: $('advAyahOn').checked && !!$('advAyahCh').value,
    hadithChannelId: $('advHadithCh').value || null, hadithEnabled: $('advHadithOn').checked && !!$('advHadithCh').value };
  if (($('advAdhkarOn').checked && !$('advAdhkarCh').value) || ($('advAyahOn').checked && !$('advAyahCh').value) || ($('advHadithOn').checked && !$('advHadithCh').value)) return toast('اختر قناة قبل تفعيل النشر', 'error');
  try { await post(`/api/admin/guilds/${d.id}/config`, body); toast('تم حفظ الإعدادات ✓', 'success'); afterGuildChange(d.id); } catch (e) { advErr(e); }
}
function advSend(d) {
  const message = $('advMsgBody').value.trim(); if (!message) return toast('اكتب الرسالة أولاً', 'error');
  const channelId = $('advMsgCh').value || undefined, title = $('advMsgTitle').value.trim() || undefined;
  confirmModal('', 'إرسال الرسالة', channelId ? 'سترسل إلى القناة المحددة.' : 'سترسل إلى القناة الافتراضية للإعلانات.', async () => {
    try { const r = await post(`/api/admin/guilds/${d.id}/message`, { message, title, channelId }); toast(`أُرسلت في #${r.channel} ✓`, 'success'); $('advMsgBody').value = ''; } catch (e) { advErr(e); }
  }, 'إرسال');
}
function advToggleCmd(_d, el) { el.classList.toggle('on'); }
function advVoicePreset(d) {
  const set = new Set(d.voice.split(',').filter(Boolean));
  document.querySelectorAll('#advCmds .cmd-chip').forEach(c => c.classList.toggle('on', set.has(c.dataset.cmd) || c.classList.contains('on')));
  toast('عُلّمت أوامر الصوت — اضغط «حفظ القيود»', 'info');
}
async function advSaveRestrict(d) {
  const mq = $('advMaxQueue').value.trim();
  // `locked` is not sent: the lock has its own buttons (with a timer) and the server keeps it as it is
  const body = { disabledCommands: [...document.querySelectorAll('#advCmds .cmd-chip.on')].map(c => c.dataset.cmd),
    maxQueue: mq ? Number(mq) : null, note: $('advNote').value.trim() || undefined };
  try { await post(`/api/admin/guilds/${d.id}/restrictions`, body); toast('تم حفظ القيود ✓', 'success'); afterGuildChange(d.id); } catch (e) { advErr(e); }
}

// Reciter search-as-you-type (datalist)
document.addEventListener('input', (e) => {
  if (e.target?.id !== 'advReciter' && e.target?.id !== 'remReciter') return;
  clearTimeout(reciterTimer);
  reciterTimer = setTimeout(async () => {
    try {
      const list = await apiFetch('/api/admin/reciters?q=' + encodeURIComponent(e.target.value.trim()));
      const html = list.slice(0, 25).map(r => `<option value="${escHtml(r.name)}"></option>`).join('');
      const dl = $(e.target.id === 'remReciter' ? 'remReciterList' : 'advReciterList'); if (dl) dl.innerHTML = html;
    } catch { /* picker only */ }
  }, 300);
});

/* ── Keyboard: "/" focuses the search, ← → step through servers while the drawer is open ── */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
  if (typing || document.querySelector('.modal-overlay.open')) return;
  if (e.key === '/' && !isDrawerOpen() && $('page-guilds').classList.contains('active')) { e.preventDefault(); $('guildSearch').focus(); }
  else if (e.key === 'ArrowLeft'  && isDrawerOpen()) { e.preventDefault(); drawerStep(1); }
  else if (e.key === 'ArrowRight' && isDrawerOpen()) { e.preventDefault(); drawerStep(-1); }
});


/* ══ Remote play page: any server, any voice channel, any surah ═════════ */
const remGuilds = [];
const remAll = () => (allGuilds.length ? allGuilds : remGuilds);

async function remoteInit() {
  try {
    if (!allGuilds.length) allGuilds = await apiFetch('/api/admin/guilds');
    if (!surahCache) surahCache = await apiFetch('/api/admin/surahs');
  } catch (err) { return toast(err.message, 'error'); }
  $('remSurah').innerHTML = surahCache.map(x => `<option value="${x.number}">${x.number}. ${escHtml(x.arabic)} — ${escHtml(x.english)}</option>`).join('');
  remoteFilter();
}
function remoteFilter() {
  const q = $('remGuildQ').value.trim().toLowerCase(), cur = $('remGuild').value;
  const list = [...remAll()].filter(g => !q || (g.name ?? '').toLowerCase().includes(q) || g.id.includes(q)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  $('remGuild').innerHTML = list.length
    ? list.map(g => `<option value="${escHtml(g.id)}"${g.id === cur ? ' selected' : ''}>${escHtml(g.name)}${g.hasSession ? ' · نشط' : ''} (${num(g.memberCount)})</option>`).join('')
    : '<option value="">لا توجد نتائج</option>';
  $('remGuild').size = list.length > 1 && q ? Math.min(list.length, 6) : 1;
  if ($('remGuild').value !== cur) remoteGuildChanged();
}
async function remoteGuildChanged() {
  const id = $('remGuild').value, vc = $('remVc'), st = $('remStatus');
  if (!id) { vc.innerHTML = '<option value="">اختر السيرفر أولاً</option>'; st.textContent = ''; return; }
  vc.innerHTML = '<option value="">…جارٍ التحميل</option>'; st.textContent = '';
  try {
    const [ch, live] = await Promise.all([apiFetch(`/api/admin/guilds/${encodeURIComponent(id)}/channels`), apiFetch('/api/sessions')]);
    if ($('remGuild').value !== id) return;
    vc.innerHTML = ch.voice.length
      ? optList(ch.voice, '', c => c.canJoin, c => ` · ${c.members} عضو`)
      : '<option value="">لا توجد قنوات صوتية في هذا السيرفر</option>';
    const s = live.find(x => x.guildId === id);
    st.innerHTML = s ? `البوت الآن في <b>#${escHtml(s.channel ?? '—')}</b>${s.surahAr ? ' يشغّل ' + escHtml(s.surahAr) : ''}` : 'البوت غير متصل بصوت في هذا السيرفر.';
  } catch (err) { vc.innerHTML = '<option value="">تعذّر التحميل</option>'; toast(err.message, 'error'); }
}
function remBody() {
  const guildId = $('remGuild').value, voiceChannelId = $('remVc').value;
  if (!guildId) { toast('اختر السيرفر', 'error'); return null; }
  if (!voiceChannelId) { toast('اختر قناة صوتية', 'error'); return null; }
  return { guildId, voiceChannelId, replace: $('remMove').checked };
}
async function remJoin() {
  const b = remBody(); if (!b) return;
  try { const r = await post(`/api/admin/guilds/${b.guildId}/join`, { voiceChannelId: b.voiceChannelId, replace: b.replace }); toast(`دخل البوت #${r.channel} ✓`, 'success'); remoteGuildChanged(); loadGuilds(); }
  catch (e) { toast(e.message, 'error'); }
}
async function remPlay() {
  const b = remBody(); if (!b) return;
  try {
    const r = await post(`/api/admin/guilds/${b.guildId}/play`, { voiceChannelId: b.voiceChannelId, replace: b.replace, surah: Number($('remSurah').value), reciter: $('remReciter').value.trim() || undefined });
    toast(r.queued ? `أُضيفت للطابور: ${r.surah} ✓` : `يشغّل الآن: ${r.surah} — ${r.reciter} ✓`, 'success');
    remoteGuildChanged(); loadGuilds();
  } catch (e) { toast(e.message, 'error'); }
}


/* ══════════════════════════════════════════════════════════════════════════
   Phase 4 — alerts · server health · private tags/notes · audit search · scheduled announcements · Ctrl+K
   ══════════════════════════════════════════════════════════════════════════ */
const isOwner = () => currentUser?.role === 'owner';

function downloadCsv(name, rows) {
  const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ── Private tags (shown in the servers table, searchable) ─────────────── */
let ownerTags = {};
const tagsOf = id => ownerTags[id]?.tags ?? [];
const tagChips = id => tagsOf(id).map(t => `<span class="tag-chip">${escHtml(t)}</span>`).join('') + (ownerTags[id]?.hasNote ? '<span class="tag-chip" title="لديه ملاحظة">ملاحظة</span>' : '');
async function refreshTags() {
  if (!isOwner()) { ownerTags = {}; return; }
  try { ownerTags = await apiFetch('/api/admin/tags'); } catch { /* keep the previous value */ }
}
async function advSaveNotes(d) {
  const tags = $('advTags').value.split(/[,،]/).map(t => t.trim()).filter(Boolean);
  try {
    const r = await post(`/api/admin/guilds/${d.id}/notes`, { note: $('advGNote').value, tags });
    toast(r.tags.length || r.note ? 'تم حفظ الملاحظة والوسوم ✓' : 'تم الحذف ✓', 'success');
    await refreshTags(); renderGuilds(); if (drawerId === d.id) { const g = allGuilds.find(x => x.id === d.id); if (g) renderDrawerHead(g); }
  } catch (e) { toast(e.message, 'error'); }
}

/* ── Alerts (overview) ─────────────────────────────────────────────────── */
function setBadge(id, n) { const b = $(id); if (!b) return; b.textContent = num(n); b.style.display = n > 0 ? 'inline' : 'none'; }
async function loadAlerts() {
  if (!isOwner()) return;
  const box = $('ovAlerts'); if (!box) return;
  try {
    const r = await apiFetch('/api/admin/alerts');
    box.innerHTML = r.alerts.length
      ? `<div class="alert-list">${r.alerts.map(a => `<div class="alert-item ${escHtml(a.level)}" data-act="goto" data-goto="${escHtml(a.page ?? 'overview')}" role="link" tabindex="0">
          <span class="lv-dot"></span><div><div class="at">${escHtml(a.title)}</div><div class="ad">${escHtml(a.detail)}</div></div></div>`).join('')}</div>`
      : '<div class="alert-ok">كل شيء يعمل بشكل سليم — لا توجد تنبيهات.</div>';
    $('alertsUpdated').textContent = 'آخر تحديث ' + new Date(r.at).toLocaleTimeString('ar-EG');
    setBadge('alertsBadge', r.counts.critical + r.counts.warn);
    Object.assign($('alertsBadge').style, r.counts.critical ? { background: '', color: '', borderColor: '' } : { background: 'rgba(201,162,75,0.15)', color: 'var(--gold2)', borderColor: 'rgba(201,162,75,0.3)' });
    setBadge('healthBadge', r.health?.critical ?? 0);
  } catch (err) { box.innerHTML = `<div class="empty">تعذّر تحميل التنبيهات: ${escHtml(err.message)}</div>`; }
}

/* ── Server health ─────────────────────────────────────────────────────── */
let healthData = null;
async function loadHealth(fresh = true) {
  if (!isOwner()) return;
  $('healthBody').innerHTML = '<tr><td colspan="4"><span class="spinner"></span></td></tr>';
  try {
    if (!allGuilds.length) allGuilds = await apiFetch('/api/admin/guilds');
    healthData = await apiFetch('/api/admin/health/guilds' + (fresh ? '?fresh=1' : ''));
    const s = healthData.summary;
    $('healthCards').innerHTML =
      sysCard('', 'si-blue', 'السيرفرات', num(s.total), 'تم فحصها', null) +
      sysCard('', 'si-green', 'سليمة', num(s.ok), `${s.total ? Math.round((s.ok / s.total) * 100) : 0}% من الكل`, null) +
      sysCard('', 'si-gold', 'تحذيرات', num(s.warn), 'قابلة للإصلاح', null) +
      sysCard('', s.critical ? 'si-red' : 'si-green', 'حرجة', num(s.critical), 'ميزة أساسية متوقفة', null);
    $('healthUpdated').textContent = 'آخر فحص ' + new Date(healthData.at).toLocaleTimeString('ar-EG');
    setBadge('healthBadge', s.critical);
    healthRender();
  } catch (err) { $('healthBody').innerHTML = `<tr><td colspan="4" class="empty">فشل الفحص: ${escHtml(err.message)}</td></tr>`; }
}
function healthRender() {
  if (!healthData) return;
  const f = $('healthFilter').value;
  const rows = healthData.rows.filter(r => !f || r.level === f);
  $('healthTitle').textContent = `السيرفرات التي فيها مشاكل (${num(rows.length)})`;
  $('healthBody').innerHTML = rows.length ? rows.map(r => {
    const sched = r.issues.some(i => /^(adhkar|ayah|hadith)_/.test(i.code));
    return `<tr>
      <td><div class="guild-cell" style="cursor:pointer" data-act="openGuild" data-id="${escHtml(r.id)}">
        ${r.icon ? `<img class="guild-icon-img" src="${escHtml(r.icon)}" alt="" data-initial="${escHtml((r.name ?? '?')[0])}">` : `<div class="guild-icon-text">${escHtml((r.name ?? '?')[0])}</div>`}
        <div><div class="guild-name">${escHtml(r.name)}</div><div class="guild-id">${escHtml(r.id)}</div></div></div></td>
      <td data-label="الأعضاء">${num(r.memberCount)}</td>
      <td data-label="المشاكل"><div class="issue-list">${r.issues.map(i => `<span class="chip ${i.level === 'critical' ? 'chip-red' : 'chip-gold'}">${escHtml(i.label)}</span>`).join('')}</div></td>
      <td class="td-actions"><div style="display:flex;gap:0.3rem;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" data-act="openGuild" data-id="${escHtml(r.id)}">تفاصيل</button>
        ${sched ? `<button class="btn btn-warning btn-sm" data-act="own" data-fn="healthDisable" data-id="${escHtml(r.id)}">إيقاف النشر</button>` : ''}
      </div></td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">${healthData.summary.total ? 'لا توجد مشاكل مطابقة' : 'لا توجد سيرفرات.'}</td></tr>`;
}
function healthDisable(d) {
  confirmModal('', 'إيقاف النشر التلقائي', 'يتوقف نشر الأذكار وآية اليوم في هذا السيرفر حتى يختار إداريوه قناة صالحة من /adhkar.', async () => {
    try { await post(`/api/admin/guilds/${d.id}/disable-schedules`, {}); toast('تم الإيقاف ✓', 'success'); loadHealth(true); }
    catch (err) { toast(err.message, 'error'); }
  }, 'إيقاف');
}

/* ── Audit search (activity page) ──────────────────────────────────────── */
let auditActive = false, auditRows = [], auditTotal = 0;
function auditParams(skip, limit) {
  const p = new URLSearchParams({ limit, skip });
  for (const [k, id] of [['type', 'auditType'], ['actor', 'auditActor'], ['q', 'auditText']]) if ($(id).value.trim()) p.set(k, $(id).value.trim());
  if ($('auditFrom').value) p.set('from', new Date($('auditFrom').value + 'T00:00:00').toISOString());
  if ($('auditTo').value)   p.set('to', new Date($('auditTo').value + 'T23:59:59.999').toISOString());
  return p;
}
function auditRender() {
  $('activityCount').textContent = `نتائج البحث (${num(auditRows.length)} من ${num(auditTotal)})`;
  $('activityList').innerHTML = auditRows.length ? auditRows.map(l => `
    <div class="log-item">
      <span class="log-icon"></span>
      <div class="log-body"><div class="log-action">${escHtml(l.action)}</div><div class="log-meta">${escHtml(l.meta || '')}${l.actor ? ` · ${escHtml(l.actor)}` : ''}</div></div>
      <span class="log-time" title="${escHtml(fmtDate(l.ts))}">${timeAgo(l.ts)}</span>
    </div>`).join('') : '<div class="empty">لا توجد نتائج مطابقة</div>';
  $('auditMoreBtn').style.display = auditRows.length < auditTotal ? '' : 'none';
}
async function auditSearch(more = false) {
  auditActive = true;
  const skip = more === true ? auditRows.length : 0;
  try {
    const r = await apiFetch('/api/admin/audit?' + auditParams(skip, 200));
    auditRows = skip ? [...auditRows, ...r.rows] : r.rows; auditTotal = r.total;
    auditRender();
  } catch (err) { toast(err.message, 'error'); }
}
function auditMore() { return auditSearch(true); }
function auditReset() {
  for (const id of ['auditType', 'auditActor', 'auditText', 'auditFrom', 'auditTo']) $(id).value = '';
  auditActive = false; auditRows = []; $('auditMoreBtn').style.display = 'none';
  renderActivityLog($('activityFilter').value);
}
async function auditExport() {
  try {
    const r = await apiFetch('/api/admin/audit?' + auditParams(0, 2000));
    if (!r.rows.length) return toast('لا توجد بيانات للتصدير', 'warning');
    downloadCsv(`audit-${new Date().toISOString().slice(0, 10)}.csv`,
      [['الوقت', 'النوع', 'الحدث', 'التفاصيل', 'المنفّذ'], ...r.rows.map(x => [new Date(x.ts).toISOString(), x.type, x.action, x.meta, x.actor])]);
    toast(`تم تصدير ${num(r.rows.length)} سجل${r.total > r.rows.length ? ` (من ${num(r.total)} — الحد ٢٠٠٠، ضيّق الفلاتر لتصدير الباقي)` : ''} ✓`, r.total > r.rows.length ? 'warning' : 'success');
  } catch (err) { toast(err.message, 'error'); }
}
let actorsLoaded = false;
async function loadAuditActors() {
  if (actorsLoaded) return;
  try {
    const list = await apiFetch('/api/admin/audit/actors');
    $('auditActor').innerHTML = '<option value="">كل المنفّذين</option>' + list.map(a => `<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('');
    actorsLoaded = true;
  } catch { /* the dropdown stays minimal */ }
}
// "تحديث" on the activity page re-runs the advanced search instead of dropping it
const _loadActivity = loadActivity;
loadActivity = function () { return auditActive ? auditSearch() : _loadActivity(); };

/* ── Announcements: persistent history + scheduling ────────────────────── */
const BC_STATUS = { scheduled: ['مجدول', 'chip-blue'], running: ['يُرسل الآن', 'chip-gold'], done: ['✓ أُرسل', 'chip-green'],
  cancelled: ['أُلغي', 'chip-muted'], missed: ['فات موعده', 'chip-red'], failed: ['فشل', 'chip-red'] };
// The in-memory list in app.js is replaced by the server's persistent history below.
renderBcastHistory = function () {};
async function loadBroadcastHistory() {
  if (!isOwner()) return;
  try {
    const r = await apiFetch('/api/admin/broadcasts');
    const st = r.stats;
    $('bsTotalSent').textContent = num(st.total);
    $('bsLastSent').textContent = st.lastAt ? timeAgo(st.lastAt) : '—';
    $('bsSuccessRate').textContent = st.successRate == null ? '—' : `${st.successRate}%`;
    $('bsTargets').textContent = `${allGuilds.length ? num(allGuilds.length) + ' سيرفر' : '—'}${st.pending ? ` · ${num(st.pending)} مجدول` : ''}`;
    $('bcastHistory').innerHTML = r.rows.length ? r.rows.slice(0, 15).map(b => {
      const [label, cls] = BC_STATUS[b.status] ?? [b.status, 'chip-muted'];
      const when = b.status === 'scheduled' ? `يُرسل ${fmtDate(b.runAt)}` : timeAgo(b.finishedAt ?? b.createdAt);
      const res = b.status === 'done' || b.result?.sent ? ` · نجح ${num(b.result?.sent)} · فشل ${num(b.result?.failed)} · تخطّي ${num(b.result?.skipped)}` : '';
      return `<div class="bh-row">
        <div style="display:flex;gap:0.5rem;align-items:center"><span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml((b.title || b.message).slice(0, 50))}</span>
          <span class="chip ${cls}">${label}</span>
          ${b.status === 'scheduled' ? `<button class="btn btn-danger btn-sm" data-act="own" data-fn="schedCancel" data-id="${escHtml(b.id)}">إلغاء</button>` : ''}</div>
        <div style="color:var(--muted);font-size:0.72rem;margin-top:0.2rem">${when}${b.target === 'ids' ? ` · ${num(b.targets)} سيرفر محدد` : ' · كل السيرفرات'}${res}${b.createdBy ? ` · ${escHtml(b.createdBy)}` : ''}</div></div>`;
    }).join('') : '<div class="empty">لا توجد إعلانات سابقة</div>';
  } catch (err) { $('bcastHistory').innerHTML = `<div class="empty">تعذّر تحميل السجل: ${escHtml(err.message)}</div>`; }
}
const _loadBcastInfo = loadBcastInfo;
loadBcastInfo = async function () { await _loadBcastInfo(); await loadBroadcastHistory(); };

function schedBroadcast() {
  const title = $('bcastTitle').value.trim(), message = $('bcastMsg').value.trim();
  const type = document.querySelector('.announce-targets .target-btn.selected')?.dataset.type || 'info';
  if (!message) return toast('اكتب نص الإعلان أولاً', 'error');
  if (!$('schedAt').value) return toast('اختر موعد الإرسال', 'error');
  const when = new Date($('schedAt').value);
  if (Number.isNaN(when.getTime())) return toast('موعد غير صالح', 'error');
  const selOnly = $('schedSelOnly').checked, ids = [...ownerSelected].slice(0, 100);
  if (selOnly && !ids.length) return toast('لم تحدد أي سيرفر في صفحة السيرفرات', 'error');
  confirmModal('', 'جدولة الإعلان', `سيُرسل ${fmtDate(when)} إلى ${selOnly ? `${num(ids.length)} سيرفر محدد` : `كل السيرفرات (${num(allGuilds.length)})`}.`, async () => {
    try {
      await post('/api/admin/broadcasts/schedule', { title, message, type, runAt: when.toISOString(), ...(selOnly ? { ids } : {}) });
      toast('تمت الجدولة ✓', 'success'); loadBroadcastHistory();
    } catch (err) { toast(err.message, 'error'); }
  }, 'جدولة');
}
function schedCancel(d) {
  confirmModal('', 'إلغاء الإعلان المجدول', 'لن يُرسل هذا الإعلان.', async () => {
    try { await apiFetch(`/api/admin/broadcasts/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); toast('أُلغي ✓', 'success'); loadBroadcastHistory(); }
    catch (err) { toast(err.message, 'error'); }
  }, 'إلغاء الإعلان');
}

/* ── Overview hook: alerts refresh with the overview ───────────────────── */
const _loadOverview = loadOverview;
loadOverview = function () { loadAlerts(); return _loadOverview(); };
Object.assign(CALLABLE, { loadOverview, loadActivity });
setInterval(() => { if (!document.hidden && isOwner()) loadAlerts(); }, 60_000);

/* ── Quick search: Ctrl+K / K — jump to a page or open a server ───────── */
let cmdkItems = [], cmdkSel = 0;
function cmdkBuild() {
  const q = $('cmdkInput').value.trim().toLowerCase();
  const pages = [...document.querySelectorAll('.nav-item[data-page]')].filter(n => isOwner() || !n.hasAttribute('data-owner'))
    .map(n => ({ kind: 'page', icon: '', label: n.querySelector('.label')?.textContent ?? n.dataset.page, hint: 'صفحة', page: n.dataset.page, el: n }));
  const guilds = allGuilds.filter(g => !q || (g.name ?? '').toLowerCase().includes(q) || g.id.includes(q) || tagsOf(g.id).some(t => t.toLowerCase().includes(q)))
    .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)).slice(0, q ? 8 : 5)
    .map(g => ({ kind: 'guild', icon: '', label: g.name, hint: `${num(g.memberCount)} عضو`, id: g.id }));
  cmdkItems = [...pages.filter(p => !q || p.label.toLowerCase().includes(q)), ...guilds];
  cmdkSel = Math.min(cmdkSel, Math.max(cmdkItems.length - 1, 0));
  $('cmdkList').innerHTML = cmdkItems.length
    ? cmdkItems.map((it, i) => `<div class="cmdk-item${i === cmdkSel ? ' sel' : ''}" role="option" data-i="${i}"><span>${escHtml(it.label)}</span><small>${escHtml(it.hint)}</small></div>`).join('')
    : '<div class="empty" style="padding:1.2rem">لا نتائج</div>';
  $('cmdkList').querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
async function cmdkOpen() {
  if (!currentUser?.isAdmin) return;
  $('cmdk').classList.add('open'); $('cmdkInput').value = ''; cmdkSel = 0; cmdkBuild(); $('cmdkInput').focus();
  if (!allGuilds.length) { try { allGuilds = await apiFetch('/api/admin/guilds'); cmdkBuild(); } catch { /* pages still work */ } }
}
const cmdkClose = () => $('cmdk').classList.remove('open');
function cmdkRun(i) {
  const it = cmdkItems[i]; if (!it) return;
  cmdkClose();
  if (it.kind === 'page') showPage(it.page, it.el);
  else { const g = allGuilds.find(x => x.id === it.id); if (g) openGuildModal(g); }
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('cmdk').classList.contains('open') ? cmdkClose() : cmdkOpen(); return; }
  if (!$('cmdk').classList.contains('open')) return;
  if (e.key === 'Escape') cmdkClose();
  else if (e.key === 'ArrowDown') { e.preventDefault(); cmdkSel = (cmdkSel + 1) % Math.max(cmdkItems.length, 1); cmdkBuild(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdkSel = (cmdkSel - 1 + cmdkItems.length) % Math.max(cmdkItems.length, 1); cmdkBuild(); }
  else if (e.key === 'Enter') { e.preventDefault(); cmdkRun(cmdkSel); }
});
$('cmdkInput').addEventListener('input', () => { cmdkSel = 0; cmdkBuild(); });
$('cmdkList').addEventListener('click', (e) => { const el = e.target.closest('[data-i]'); if (el) cmdkRun(Number(el.dataset.i)); });
$('cmdk').addEventListener('click', (e) => { if (e.target === e.currentTarget) cmdkClose(); });

const PHASE4_FN = { loadAlerts, loadHealth: () => loadHealth(true), healthDisable, advSaveNotes, auditSearch: () => auditSearch(), auditReset, auditExport, auditMore, schedBroadcast, schedCancel };

/* ══ Wiring ═════════════════════════════════════════════════════════════ */
Object.assign(CALLABLE, { loadLogs, loadLogsDebounced, remoteFilter, remoteGuildChanged, healthRender });
const OWNER_FN = { selGuild, selAllGuilds, bulkMessage, bulkLeave: () => bulkLeave(), bulkBlacklist, bulkClear, bulkLock, bulkUnlock, bulkStop, bulkLanguage, bulkSchedules, bulkTag, bulkExport,
  gfToggle, gfReverse, gfClear, gfMore, gfAll, gfSaveView, gfApplyView, gfDelView, quickLock, lockAsk, pickClose: () => pickClose(), drawerTab, drawerNext, drawerPrev, copyGuildId, drvCtl,
  disableSched, loadSystem, toggleLogAuto, downloadLogs, scanCleanup, selClean, selAllClean, cleanLeave, botStatus, advJoin, advPlay, advSaveConfig, advSend, advToggleCmd, advVoicePreset, advSaveRestrict, remJoin, remPlay, ...PHASE4_FN };

document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-act="own"]');
  if (el && Object.hasOwn(OWNER_FN, el.dataset.fn)) OWNER_FN[el.dataset.fn](el.dataset, el);
});

const _showPage = showPage;
showPage = function (id, el) {
  const r = _showPage(id, el);
  if (id === 'system') loadSystem();
  if (id === 'logs')   loadLogs();
  if (id === 'remote') remoteInit();
  if (id === 'health') loadHealth(false);
  if (id === 'activity') loadAuditActors();
  return r;
};

setInterval(() => { if (!document.hidden && currentUser?.isAdmin && $('page-system').classList.contains('active')) loadSystem(); }, 15_000);

/* ── Phase 6: small usability helpers ─────────────────────────────────── */
// Collapsed sidebar (phones) shows icons only → give every item a tooltip / accessible name, and mark the current page.
document.querySelectorAll('.nav-item').forEach((a) => {
  const label = a.querySelector('.label')?.textContent.trim();
  if (label && !a.title) a.title = label;
});
const syncAriaCurrent = () => document.querySelectorAll('.nav-item').forEach((a) => {
  if (a.classList.contains('active')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
});
syncAriaCurrent();
new MutationObserver(syncAriaCurrent).observe(document.querySelector('nav.sidebar-nav'), { subtree: true, attributes: true, attributeFilter: ['class'] });

// Keyboard shortcuts dialog ( ? )
const scOpen  = () => { $('shortcuts').classList.add('open'); $('shortcutsClose').focus(); };
const scClose = () => $('shortcuts').classList.remove('open');
$('shortcutsBtn').addEventListener('click', scOpen);
$('shortcutsBtn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scOpen(); } });
$('shortcutsClose').addEventListener('click', scClose);
$('shortcuts').addEventListener('click', (e) => { if (e.target === e.currentTarget) scClose(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('shortcuts').classList.contains('open')) { scClose(); return; }
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
  if (typing || document.querySelector('.modal-overlay.open')) return;
  e.preventDefault(); scOpen();
});
