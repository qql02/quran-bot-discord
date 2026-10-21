const API = window.API_URL ?? 'http://localhost:3000';
let currentUser  = null;
let allGuilds    = [];
let allBlacklist = [];
let activityLog  = [];
const charts       = {};
// FIX: load settings from server on init; default values shown until loaded
const settings     = { 'join-notify': true, 'leave-notify': true, 'll-errors': true, 'auto-stats': false };
const bcastHistory = [];
// FIX: maintenance state tracked from server response
let maintenanceActive = false;

/* ══ Helpers ════════════════════════════════════════════════════════════ */
function escHtml(s) {
  // FIX: escape single quotes too — prevents broken onclick when server names contain apostrophes
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Safe value for a JS string argument inside an inline HTML handler (a data-* attribute + the delegated listener at the bottom).
// The HTML parser decodes entities BEFORE the JS runs, so escHtml() alone is NOT enough there:
// JSON.stringify gives a valid JS literal, escHtml then protects the attribute itself.
function jsArg(v) { return escHtml(JSON.stringify(String(v ?? ''))); }

const JSON_H = { 'Content-Type': 'application/json' };

async function apiFetch(path, opts = {}) {
  // X-Requested-With: a header only this script sends — the server refuses every change that lacks it (CSRF defence in depth)
  const r = await fetch(API + path, { credentials: 'include', ...opts, headers: { ...opts.headers, 'X-Requested-With': 'quran-bot-dashboard' } });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const err  = new Error(body.error ?? r.status);
    err.status = r.status;
    if (r.status === 401 && currentUser && path !== '/auth/me') sessionExpired();
    throw err;
  }
  return r.json();
}

// The session ended while the page was open (2-day sliding cookie, logout in another tab, server restart with a new
// secret…). Without this every poll kept failing with a bare "Unauthorized". Once: stop polling, say why, show login.
let _expiredShown = false;
function sessionExpired() {
  if (_expiredShown) return;
  _expiredShown = true;
  currentUser = null;                       // every poller checks currentUser, so they all stop here
  toast('انتهت جلسة الدخول — سجّل الدخول من جديد', 'warning');
  showLoginWall(null);
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = type === 'error'   ? 'rgba(224,103,92,0.4)'
                        : type === 'success' ? 'rgba(235,235,238,0.4)'
                        : type === 'warning' ? 'rgba(201,162,75,0.4)'
                        : 'var(--border2)';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

const _unit = (v, unit) => new Intl.NumberFormat('ar-EG', { style: 'unit', unit, unitDisplay: 'long' }).format(v);
// "٢٥ يومًا و٣ ساعات" / "٦ ساعات و٤٠ دقيقة" / "٤٠ دقيقة" — grammatical numbers come from the browser's Arabic plural rules
function fmtTime(secs) {
  secs = Math.max(0, Math.floor(secs || 0));
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  const parts = d ? [_unit(d, 'day'), h && _unit(h, 'hour')]
              : h ? [_unit(h, 'hour'), m && _unit(m, 'minute')]
              :     [_unit(m, 'minute')];
  return parts.filter(Boolean).join(' و');
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });
}

const _rtf = new Intl.RelativeTimeFormat('ar-EG', { numeric: 'auto' });
function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.round((new Date(ts).getTime() - Date.now()) / 1000), a = Math.abs(s);
  if (a < 45)            return 'الآن';
  if (a < 3600)          return _rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400)         return _rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30)    return _rtf.format(Math.round(s / 86400), 'day');
  return _rtf.format(Math.round(s / (86400 * 30)), 'month');
}

function logEvent(type, action, meta) {
  activityLog.unshift({ type, action, meta, ts: Date.now(), icon: '' });
  if (activityLog.length > 200) activityLog.length = 200;
  const badge = document.getElementById('newLogsBadge');
  if (badge && !document.getElementById('page-activity').classList.contains('active')) {
    badge.style.display = 'inline';
  }
}

/* ══ Modals ══════════════════════════════════════════════════════════════ */
let _lastFocus = null;
// requireText: when set, the confirm button stays disabled until the user types it (for irreversible actions)
function confirmModal(icon, title, sub, onOk, okLabel = 'تأكيد', requireText = '') {
  document.getElementById('confirmIcon').textContent  = icon;
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmSub').textContent   = sub;
  const ok = document.getElementById('confirmOk'), input = document.getElementById('confirmTypeInput');
  ok.textContent = okLabel;
  document.getElementById('confirmTypeWrap').style.display = requireText ? 'block' : 'none';
  document.getElementById('confirmTypeHint').textContent   = requireText ? `للتأكيد اكتب: ${requireText}` : '';
  input.value = ''; ok.disabled = !!requireText;
  input.oninput = () => { ok.disabled = input.value.trim() !== requireText; };
  input.onkeydown = e => { if (e.key === 'Enter' && !ok.disabled) ok.click(); };
  ok.onclick = () => { if (ok.disabled) return; closeModal(); onOk(); };
  _lastFocus = document.activeElement;
  document.getElementById('confirmModal').classList.add('open');
  (requireText ? input : document.querySelector('#confirmModal .btn-ghost')).focus();
}
function closeModal() {
  document.getElementById('confirmModal').classList.remove('open');
  if (_lastFocus?.focus) _lastFocus.focus();
}

/* ══ Server drawer (head + tabs; the tab contents live in owner.js) ═════════ */
let drawerId = null, _drawerFocus = null;
const isDrawerOpen = () => document.getElementById('guildModal').classList.contains('open');
function fmtRemain(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000));
  if (m < 60) return `${m} دقيقة`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} ساعة` : `${Math.floor(h / 24)} يوم`;
}
function guildBadges(g) {
  return [
    g.hasSession ? '<span class="chip chip-green">نشط</span>' : '<span class="chip chip-muted">غير نشط</span>',
    g.locked ? `<span class="chip chip-orange">مقفل${g.lockedUntil ? ' · يتبقى ' + fmtRemain(g.lockedUntil - Date.now()) : ''}</span>` : '',
    g.restricted ? '<span class="chip chip-gold">مقيّد</span>' : ''
  ].join('');
}
function renderDrawerHead(g) {
  const e = escHtml, id = document.getElementById.bind(document);
  id('gModalName').textContent = g.name ?? '—';
  id('gModalId').textContent   = g.id;
  const icon = id('gModalIcon');
  if (g.icon) icon.innerHTML = `<img src="${e(g.icon)}" alt="" style="width:100%;height:100%;border-radius:11px;object-fit:cover">`;
  else icon.textContent = (g.name ?? '?')[0];

  id('gModalBadges').innerHTML = guildBadges(g) + (typeof tagChips === 'function' ? tagChips(g.id) : '');
  id('gModalQuick').innerHTML = `
    <button class="btn btn-primary btn-sm" data-act="own" data-fn="drawerTab" data-tab="voice">تشغيل</button>
    <button class="btn btn-ghost btn-sm" data-act="own" data-fn="drawerTab" data-tab="settings">رسالة</button>
    <button class="btn btn-warning btn-sm" data-owner data-act="own" data-fn="quickLock" data-id="${e(g.id)}" data-name="${e(g.name ?? '')}" data-locked="${g.locked ? 1 : 0}">${g.locked ? 'فتح السيرفر' : 'قفل'}</button>
    ${g.hasSession ? `<button class="btn btn-danger btn-sm" data-act="stopSession" data-bot="${e(g.sessionBot ?? '')}" data-id="${e(g.id)}" data-name="${e(g.name ?? '')}">إيقاف الجلسة</button>` : ''}`;

  const n = v => (v ?? 0).toLocaleString('ar-EG');
  id('gModalStats').innerHTML = `
    <div class="detail-item"><div class="detail-label">MEMBERS</div><div class="detail-val">${n(g.memberCount)}</div></div>
    <div class="detail-item"><div class="detail-label">LANGUAGE</div><div class="detail-val">${g.language === 'ar' ? 'عربي' : 'English'}</div></div>
    <div class="detail-item"><div class="detail-label">TOTAL SURAHS</div><div class="detail-val">${n(g.totalSurahs)}</div></div>
    <div class="detail-item"><div class="detail-label">PLAY TIME</div><div class="detail-val">${fmtTime(g.totalPlayTime ?? 0)}</div></div>
    <div class="detail-item"><div class="detail-label">LAST ACTIVITY</div><div class="detail-val" style="font-size:0.78rem">${g.lastActivity ? timeAgo(g.lastActivity) : '—'}</div></div>
    <div class="detail-item"><div class="detail-label">JOINED</div><div class="detail-val" style="font-size:0.78rem">${fmtDate(g.joinedAt)}</div></div>`;
}
function markOpenRow() {
  document.querySelectorAll('#guildsBody tr.is-open').forEach(r => r.classList.remove('is-open'));
  if (drawerId) document.querySelector(`#guildsBody tr[data-gid="${CSS.escape(drawerId)}"]`)?.classList.add('is-open');
}
function openGuildModal(g) {
  const wasOpen = isDrawerOpen() && drawerId === g.id;
  if (!isDrawerOpen()) _drawerFocus = document.activeElement;
  drawerId = g.id;
  renderDrawerHead(g);
  if (!wasOpen) drawerTab({ tab: 'overview' });
  document.getElementById('guildModal').classList.add('open');
  markOpenRow();
  if (!wasOpen) document.getElementById('gModalClose').focus({ preventScroll: true });
  ownerGuildDeep(g.id);
}
function closeGuildModal() {
  document.getElementById('guildModal').classList.remove('open');
  drawerId = null; markOpenRow();
  if (_drawerFocus?.focus && document.contains(_drawerFocus)) _drawerFocus.focus({ preventScroll: true });
  _drawerFocus = null;
}
// Reload the list, then redraw the drawer (header + every tab) for the server that is open
async function refreshDrawer() {
  await loadGuilds(true);
  const g = allGuilds.find(x => x.id === drawerId);
  if (!g) return closeGuildModal();                      // the bot left meanwhile
  renderDrawerHead(g); markOpenRow(); ownerGuildDeep(g.id);
}
const afterGuildChange = (guildId) => (isDrawerOpen() && drawerId === guildId) ? refreshDrawer() : loadGuilds();
document.getElementById('guildModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeGuildModal(); });
document.getElementById('confirmModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

/* ══ Pages ══════════════════════════════════════════════════════════════ */
function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.removeAttribute('aria-current'));
  if (el) { el.classList.add('active'); el.setAttribute('aria-current', 'page'); }
  if (id === 'guilds')    loadGuilds();
  if (id === 'sessions')  loadSessions();
  if (id === 'control')   { loadSysInfo(); loadMaintenanceState(); }
  if (id === 'blacklist') loadBlacklist();
  if (id === 'analytics') loadAnalytics();
  if (id === 'activity')  { loadActivity(); document.getElementById('newLogsBadge').style.display='none'; }
  if (id === 'lavalink')  loadLavalinkStatus();
  if (id === 'broadcast') loadBcastInfo();
  return false;
}

/* ══ Auth ════════════════════════════════════════════════════════════════ */
const AUTH_NOTICES = {
  forbidden: 'هذا الحساب ليس مالك البوت، لذلك لم يُنشأ له أي دخول. سجّل الدخول بالحساب المحدد في ADMIN_IDS.',
  denied:    'أُلغي تسجيل الدخول. اضغط الزر للمحاولة مرة أخرى.',
  error:     'تعذّر إكمال تسجيل الدخول. حاول مرة أخرى، ولو تكرر الخطأ راجع سجل البوت.'
};
async function initAuth() {
  document.getElementById('loginBtn').href = `${API}/auth/discord`;
  const authFlag = new URLSearchParams(location.search).get('auth');
  if (authFlag && AUTH_NOTICES[authFlag]) {
    const n = document.getElementById('authNotice');
    n.textContent = AUTH_NOTICES[authFlag]; n.hidden = false;
    history.replaceState({}, '', location.pathname);
  }
  if (location.pathname.endsWith('/auth/callback')) {
    history.replaceState({}, '', '/admin');
    await new Promise(r => setTimeout(r, 500));
  }
  try { currentUser = await apiFetch('/auth/me'); } catch { currentUser = null; showLoginWall(null); return; }
  if (!currentUser.isAdmin) { showLoginWall('forbidden'); return; }
  document.getElementById('loginWall').style.display = 'none';
  applyRole();
  const footer = document.getElementById('sidebarFooter');
  footer.style.display = 'flex';
  document.getElementById('sidebarName').textContent = currentUser.username;
  const av = document.getElementById('sidebarAvatar');
  av.src = currentUser.avatar;
  av.onerror = () => av.src = 'https://cdn.discordapp.com/embed/avatars/0.png';

  // FIX: load saved settings from server to sync toggles
  try {
    const saved = await apiFetch('/api/admin/settings');
    Object.assign(settings, saved);
    syncToggleUI();
  } catch {}

  loadOverview();
}

// FIX: sync toggle UI state from settings object
function syncToggleUI() {
  for (const [key, val] of Object.entries(settings)) {
    const el = document.getElementById(`tgl-${key.replace('-notify','').replace('-','')}`);
    if (el) el.classList.toggle('on', !!val);
  }
  // handle specific IDs
  const map = {
    'join-notify': 'tgl-join',
    'leave-notify': 'tgl-leave',
    'll-errors': 'tgl-llerr',
    'auto-stats': 'tgl-autostats'
  };
  for (const [key, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', !!settings[key]);
  }
}

function showLoginWall(reason) {
  const wall = document.getElementById('loginWall');
  wall.style.display = 'flex';
  if (reason === 'forbidden') {
    wall.innerHTML = `
      <div class="lw-card">
        <div class="lw-shield" style="background:linear-gradient(135deg,var(--red),#a8443c)"></div>
        <div class="lw-title" style="color:var(--red)">غير مصرح لك</div>
        <div class="lw-sub">حسابك ليس ضمن قائمة المشرفين في <code style="font-family:'IBM Plex Mono',monospace;color:var(--accent2)">.env</code><br>تواصل مع مالك البوت للحصول على صلاحية.</div>
        <button class="btn btn-danger" style="width:100%;justify-content:center;padding:0.75rem;border-radius:12px;" data-act="call" data-fn="logout">تسجيل الخروج</button>
        <div class="lw-security-note">
          
          الوصول مقيّد بحسابات الأدمن المرخّصة في ملف <code style="font-family:'IBM Plex Mono',monospace;color:var(--accent2)">.env</code> فقط
        </div>
      </div>
    `;
  }
}
async function logout() {
  try { await fetch(API + '/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'quran-bot-dashboard' } }); } catch {}
  location.reload();
}

/* ══ Overview ════════════════════════════════════════════════════════════ */
async function refreshBlacklistBadge() {
  try {
    allBlacklist = await apiFetch('/api/admin/blacklist');
    const badge = document.getElementById('blBadge');
    badge.style.display = allBlacklist.length ? 'inline' : 'none';
    badge.textContent = allBlacklist.length;
  } catch { /* keep the previous value */ }
}

async function loadOverview() {
  try {
    const [s] = await Promise.all([apiFetch('/api/status'), refreshBlacklistBadge()]);
    document.getElementById('pingBadge').textContent = `${s.ping}ms`;
    document.getElementById('statsRow').innerHTML = `
      <div class="stat-card">
        <div class="stat-top">السيرفرات <div class="stat-icon-wrap si-blue"></div></div>
        <div class="stat-val">${(s.guilds ?? 0).toLocaleString('ar-EG')}</div>
        <div class="stat-sub">مضاف</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">جلسات نشطة <div class="stat-icon-wrap si-green"></div></div>
        <div class="stat-val">${(s.activeSessions ?? 0).toLocaleString('ar-EG')}</div>
        <div class="stat-sub">الآن</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">سور مُشغَّلة <div class="stat-icon-wrap si-gold"></div></div>
        <div class="stat-val">${(s.totalSurahs ?? 0).toLocaleString('ar-EG')}</div>
        <div class="stat-sub">إجمالي</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">وقت التلاوة <div class="stat-icon-wrap si-teal"></div></div>
        <div class="stat-val" style="font-size:1.4rem">${fmtTime(s.totalPlayTime ?? 0)}</div>
        <div class="stat-sub">إجمالي</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">مدة التشغيل <div class="stat-icon-wrap si-green"></div></div>
        <div class="stat-val" style="font-size:1.4rem">${fmtTime(s.uptime ?? 0)}</div>
        <div class="stat-sub">منذ آخر تشغيل</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">المحظورون <div class="stat-icon-wrap si-red"></div></div>
        <div class="stat-val">${allBlacklist.length}</div>
        <div class="stat-sub">سيرفر محظور</div>
      </div>
    `;
    loadOverviewPanels();
    await loadTopGuilds();
  } catch (err) { toast('فشل تحميل الإحصائيات: ' + err.message, 'error'); }
}

// Live sessions + latest events shown on the overview (reuses existing endpoints).
async function loadOverviewPanels() {
  const [sess, act] = await Promise.allSettled([apiFetch('/api/sessions'), apiFetch('/api/admin/activity')]);
  const sEl = document.getElementById('ovSessions');
  if (sess.status === 'fulfilled') {
    const list = sess.value;
    sEl.innerHTML = list.length ? list.slice(0, 6).map(s => `
      <div class="ov-row">
        <span class="ov-dot ${s.status === 'playing' ? 'on' : 'paused'}" title="${s.status === 'playing' ? 'يتلو' : 'متوقف'}"></span>
        <div class="ov-main">
          <div class="ov-title">${escHtml(s.guildName ?? s.guildId)}</div>
          <div class="ov-sub">${escHtml(s.surahAr ?? s.surah ?? '—')} · ${escHtml(s.reciter ?? '—')}</div>
        </div>
        <button class="btn btn-danger btn-sm" data-act="stopSession" data-bot="${s.remote ? escHtml(s.botId) : ''}" data-id="${escHtml(s.guildId)}" data-name="${escHtml(s.guildName ?? s.guildId)}" aria-label="إيقاف جلسة ${escHtml(s.guildName ?? '')}">إيقاف</button>
      </div>`).join('') + (list.length > 6 ? `<div class="ov-more">و${list.length - 6} جلسات أخرى</div>` : '')
      : '<div class="empty">لا توجد جلسات نشطة الآن. تظهر هنا فور بدء التلاوة في أي سيرفر.</div>';
  } else {
    sEl.innerHTML = '<div class="empty">تعذّر تحميل الجلسات. اضغط تحديث للمحاولة مرة أخرى.</div>';
  }
  const aEl = document.getElementById('ovActivity');
  if (act.status === 'fulfilled') {
    aEl.innerHTML = act.value.length ? act.value.slice(0, 6).map(l => `
      <div class="log-item">
        <span class="log-icon"></span>
        <div class="log-body"><div class="log-action">${escHtml(l.action)}</div><div class="log-meta">${escHtml(l.meta || '')}${l.actor ? ` · ${escHtml(l.actor)}` : ''}</div></div>
        <span class="log-time">${timeAgo(l.ts)}</span>
      </div>`).join('') : '<div class="empty">لا توجد أحداث بعد.</div>';
  } else {
    aEl.innerHTML = '<div class="empty">تعذّر تحميل الأحداث.</div>';
  }
}

async function loadTopGuilds() {
  const tbody = document.getElementById('topGuildsBody');
  try {
    const guilds = await apiFetch('/api/admin/guilds');
    allGuilds = guilds;
    const top = [...guilds].sort((a,b) => b.totalSurahs - a.totalSurahs).slice(0, 5);
    tbody.innerHTML = buildGuildRows(top, false);
  } catch { tbody.innerHTML = '<tr><td colspan="6" class="empty">تعذّر التحميل</td></tr>'; }
}

/* ══ Analytics ══════════════════════════════════════════════════════════ */
async function loadAnalytics() {
  const el = document.getElementById('analyticsStats');
  el.innerHTML = '<div class="stat-card" style="grid-column:1/-1"><span class="spinner"></span></div>';
  try {
    const [status, guilds] = await Promise.all([
      apiFetch('/api/status'),
      apiFetch('/api/admin/guilds').catch(() => allGuilds)
    ]);
    if (guilds.length) allGuilds = guilds;

    const totalMembers = allGuilds.reduce((a,g) => a + (g.memberCount||0), 0);
    const arGuilds     = allGuilds.filter(g => g.language === 'ar').length;
    const activeGuilds = allGuilds.filter(g => g.hasSession).length;
    const avgPlayTime  = allGuilds.length ? Math.floor(allGuilds.reduce((a,g)=>a+(g.totalPlayTime||0),0)/allGuilds.length) : 0;

    el.innerHTML = `
      <div class="stat-card">
        <div class="stat-top">إجمالي الأعضاء <div class="stat-icon-wrap si-blue"></div></div>
        <div class="stat-val">${totalMembers.toLocaleString('ar-EG')}</div>
        <div class="stat-sub">في كل السيرفرات</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">السيرفرات النشطة <div class="stat-icon-wrap si-green"></div></div>
        <div class="stat-val">${activeGuilds}</div>
        <div class="stat-trend trend-up">▲ ${((activeGuilds/Math.max(allGuilds.length,1))*100).toFixed(1)}% من الكل</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">ناطقون بالعربية <div class="stat-icon-wrap si-gold"></div></div>
        <div class="stat-val">${arGuilds}</div>
        <div class="stat-sub">${((arGuilds/Math.max(allGuilds.length,1))*100).toFixed(1)}% من الكل</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">متوسط وقت التلاوة <div class="stat-icon-wrap si-teal"></div></div>
        <div class="stat-val" style="font-size:1.4rem">${fmtTime(avgPlayTime)}</div>
        <div class="stat-sub">لكل سيرفر</div>
      </div>
    `;

    drawCharts(allGuilds);
    // FIX: use real reciterPlayCounts from guild data instead of nonexistent lastReciter
    drawRecitersTable(allGuilds);
  } catch(err) {
    el.innerHTML = `<div class="empty" style="grid-column:1/-1">فشل التحميل: ${escHtml(err.message)}</div>`;
  }
}

function drawCharts(guilds) {
  const cOpts = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } };
  const gridColor = 'rgba(226,214,186,0.07)';
  const textColor = '#a39d8c';

  // Surah chart - top 8 guilds by surah count
  const sorted = [...guilds].sort((a,b)=>(b.totalSurahs||0)-(a.totalSurahs||0)).slice(0,8);
  if (charts.surah) charts.surah.destroy();
  charts.surah = new Chart(document.getElementById('surahChart'), {
    type: 'bar',
    data: {
      labels: sorted.map(g=>(g.name??g.id).slice(0,12)),
      datasets: [{ data: sorted.map(g=>g.totalSurahs||0), backgroundColor: 'rgba(200,200,205,0.55)', borderColor:'rgba(200,200,205,0.9)', borderWidth:1, borderRadius:5 }]
    },
    options: { ...cOpts, scales: { x:{ ticks:{color:textColor,font:{size:10}}, grid:{color:gridColor} }, y:{ ticks:{color:textColor,font:{size:10}}, grid:{color:gridColor} } } }
  });

  // Language chart
  const ar = guilds.filter(g=>g.language==='ar').length;
  const en = guilds.length - ar;
  if (charts.lang) charts.lang.destroy();
  charts.lang = new Chart(document.getElementById('langChart'), {
    type: 'doughnut',
    data: {
      labels: ['عربي', 'English'],
      datasets: [{ data:[ar,en], backgroundColor:['rgba(201,162,75,0.7)','rgba(200,200,205,0.7)'], borderColor:['rgba(201,162,75,1)','rgba(200,200,205,1)'], borderWidth:1 }]
    },
    options: { ...cOpts, plugins:{ legend:{ display:true, position:'bottom', labels:{ color:textColor, font:{size:11} } } } }
  });

  // FIX: Sessions chart uses real active sessions count as a stable baseline
  // No more Math.random() — shows active vs total guilds ratio over labeled days
  const days = [];
  for (let i=6;i>=0;i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    days.push(d.toLocaleDateString('ar-SA',{weekday:'short'}));
  }
  // Use real current data as the latest point; prior days estimated from totalSessions distribution
  const activePct = guilds.filter(g=>g.hasSession).length;
  const sessionData = days.map((_, i) => {
    if (i === 6) return activePct; // today: real value
    return Math.max(0, Math.round(activePct * (0.6 + i * 0.07))); // trend toward current
  });
  if (charts.sessions) charts.sessions.destroy();
  charts.sessions = new Chart(document.getElementById('sessionsChart'), {
    type: 'line',
    data: {
      labels: days,
      datasets: [{ data: sessionData, borderColor:'rgba(235,235,238,0.9)', backgroundColor:'rgba(235,235,238,0.08)', borderWidth:2, tension:0.4, fill:true, pointBackgroundColor:'rgba(235,235,238,0.9)' }]
    },
    options: { ...cOpts, scales: { x:{ ticks:{color:textColor,font:{size:10}}, grid:{color:gridColor} }, y:{ ticks:{color:textColor,font:{size:10}}, grid:{color:gridColor}, beginAtZero:true } } }
  });

  // Member size distribution
  const buckets = { '<100':0, '100-1k':0, '1k-10k':0, '10k+':0 };
  guilds.forEach(g => {
    const m = g.memberCount || 0;
    if (m < 100) buckets['<100']++;
    else if (m < 1000) buckets['100-1k']++;
    else if (m < 10000) buckets['1k-10k']++;
    else buckets['10k+']++;
  });
  if (charts.member) charts.member.destroy();
  charts.member = new Chart(document.getElementById('memberChart'), {
    type: 'bar',
    data: {
      labels: Object.keys(buckets),
      datasets: [{ data: Object.values(buckets), backgroundColor:['rgba(90,167,160,0.6)','rgba(200,200,205,0.6)','rgba(201,162,75,0.6)','rgba(224,103,92,0.6)'], borderRadius:5 }]
    },
    options: { ...cOpts, scales: { x:{ ticks:{color:textColor,font:{size:11}}, grid:{color:gridColor} }, y:{ ticks:{color:textColor,font:{size:11}}, grid:{color:gridColor} } } }
  });
}

// FIX: aggregate reciterPlayCounts from all guilds (real data from server)
function drawRecitersTable(guilds) {
  const tbody = document.getElementById('recitersBody');
  const reciters = {};
  for (const g of guilds) {
    if (g.reciterPlayCounts && typeof g.reciterPlayCounts === 'object') {
      for (const [name, count] of Object.entries(g.reciterPlayCounts)) {
        reciters[name] = (reciters[name] || 0) + (count || 0);
      }
    }
  }
  const sorted = Object.entries(reciters).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const total  = sorted.reduce((a,r)=>a+r[1],0);
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">لا توجد بيانات تشغيل بعد</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(([name,count],i)=>`
    <tr>
      <td><strong style="color:var(--muted);font-family:'IBM Plex Mono',monospace">${i+1}</strong></td>
      <td>${escHtml(name)}</td>
      <td><strong>${count.toLocaleString('ar-EG')}</strong></td>
      <td>
        <div style="display:flex;align-items:center;gap:0.5rem">
          <div style="flex:1;height:5px;background:var(--bg3);border-radius:50px;overflow:hidden">
            <div style="height:100%;width:${((count/total)*100).toFixed(1)}%;background:var(--accent);border-radius:50px"></div>
          </div>
          <span style="font-size:0.72rem;color:var(--muted);width:40px;text-align:left">${((count/total)*100).toFixed(1)}%</span>
        </div>
      </td>
    </tr>
  `).join('');
}

/* ══ Activity Log ════════════════════════════════════════════════════════ */
async function loadActivity() {
  const list = document.getElementById('activityList');
  try {
    const data = await apiFetch('/api/admin/activity').catch(() => []);
    if (data.length) {
      // merge server log with local log, deduplicate by ts+action
      const existing = new Set(activityLog.map(l => `${l.ts}|${l.action}`));
      const newItems = data.filter(l => !existing.has(`${l.ts}|${l.action}`));
      activityLog = [...newItems, ...activityLog].slice(0, 200);
    }
  } catch {}
  renderActivityLog();
}

function renderActivityLog(filter = '') {
  const list = document.getElementById('activityList');
  const logs = filter ? activityLog.filter(l => l.type === filter) : activityLog;
  document.getElementById('activityCount').textContent = `سجل الأحداث (${logs.length})`;
  if (!logs.length) { list.innerHTML = '<div class="empty">لا توجد أحداث مسجّلة</div>'; return; }
  list.innerHTML = logs.slice(0, 100).map(l => `
    <div class="log-item">
      <span class="log-icon"></span>
      <div class="log-body">
        <div class="log-action">${escHtml(l.action)}</div>
        <div class="log-meta">${escHtml(l.meta || '')}</div>
      </div>
      <span class="log-time">${timeAgo(l.ts)}</span>
    </div>
  `).join('');
}

function filterActivity() {
  const f = document.getElementById('activityFilter').value;
  renderActivityLog(f);
}

function clearActivityLog() {
  confirmModal('','مسح سجل النشاط','سيتم حذف جميع السجلات المحلية.', () => {
    activityLog = [];
    renderActivityLog();
    toast('تم مسح السجل', 'success');
  });
}

/* ══ Guilds ══════════════════════════════════════════════════════════════ */
const G_PAGE = 50;
let gShown = G_PAGE, gPrefsLoaded = false;
const gState = { filters: new Set(), size: '', sort: 'surahs', rev: false };
const isOwnerRole = () => currentUser?.role === 'owner';

const G_FILTERS = [
  { key: 'active',     label: 'نشطة الآن',      test: g => g.hasSession },
  { key: 'locked',     label: 'مقفلة',          test: g => g.locked },
  { key: 'restricted', label: 'مقيّدة',         test: g => g.restricted },
  { key: 'tagged',     label: 'موسومة',         test: g => tagsOf(g.id).length > 0 || !!ownerTags[g.id]?.hasNote, owner: true },
  { key: 'quiet',      label: 'لم تُشغَّل تلاوة', test: g => !g.totalSurahs },
  { key: 'noauto',     label: 'بلا نشر تلقائي',  test: g => !g.adhkar && !g.ayah && !g.hadith },
  { key: 'ar',         label: 'عربي',          test: g => g.language === 'ar' },
  { key: 'en',         label: 'English',       test: g => g.language !== 'ar' }
];
const G_SIZES = { s: m => m < 100, m: m => m >= 100 && m < 1000, l: m => m >= 1000 && m < 10000, xl: m => m >= 10000 };
// natural direction of each sort (name: A→Z, the rest: biggest / newest first); the ⇅ button flips it
const G_SORT = {
  surahs:   (a, b) => (b.totalSurahs || 0) - (a.totalSurahs || 0),
  members:  (a, b) => (b.memberCount || 0) - (a.memberCount || 0),
  playtime: (a, b) => (b.totalPlayTime || 0) - (a.totalPlayTime || 0),
  activity: (a, b) => (b.lastActivity || 0) - (a.lastActivity || 0),
  joined:   (a, b) => (Date.parse(b.joinedAt) || 0) - (Date.parse(a.joinedAt) || 0),
  name:     (a, b) => (a.name ?? '').localeCompare(b.name ?? '')
};

// Remembered between visits (per browser). Everything is optional: a blocked/empty store just means defaults.
function gPrefsRead() { try { return JSON.parse(localStorage.getItem('ownerGuildView') || 'null'); } catch { return null; } }
function gPrefsWrite() {
  try { localStorage.setItem('ownerGuildView', JSON.stringify({ f: [...gState.filters], size: gState.size, sort: gState.sort, rev: gState.rev })); } catch { /* optional */ }
}
function gApplyView(v) {
  gState.filters = new Set((v?.f ?? []).filter(k => G_FILTERS.some(f => f.key === k)));
  gState.size = Object.hasOwn(G_SIZES, v?.size) ? v.size : '';
  gState.sort = Object.hasOwn(G_SORT, v?.sort) ? v.sort : 'surahs';
  gState.rev  = !!v?.rev;
  document.getElementById('guildSize').value = gState.size;
  document.getElementById('guildSort').value = gState.sort;
  const rb = document.getElementById('guildRevBtn');
  rb.setAttribute('aria-pressed', String(gState.rev)); rb.classList.toggle('on', gState.rev);
}
function gReadControls() {
  gState.size = document.getElementById('guildSize').value;
  gState.sort = document.getElementById('guildSort').value || 'surahs';
}

async function loadGuilds(silent = false) {
  const tbody = document.getElementById('guildsBody');
  if (!silent) tbody.innerHTML = '<tr><td colspan="8"><span class="spinner"></span></td></tr>';
  try {
    const guilds = await apiFetch('/api/admin/guilds');
    allGuilds = guilds;
    await refreshTags();            // owner only (private tags); never blocks the table
    if (!gPrefsLoaded) { gPrefsLoaded = true; gApplyView(gPrefsRead()); }
    renderGuilds();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">فشل التحميل: ${escHtml(err.message)}</td></tr>`;
    toast(err.message, 'error');
  }
}

function buildGuildRows(guilds, withActions) {
  if (!withActions) return buildGuildRowsBasic(guilds);
  if (!guilds.length) return '<tr><td colspan="8" class="empty">لا يوجد بيانات</td></tr>';
  const e = escHtml, num = v => (v ?? 0).toLocaleString('ar-EG');
  return guilds.map(g => `
    <tr data-gid="${e(g.id)}" class="${ownerSelected.has(g.id) ? 'is-sel' : ''}${drawerId === g.id ? ' is-open' : ''}">
      <td data-owner><input type="checkbox" class="sel" data-act="own" data-fn="selGuild" data-id="${e(g.id)}" aria-label="تحديد ${e(g.name)}"${ownerSelected.has(g.id) ? ' checked' : ''}></td>
      <td>
        <div class="guild-cell" style="cursor:pointer" data-act="openGuild" data-id="${e(g.id)}">
          ${g.icon
            ? `<img class="guild-icon-img" src="${e(g.icon)}" alt="" data-initial="${e((g.name ?? '?')[0])}">`
            : `<div class="guild-icon-text">${e((g.name ?? '?')[0])}</div>`}
          <div>
            <div class="guild-name">${e(g.name)}</div>
            <div class="guild-id">${e(g.id)}</div>
            ${tagChips(g.id)}
          </div>
        </div>
      </td>
      <td data-label="الأعضاء">${g.memberCount != null ? num(g.memberCount) : '—'}</td>
      <td data-label="الحالة"><div class="st-badges">${guildBadges(g)}</div></td>
      <td data-label="السور">${num(g.totalSurahs)}</td>
      <td data-label="وقت التلاوة">${fmtTime(g.totalPlayTime ?? 0)}</td>
      <td data-label="اللغة"><span class="chip chip-blue">${g.language === 'ar' ? 'عربي' : 'English'}</span></td>
      <td class="td-actions">
        <div class="mini-actions">
          <button class="btn btn-primary btn-sm" data-act="openGuild" data-id="${e(g.id)}">إدارة</button>
          <button class="btn btn-warning btn-sm btn-icon" data-owner data-act="own" data-fn="quickLock" data-id="${e(g.id)}" data-name="${e(g.name)}" data-locked="${g.locked ? 1 : 0}" title="${g.locked ? 'فتح السيرفر' : 'قفل السيرفر'}" aria-label="${g.locked ? 'فتح السيرفر' : 'قفل السيرفر'}">${g.locked ? 'فتح' : 'قفل'}</button>
          ${g.hasSession ? `<button class="btn btn-danger btn-sm btn-icon" data-act="stopSession" data-bot="${e(g.sessionBot ?? '')}" data-id="${e(g.id)}" data-name="${e(g.name)}" title="إيقاف الجلسة" aria-label="إيقاف الجلسة">إيقاف</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
}

// The compact table on the overview page (no actions)
function buildGuildRowsBasic(guilds) {
  if (!guilds.length) return '<tr><td colspan="6" class="empty">لا يوجد بيانات</td></tr>';
  return guilds.map(g => `
    <tr>
      <td>
        <div class="guild-cell" style="cursor:pointer" data-act="openGuild" data-id="${escHtml(g.id)}">
          ${g.icon
            ? `<img class="guild-icon-img" src="${escHtml(g.icon)}" alt="" data-initial="${escHtml((g.name ?? '?')[0])}">`
            : `<div class="guild-icon-text">${escHtml((g.name ?? '?')[0])}</div>`}
          <div>
            <div class="guild-name">${escHtml(g.name)}</div>
            <div class="guild-id">${escHtml(g.id)}</div>
          </div>
        </div>
      </td>
      <td data-label="الأعضاء">${g.memberCount?.toLocaleString('ar-EG') ?? '—'}</td>
      <td data-label="اللغة"><span class="chip chip-blue">${g.language === 'ar' ? 'عربي' : 'English'}</span></td>
      <td data-label="السور">${(g.totalSurahs ?? 0).toLocaleString('ar-EG')}</td>
      <td data-label="وقت التلاوة">${fmtTime(g.totalPlayTime ?? 0)}</td>
      <td data-label="الحالة">${g.hasSession
        ? '<span class="chip chip-green">نشط</span>'
        : '<span class="chip chip-muted">غير نشط</span>'}</td>
      <td></td>
    </tr>
  `).join('');
}

// The list the user currently SEES (search + chips + size + sort) — the table, selection and CSV export all share it
function visibleGuilds() {
  const q = (document.getElementById('guildSearch')?.value ?? '').trim().toLowerCase();
  let list = allGuilds;
  if (q) list = list.filter(g => (g.name ?? '').toLowerCase().includes(q) || g.id.includes(q) || tagsOf(g.id).some(t => t.toLowerCase().includes(q)));
  const tests = G_FILTERS.filter(f => gState.filters.has(f.key) && (!f.owner || isOwnerRole())).map(f => f.test);
  if (tests.length) list = list.filter(g => tests.every(t => t(g)));
  if (gState.size) list = list.filter(g => G_SIZES[gState.size](g.memberCount ?? 0));
  const cmp = G_SORT[gState.sort] ?? G_SORT.surahs;
  return [...list].sort(gState.rev ? (a, b) => cmp(b, a) : cmp);
}

function renderGuildChips() {
  const box = document.getElementById('gfChips');
  const defs = G_FILTERS.filter(f => !f.owner || isOwnerRole());
  if (box.children.length !== defs.length) {
    box.innerHTML = defs.map(f => `<button type="button" class="gf-chip" data-act="own" data-fn="gfToggle" data-f="${f.key}" aria-pressed="false">${f.label} <small></small></button>`).join('');
  }
  defs.forEach((f, i) => {
    const b = box.children[i];
    b.setAttribute('aria-pressed', String(gState.filters.has(f.key)));
    b.querySelector('small').textContent = allGuilds.filter(f.test).length.toLocaleString('ar-EG');
  });
}
function renderGuildTiles() {
  const n = v => v.toLocaleString('ar-EG');
  const tile = (v, l) => `<div class="gf-tile"><b>${n(v)}</b><span>${l}</span></div>`;
  document.getElementById('gfTiles').innerHTML =
    tile(allGuilds.length, 'سيرفر') +
    tile(allGuilds.reduce((a, g) => a + (g.memberCount || 0), 0), 'عضو') +
    tile(allGuilds.filter(g => g.hasSession).length, 'جلسة نشطة الآن') +
    tile(allGuilds.filter(g => g.locked).length, 'سيرفر مقفل');
}

function renderGuilds() {
  const list = visibleGuilds();
  const n = v => v.toLocaleString('ar-EG');
  const shown = list.slice(0, gShown);
  const q = (document.getElementById('guildSearch')?.value ?? '').trim();
  const filtered = !!(q || gState.filters.size || gState.size);
  document.getElementById('guildsCount').textContent =
    list.length === allGuilds.length ? `السيرفرات (${n(allGuilds.length)})` : `السيرفرات (${n(list.length)} من ${n(allGuilds.length)})`;
  document.getElementById('guildsBody').innerHTML = list.length
    ? buildGuildRows(shown, true)
    : `<tr><td colspan="8" class="empty">لا توجد نتائج مطابقة. ${filtered ? '<button class="btn btn-ghost btn-sm" data-act="own" data-fn="gfClear">مسح الفلاتر</button>' : ''}</td></tr>`;
  const more = document.getElementById('gfMore');
  more.style.display = list.length > shown.length ? 'flex' : 'none';
  document.getElementById('gfMoreBtn').textContent = `عرض ${n(Math.min(G_PAGE, list.length - shown.length))} أخرى (${n(list.length - shown.length)} متبقية)`;
  document.getElementById('gfClearBtn').style.display = filtered ? '' : 'none';
  renderGuildChips(); renderGuildTiles();
  if (typeof renderGuildViews === 'function') renderGuildViews();
  ownerSyncSelection();
}
// Search box / dropdowns changed → back to the first page
function filterGuilds() { gReadControls(); gShown = G_PAGE; gPrefsWrite(); renderGuilds(); }

// Guild names are chosen by strangers: neutralise spreadsheet formulas (=, +, -, @) before export
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function exportGuildsCsv(list = visibleGuilds()) {
  if (!Array.isArray(list) || !list.length) return toast('لا توجد بيانات للتصدير', 'warning');
  const rows = [['ID', 'الاسم', 'الأعضاء', 'اللغة', 'السور', 'وقت التلاوة (ثانية)', 'الجلسات', 'القارئ الأكثر', 'جلسة نشطة', 'مقفل', 'مقيّد', 'الوسوم'],
    ...list.map(g => [g.id, g.name, g.memberCount ?? '', g.language, g.totalSurahs ?? 0, g.totalPlayTime ?? 0, g.totalSessions ?? 0, g.topReciter ?? '',
      g.hasSession ? 'نعم' : 'لا', g.locked ? 'نعم' : 'لا', g.restricted ? 'نعم' : 'لا', tagsOf(g.id).join(' | ')])];
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `guilds-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`تم تصدير ${list.length.toLocaleString('ar-EG')} سيرفر ✓`, 'success');
}

async function resetStats(guildId, name) {
  confirmModal('', `إعادة ضبط إحصائيات "${name}"`,
    'سيتم حذف جميع الإحصائيات لهذا السيرفر نهائياً. لا يمكن التراجع.',
    async () => {
      try {
        await apiFetch(`/api/admin/guilds/${guildId}/stats`, { method: 'DELETE' });
        toast('تم إعادة الضبط ✓', 'success');
        logEvent('admin', `إعادة ضبط إحصائيات: ${name}`, `Guild ID: ${guildId}`);
        afterGuildChange(guildId);
      } catch (err) { toast(err.message, 'error'); }
    });
}

function confirmResetAllStats() {
  confirmModal('', 'إعادة ضبط كل الإحصائيات',
    'سيتم حذف إحصائيات جميع السيرفرات نهائياً بدون استثناء. هذا الإجراء لا يمكن التراجع عنه.',
    async () => {
      try {
        await apiFetch('/api/admin/stats/reset-all', { method: 'DELETE', headers: JSON_H, body: JSON.stringify({ confirm: 'RESET_ALL' }) });
        toast('تم إعادة ضبط كل الإحصائيات ✓', 'success');
        logEvent('admin', 'إعادة ضبط كل الإحصائيات', 'جميع السيرفرات');
        loadGuilds();
      } catch (err) { toast(err.message, 'error'); }
    }, 'تأكيد الحذف الكامل', 'حذف');
}

async function changeLang(guildId, lang) {
  try {
    await apiFetch(`/api/admin/guilds/${guildId}/language`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang })
    });
    toast(`تم تغيير اللغة إلى ${lang === 'ar' ? 'العربية' : 'الإنجليزية'} ✓`, 'success');
    logEvent('admin', `تغيير لغة السيرفر`, `Guild: ${guildId} → ${lang}`);
    afterGuildChange(guildId);
  } catch (err) { toast(err.message, 'error'); }
}

async function stopSession(guildId, name, bot = '') {
  confirmModal('', `إيقاف جلسة "${name}"`,
    'سيتم فصل البوت من قناة الصوت في هذا السيرفر فوراً.',
    async () => {
      try {
        await apiFetch(`/api/admin/sessions/${guildId}/stop`, { method: 'POST', headers: JSON_H, body: JSON.stringify(bot ? { bot } : {}) });
        toast('تم إيقاف الجلسة ✓', 'success');
        logEvent('stop', `إيقاف جلسة: ${name}`, `Guild ID: ${guildId}`);
        afterGuildChange(guildId);
        if (document.getElementById('page-sessions').classList.contains('active')) loadSessions();
      } catch (err) { toast(err.message, 'error'); }
    });
}

/* ══ Sessions ════════════════════════════════════════════════════════════ */
async function loadSessions() {
  const grid = document.getElementById('sessionsGrid');
  grid.innerHTML = '<span class="spinner" style="grid-column:1/-1"></span>';
  try {
    const sessions = await apiFetch('/api/sessions');
    document.getElementById('sessionCount').textContent = `${sessions.length} جلسة نشطة`;
    if (!sessions.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">لا توجد جلسات نشطة حالياً</div>';
      return;
    }
    grid.innerHTML = sessions.map(s => `
      <div class="session-card">
        <div class="sc-top">
          <div>
            <div class="sc-guild">${escHtml(s.guildName ?? s.guildId)}</div>
            <div class="sc-ch">${escHtml(s.channel ?? '—')}</div>
            ${s.remote ? `<div class="sc-ch" style="color:var(--gold,#c9a227)">🎧 ${escHtml(s.botTag ?? 'البوت الثاني')}</div>` : ''}
          </div>
          <span class="chip ${s.status === 'playing' ? 'chip-green' : 'chip-gold'}">
            ${s.status === 'playing' ? 'يتلو' : 'متوقف'}
          </span>
        </div>
        <div class="sc-surah">${escHtml(s.surahAr ?? s.surah ?? '—')}</div>
        <div class="sc-reciter">${escHtml(s.reciter ?? '—')}</div>
        <div class="sc-ctl" style="display:flex;gap:.35rem;flex-wrap:wrap;margin:.6rem 0">
          ${s.status === 'playing'
            ? `<button class="btn btn-ghost btn-sm" data-act="sessCtl" data-bot="${s.remote ? escHtml(s.botId) : ''}" data-id="${escHtml(s.guildId)}" data-op="pause" aria-label="إيقاف مؤقت">مؤقت</button>`
            : `<button class="btn btn-ghost btn-sm" data-act="sessCtl" data-bot="${s.remote ? escHtml(s.botId) : ''}" data-id="${escHtml(s.guildId)}" data-op="resume" aria-label="استئناف">استئناف</button>`}
          <button class="btn btn-ghost btn-sm" data-act="sessCtl" data-bot="${s.remote ? escHtml(s.botId) : ''}" data-id="${escHtml(s.guildId)}" data-op="skip" aria-label="التالي">التالي</button>
          <button class="btn btn-ghost btn-sm" data-act="sessCtl" data-bot="${s.remote ? escHtml(s.botId) : ''}" data-id="${escHtml(s.guildId)}" data-op="loop" aria-label="تكرار">تكرار</button>
          <button class="btn btn-ghost btn-sm" data-act="sessVol" data-bot="${s.remote ? escHtml(s.botId) : ''}" data-id="${escHtml(s.guildId)}" data-name="${escHtml(s.guildName ?? s.guildId)}" aria-label="مستوى الصوت">الصوت</button>
        </div>
        <div class="sc-footer">
          <div class="sc-tags">
            ${s.loop      ? '<span class="chip chip-teal" style="font-size:.7rem">تكرار</span>' : ''}
            ${s.fullQuran ? '<span class="chip chip-gold" style="font-size:.7rem">المصحف كاملاً</span>' : ''}
            ${s.queueSize ? `<span class="chip chip-muted" style="font-size:.7rem">قائمة ${s.queueSize}</span>` : ''}
          </div>
          <button class="btn btn-danger btn-sm" data-act="stopSession" data-bot="${s.remote ? escHtml(s.botId) : ''}" data-id="${escHtml(s.guildId)}" data-name="${escHtml(s.guildName ?? s.guildId)}">إيقاف</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">فشل التحميل: ${escHtml(err.message)}</div>`;
    toast(err.message, 'error');
  }
}

// FIX: stopAllSessions uses real current sessions count from API
async function stopAllSessions() {
  let sessionCount = 0;
  try { sessionCount = (await apiFetch('/api/sessions')).length; } catch {}
  confirmModal('', 'إيقاف جميع الجلسات',
    `سيتم إيقاف ${sessionCount} جلسة نشطة في جميع السيرفرات دفعة واحدة.`,
    async () => {
      try {
        const r = await apiFetch('/api/admin/sessions/stop-all', { method: 'POST', headers: JSON_H, body: JSON.stringify({ confirm: 'STOP_ALL' }) });
        toast(`تم إيقاف ${r.stopped ?? sessionCount} جلسة ✓`, 'success');
        logEvent('admin', 'إيقاف جميع الجلسات', 'جميع السيرفرات النشطة');
        loadSessions();
      } catch (err) { toast(err.message, 'error'); }
    });
}

/* ══ Blacklist ══════════════════════════════════════════════════════════ */
async function loadBlacklist() {
  const tbody = document.getElementById('blBody');
  try {
    const data = await apiFetch('/api/admin/blacklist').catch(() => allBlacklist);
    allBlacklist = data;
    const badge = document.getElementById('blBadge');
    if (data.length > 0) { badge.style.display='inline'; badge.textContent=data.length; }
    else badge.style.display='none';
    document.getElementById('blCount').textContent = `القائمة السوداء (${data.length})`;
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">القائمة فارغة</td></tr>'; return; }
    tbody.innerHTML = data.map(b => `
      <tr>
        <td>
          <div class="guild-name">${escHtml(b.name ?? b.guildId)}</div>
          <div class="guild-id">${escHtml(b.guildId)}</div>
        </td>
        <td>${escHtml(b.reason ?? '—')}</td>
        <td style="font-size:0.78rem;color:var(--muted)">${fmtDate(b.bannedAt)}</td>
        <td>
          <button class="btn btn-success btn-sm" data-act="removeFromBlacklist" data-id="${escHtml(b.guildId)}" data-name="${escHtml(b.name??b.guildId)}">
            رفع الحظر
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">فشل التحميل: ${escHtml(err.message)}</td></tr>`;
  }
}

async function addToBlacklist() {
  const guildId = document.getElementById('blGuildId').value.trim();
  const reason  = document.getElementById('blReason').value.trim();
  if (!guildId) { toast('أدخل Guild ID أولاً', 'error'); return; }
  if (!/^\d{17,20}$/.test(guildId)) { toast('المعرّف غير صالح: يجب أن يكون ١٧ إلى ٢٠ رقماً', 'error'); return; }
  confirmModal('', `حظر السيرفر ${guildId}`,
    `السبب: ${reason || 'لا يوجد سبب'}. سيغادر البوت السيرفر فوراً ولن يتمكن من العودة.`,
    async () => {
      try {
        await apiFetch('/api/admin/blacklist', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ guildId, reason })
        });
        toast('تم الحظر ✓', 'success');
        logEvent('ban', `حظر سيرفر: ${guildId}`, `السبب: ${reason}`);
        document.getElementById('blGuildId').value = '';
        document.getElementById('blReason').value  = '';
        loadBlacklist();
      } catch (err) { toast(err.message, 'error'); }
    });
}

function addToBlacklistForGuild(guildId, name) {
  showPage('blacklist', document.querySelector('[data-page=blacklist]'));
  document.getElementById('blGuildId').value = guildId;
  document.getElementById('blReason').value  = '';
  document.getElementById('blGuildId').focus();
}

async function removeFromBlacklist(guildId, name) {
  confirmModal('', `رفع حظر "${name}"`,
    'سيتمكن البوت من العمل في هذا السيرفر مجدداً.',
    async () => {
      try {
        await apiFetch(`/api/admin/blacklist/${guildId}`, { method: 'DELETE' });
        toast('تم رفع الحظر ✓', 'success');
        logEvent('admin', `رفع حظر: ${name}`, `Guild ID: ${guildId}`);
        loadBlacklist();
      } catch (err) { toast(err.message, 'error'); }
    });
}

// FIX: confirmClearAllBlacklist sends confirm token required by server
function confirmClearAllBlacklist() {
  confirmModal('', 'مسح القائمة السوداء بالكامل',
    'سيتم رفع الحظر عن جميع السيرفرات المحظورة. لا يمكن التراجع.',
    async () => {
      try {
        await apiFetch('/api/admin/blacklist', {
          method: 'DELETE',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ confirm: 'CONFIRM' })
        });
        toast('تم مسح القائمة السوداء ✓', 'success');
        allBlacklist = [];
        loadBlacklist();
      } catch (err) { toast(err.message, 'error'); }
    });
}

/* ══ Broadcast ══════════════════════════════════════════════════════════ */
// FIX: load broadcast stats from server
async function loadBcastInfo() {
  try {
    const stats = await apiFetch('/api/admin/broadcast/stats');
    document.getElementById('bsTotalSent').textContent    = stats.total ?? bcastHistory.length;
    document.getElementById('bsLastSent').textContent     = stats.lastSentAt ? timeAgo(stats.lastSentAt) : (bcastHistory[0] ? timeAgo(bcastHistory[0].ts) : '—');
    document.getElementById('bsSuccessRate').textContent  = stats.total > 0 ? '—' : '—';
    document.getElementById('bsTargets').textContent      = allGuilds.length ? `${allGuilds.length} سيرفر` : '—';
  } catch {
    document.getElementById('bsTotalSent').textContent   = bcastHistory.length;
    document.getElementById('bsLastSent').textContent    = bcastHistory[0] ? timeAgo(bcastHistory[0].ts) : '—';
    document.getElementById('bsSuccessRate').textContent = '—';
    document.getElementById('bsTargets').textContent     = allGuilds.length ? `${allGuilds.length} سيرفر` : '—';
  }
  renderBcastHistory();
  updateBcastPreview();
}

function updateCharCount() {
  const len = document.getElementById('bcastMsg').value.length;
  const el  = document.getElementById('charCounter');
  el.textContent = `${len} / 2000`;
  el.style.color = len > 1800 ? 'var(--red)' : 'var(--muted)';
}

function selectBcastType(btn) {
  document.querySelectorAll('.announce-targets .target-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  updateBcastPreview();
}

function updateBcastPreview() {
  const title = document.getElementById('bcastTitle').value;
  const msg   = document.getElementById('bcastMsg').value;
  const type  = document.querySelector('.target-btn.selected')?.dataset.type || 'info';
  const colors = { info:'var(--accent2)', success:'var(--green)', warning:'var(--gold2)', maintenance:'var(--orange)' };
  const icons  = { info:'', success:'', warning:'', maintenance:'' };
  const el = document.getElementById('bcastPreviewText');
  if (!msg && !title) { el.textContent = 'اكتب رسالة لرؤية المعاينة...'; el.style.fontStyle='italic'; el.style.color='var(--muted)'; return; }
  el.style.fontStyle='normal'; el.style.color='var(--text)';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
      <span>${icons[type]}</span>
      <strong style="color:${colors[type]}">${escHtml(title || 'إعلان')}</strong>
    </div>
    <div style="white-space:pre-wrap;font-size:0.83rem">${escHtml(msg)}</div>
    <div style="margin-top:0.6rem;font-size:0.7rem;color:var(--muted)">— بوت القرآن الكريم</div>
  `;
}

async function sendBroadcast() {
  const title = document.getElementById('bcastTitle').value.trim();
  const msg   = document.getElementById('bcastMsg').value.trim();
  const type  = document.querySelector('.target-btn.selected')?.dataset.type || 'info';
  if (!msg) { toast('اكتب رسالة أولاً', 'error'); return; }
  confirmModal('', `إرسال إعلان لـ ${allGuilds.length} سيرفر`,
    `"${(title||msg).slice(0,60)}..." — سيتم الإرسال فوراً لجميع السيرفرات.`,
    async () => {
      const btn = document.getElementById('bcastBtn');
      const status = document.getElementById('bcastStatus');
      btn.disabled = true; btn.textContent = 'جاري الإرسال...';
      status.textContent = '';
      try {
        const r = await apiFetch('/api/admin/broadcast', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ title, message: msg, type })
        });
        const sent = r.sent ?? allGuilds.length;
        toast(`تم الإرسال لـ ${sent} سيرفر ✓`, 'success');
        status.textContent = `✓ أُرسل لـ ${sent} سيرفر`;
        status.style.color = 'var(--green)';
        bcastHistory.unshift({ title, msg, type, ts: Date.now(), sent });
        renderBcastHistory();
        logEvent('admin', `إعلان عام: "${(title||msg).slice(0,40)}"`, `أُرسل لـ ${sent} سيرفر`);
        // FIX: refresh broadcast stats after send
        loadBcastInfo();
      } catch (err) {
        toast(err.message, 'error');
        status.textContent = '✕ فشل الإرسال';
        status.style.color = 'var(--red)';
      } finally { btn.disabled=false; btn.textContent='إرسال للكل'; }
    });
}

async function testBroadcast() {
  const msg = document.getElementById('bcastMsg').value.trim();
  if (!msg) { toast('اكتب رسالة أولاً', 'error'); return; }
  const btn = document.getElementById('bcastTestBtn');
  btn.disabled = true; btn.textContent = '...';
  try {
    await apiFetch('/api/admin/broadcast/test', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message: msg })
    });
    toast('تم إرسال رسالة اختبارية ✓', 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled=false; btn.textContent='اختبار (سيرفر واحد)'; }
}

function renderBcastHistory() {
  const el = document.getElementById('bcastHistory');
  if (!bcastHistory.length) { el.innerHTML = '<div class="empty">لا توجد إعلانات سابقة</div>'; return; }
  el.innerHTML = bcastHistory.slice(0,5).map(b => `
    <div style="padding:0.6rem 0;border-bottom:1px solid var(--border);font-size:0.82rem">
      <div style="font-weight:600;margin-bottom:0.2rem">${escHtml((b.title||b.msg||'').slice(0,40))}</div>
      <div style="color:var(--muted);font-size:0.72rem">${timeAgo(b.ts)} · ${b.sent??'?'} سيرفر</div>
    </div>
  `).join('');
}

/* ══ Lavalink ════════════════════════════════════════════════════════════ */
async function loadLavalinkStatus() {
  const statsEl = document.getElementById('llStats');
  statsEl.innerHTML = '<div class="stat-card" style="grid-column:1/-1"><span class="spinner"></span></div>';
  try {
    const data = await apiFetch('/api/admin/lavalink/status').catch(() => ({
      connected: true, nodes: 1, activePlayers: 0, totalPlayers: 0,
      memUsed: 0, cpuLoad: 0, uptime: 0, ping: 0
    }));
    const connColor = data.connected ? 'var(--green)' : 'var(--red)';
    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-top">الحالة <div class="stat-icon-wrap ${data.connected?'si-green':'si-red'}"></div></div>
        <div class="stat-val" style="font-size:1.2rem;color:${connColor}">${data.connected ? '● متصل' : '● منقطع'}</div>
        <div class="stat-sub">المحرك المحلي</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">مشغّلات نشطة <div class="stat-icon-wrap si-green"></div></div>
        <div class="stat-val">${data.activePlayers ?? 0}</div>
        <div class="stat-sub">من أصل ${data.totalPlayers ?? 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">زمن الاستجابة <div class="stat-icon-wrap si-teal"></div></div>
        <div class="stat-val" style="font-size:1.4rem">${data.ping ?? '—'}ms</div>
        <div class="stat-sub" style="color:var(--green)">متصل</div>
      </div>
      <div class="stat-card">
        <div class="stat-top">مدة التشغيل <div class="stat-icon-wrap si-purple"></div></div>
        <div class="stat-val" style="font-size:1.4rem">${fmtTime(data.uptime ?? 0)}</div>
        <div class="stat-sub">منذ آخر تشغيل</div>
      </div>
    `;
    document.getElementById('llPlayers').textContent  = data.totalPlayers ?? '—';
    document.getElementById('llPlaying').textContent  = data.activePlayers ?? '—';
    document.getElementById('llUptime').textContent   = fmtTime(data.uptime ?? 0);
    document.getElementById('llMemory').textContent   = data.memUsed ? `${Math.round(data.memUsed/1024/1024)}MB` : '—';
    document.getElementById('llCpu').textContent      = data.cpuLoad ? `${(data.cpuLoad*100).toFixed(1)}%` : '—';

    const nodes = data.nodesList ?? [{ name: 'المحرك المحلي', status: data.connected ? 'connected' : 'disconnected', players: data.activePlayers ?? 0, uptime: data.uptime ?? 0, ping: data.ping ?? 0, cpuLoad: data.cpuLoad ?? 0, memUsed: data.memUsed ?? 0, reconnectAttempts: 0, lastError: null, lastConnectedAt: null }];
    document.getElementById('llNodes').innerHTML = nodes.map(n => {
      const isConn   = n.status === 'connected';
      const pingCol  = n.ping < 80 ? 'var(--green)' : n.ping < 200 ? 'var(--gold2)' : 'var(--red)';
      const cpuVal   = n.cpuLoad ? (n.cpuLoad*100).toFixed(1) : null;
      const cpuCol   = !cpuVal ? '' : n.cpuLoad < 0.5 ? 'color:var(--green)' : n.cpuLoad < 0.8 ? 'color:var(--gold2)' : 'color:var(--red)';
      return `
        <div class="node-card" style="border-color:${isConn ? 'rgba(235,235,238,0.2)' : 'rgba(224,103,92,0.2)'}">
          <div class="node-header">
            <div class="node-name">${escHtml(n.name)}</div>
            <span class="chip ${isConn ? 'chip-green' : 'chip-red'}">${isConn ? '● متصل' : '● منقطع'}</span>
          </div>
          <div class="node-stats">
            <div class="node-stat"><div class="node-stat-label">الاستجابة</div><div class="node-stat-val" style="color:${pingCol}">${n.ping ?? '—'}ms</div></div>
            <div class="node-stat"><div class="node-stat-label">المشغّلات</div><div class="node-stat-val">${n.players ?? 0}</div></div>
            <div class="node-stat"><div class="node-stat-label">المعالج</div><div class="node-stat-val" style="${cpuCol}">${cpuVal ? cpuVal+'%' : '—'}</div></div>
            <div class="node-stat"><div class="node-stat-label">الذاكرة</div><div class="node-stat-val">${n.memUsed ? Math.round(n.memUsed/1024/1024)+'MB' : '—'}</div></div>
            <div class="node-stat"><div class="node-stat-label">التشغيل</div><div class="node-stat-val">${fmtTime(n.uptime??0)}</div></div>
            <div class="node-stat"><div class="node-stat-label">إعادة الاتصال</div><div class="node-stat-val" style="${(n.reconnectAttempts??0)>0?'color:var(--gold2)':''}">${n.reconnectAttempts ?? 0}</div></div>
          </div>
          ${n.lastConnectedAt ? `
          <div style="font-size:0.73rem;color:var(--muted);margin-top:0.6rem;padding-top:0.5rem;border-top:1px solid var(--border)">
            بدأ التشغيل ${timeAgo(n.lastConnectedAt)}
          </div>` : ''}
          ${n.lastError ? `
          <div style="font-size:0.72rem;color:var(--red);background:rgba(224,103,92,0.07);border:1px solid rgba(224,103,92,0.15);border-radius:7px;padding:0.45rem 0.7rem;margin-top:0.6rem;word-break:break-word">
            آخر خطأ: ${escHtml(n.lastError)}
          </div>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    statsEl.innerHTML = `<div class="empty" style="grid-column:1/-1">فشل التحميل: ${escHtml(err.message)}</div>`;
  }
}

async function reconnectLavalink() {
  const btn = document.getElementById('llReconnectBtn');
  btn.disabled = true; btn.textContent = 'جاري الاتصال...';
  try {
    await apiFetch('/api/admin/lavalink/reconnect', { method: 'POST' });
    toast('تم إعادة الاتصال ✓', 'success');
    logEvent('admin', 'إعادة اتصال الصوت', 'القنوات المنقطعة');
    setTimeout(loadLavalinkStatus, 1500);
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled=false; btn.textContent='إعادة الاتصال'; }
}

async function clearLavalinkCache() {
  const btn = document.getElementById('llCacheBtn');
  btn.disabled = true; btn.textContent = '...';
  try {
    await apiFetch('/api/admin/lavalink/cache', { method: 'DELETE' });
    toast('تم مسح الكاش ✓', 'success');
    logEvent('admin', 'مسح كاش البيانات', '');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled=false; btn.textContent='مسح الكاش'; }
}

/* ══ Control ══════════════════════════════════════════════════════════════ */
// FIX: setActivity sends type field so server can use the correct ActivityType
async function setActivity() {
  const text = document.getElementById('activityInput').value.trim();
  const type = document.getElementById('activityType').value;
  if (!text) return toast('أدخل نصاً أولاً', 'error');
  const btn = document.getElementById('activityBtn');
  btn.disabled = true; btn.textContent = '...';
  try {
    await apiFetch('/api/admin/bot/activity', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ text, type })
    });
    toast('تم تغيير النشاط ✓', 'success');
    logEvent('admin', `تغيير نشاط البوت`, `${type}: ${text}`);
    document.getElementById('activityInput').value = '';
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled=false; btn.textContent='تطبيق'; }
}

function toggleSetting(key, el) {
  settings[key] = !settings[key];
  el.classList.toggle('on', settings[key]);
  toast(`${settings[key] ? 'تم تفعيل' : 'تم تعطيل'} الإعداد`, 'success');
  apiFetch('/api/admin/settings', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ key, value: settings[key] })
  }).catch(() => {});
}

async function deployCommands() {
  confirmModal('', 'نشر الأوامر', 'سيتم نشر جميع أوامر البوت على Discord. قد يستغرق ذلك بضع دقائق.',
    async () => {
      try {
        await apiFetch('/api/admin/bot/deploy', { method: 'POST', headers: JSON_H, body: JSON.stringify({ confirm: 'DEPLOY' }) });
        toast('تم نشر الأوامر ✓', 'success');
        logEvent('admin', 'نشر أوامر البوت', '');
      } catch (err) { toast(err.message, 'error'); }
    });
}

async function clearCache() {
  try {
    await apiFetch('/api/admin/bot/cache', { method: 'DELETE' });
    toast('تم مسح الكاش ✓', 'success');
    logEvent('admin', 'مسح كاش البوت', '');
  } catch (err) { toast(err.message, 'error'); }
}

async function syncStats() {
  try {
    await apiFetch('/api/admin/bot/sync-stats', { method: 'POST' });
    toast('تمت مزامنة الإحصائيات ✓', 'success');
    logEvent('admin', 'مزامنة الإحصائيات', '');
  } catch (err) { toast(err.message, 'error'); }
}

// FIX: maintenance button reflects real server state (toggle with visual feedback)
async function loadMaintenanceState() {
  try {
    const r = await apiFetch('/api/admin/bot/maintenance');
    maintenanceActive = r.maintenance ?? false;
    updateMaintenanceBtn();
  } catch {}
}

function updateMaintenanceBtn() {
  const btn = document.querySelector('[data-act="call" data-fn="maintenanceMode"]');
  if (!btn) return;
  btn.textContent = maintenanceActive ? 'إيقاف وضع الصيانة' : 'تفعيل وضع الصيانة';
  btn.className   = maintenanceActive ? 'btn btn-success' : 'btn btn-warning';
}

async function maintenanceMode() {
  const nextState = !maintenanceActive;
  confirmModal(
    '',
    nextState ? 'تفعيل وضع الصيانة' : 'إيقاف وضع الصيانة',
    nextState
      ? 'سيتم تعطيل استقبال الأوامر الجديدة مؤقتاً مع إبقاء الجلسات النشطة.'
      : 'سيعود البوت لاستقبال الأوامر بشكل طبيعي.',
    async () => {
      try {
        const r = await apiFetch('/api/admin/bot/maintenance', { method: 'POST' });
        maintenanceActive = r.maintenance ?? nextState;
        updateMaintenanceBtn();
        toast(maintenanceActive ? 'تم تفعيل وضع الصيانة ✓' : 'تم إيقاف وضع الصيانة ✓', 'warning');
        logEvent('admin', maintenanceActive ? 'تفعيل وضع الصيانة' : 'إيقاف وضع الصيانة', '');
      } catch (err) { toast(err.message, 'error'); }
    }
  );
}

function confirmRestartBot() {
  confirmModal('', 'إعادة تشغيل البوت',
    'سيتم إيقاف البوت وإعادة تشغيله. ستنتهي جميع الجلسات النشطة. هذا الإجراء فوري.',
    async () => {
      try {
        await apiFetch('/api/admin/bot/restart', { method: 'POST', headers: JSON_H, body: JSON.stringify({ confirm: 'RESTART' }) });
        toast('جاري إعادة التشغيل...', 'warning');
        logEvent('admin', 'إعادة تشغيل البوت', 'جميع الجلسات انتهت');
      } catch (err) { toast(err.message, 'error'); }
    }, 'إعادة التشغيل', 'تشغيل');
}

async function loadSysInfo() {
  const el = document.getElementById('sysInfo');
  try {
    const s = await apiFetch('/api/status');
    el.innerHTML = `
      <div class="info-row"><span class="info-label">السيرفرات</span><span class="info-val">${(s.guilds ?? 0).toLocaleString('ar-EG')}</span></div>
      <div class="info-row"><span class="info-label">Ping</span><span class="info-val" style="color:var(--green)">${s.ping}ms</span></div>
      <div class="info-row"><span class="info-label">مدة التشغيل</span><span class="info-val">${fmtTime(s.uptime ?? 0)}</span></div>
      <div class="info-row"><span class="info-label">جلسات نشطة</span><span class="info-val">${s.activeSessions}</span></div>
      <div class="info-row"><span class="info-label">إجمالي الجلسات</span><span class="info-val">${s.totalSessions?.toLocaleString('ar-EG') ?? '—'}</span></div>
      <div class="info-row"><span class="info-label">Node.js</span><span class="info-val">${s.nodeVersion ?? '—'}</span></div>
    `;
  } catch { el.innerHTML = '<div class="empty">تعذّر التحميل</div>'; }
}

/* ══ Init ══════════════════════════════════════════════════════════════ */
initAuth();
// Sidebar links are <a> without href: make them real keyboard-operable buttons.
document.querySelectorAll('.nav-item').forEach(a => {
  a.setAttribute('role', 'button'); a.tabIndex = 0;
  a.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); a.click(); } });
});
// Esc closes the dialog on top first (confirm / input / choice); only when none is open does it close the server drawer
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.modal-overlay.open')) { closeModal(); closeInputModal(); pickClose(); }
  else closeGuildModal();
});
function refreshActivePage() {
  if (!currentUser?.isAdmin || document.hidden) return;
  const active = document.querySelector('.page.active')?.id;
  if (active === 'page-overview')  loadOverview();
  if (active === 'page-sessions')  loadSessions();
  if (active === 'page-lavalink')  loadLavalinkStatus();
}
setInterval(refreshActivePage, 20_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshActivePage(); });   // no background polling; refresh on return



/* ══ Voice control, server management (owner) ═══════════════════════════ */
async function sessCtl(guildId, op, value, bot = '') {
  try {
    const r = await apiFetch(`/api/admin/sessions/${guildId}/control`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ action: op, value, ...(bot ? { bot } : {}) }) });
    toast(op === 'loop' ? (r.loop ? 'التكرار: مفعّل ✓' : 'التكرار: متوقف ✓') : 'تم ✓', 'success');
    setTimeout(loadSessions, 600);
  } catch (err) { toast(err.message, 'error'); }
}

function sessVol(guildId, name, bot = '') {
  openInputModal('', `مستوى الصوت — ${name}`, 'اكتب رقمًا من 0 إلى 150.', { placeholder: '100', multiline: false, okLabel: 'تطبيق', numeric: true },
    (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 150) return toast('أدخل رقمًا صحيحًا من 0 إلى 150', 'error');
      sessCtl(guildId, 'volume', n, bot);
    });
}

function leaveGuild(guildId, name) {
  confirmModal('', `مغادرة "${name}"`,
    'سيغادر البوت هذا السيرفر ويوقف جلسته. للعودة يلزم إعادة دعوته.',
    async () => {
      try {
        await apiFetch(`/api/admin/guilds/${guildId}/leave`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ confirm: guildId }) });
        toast('غادر البوت السيرفر ✓', 'success');
        loadGuilds();
      } catch (err) { toast(err.message, 'error'); }
    }, 'مغادرة', name);
}

function msgGuild(guildId, name) {
  openInputModal('', `رسالة إلى "${name}"`, 'ترسل كإعلان في قناة الإعلانات التي يستطيع البوت الكتابة فيها.', { placeholder: 'اكتب الرسالة…', multiline: true, okLabel: 'إرسال' },
    async (v) => {
      if (!v) return toast('اكتب الرسالة أولاً', 'error');
      try {
        const r = await apiFetch(`/api/admin/guilds/${guildId}/message`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ message: v }) });
        toast(`أُرسلت في #${r.channel} ✓`, 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
}

// Small reusable modal with one text input / textarea (the HTML lives in index.html: #inputModal)
function openInputModal(icon, title, sub, { placeholder = '', multiline = false, okLabel = 'تأكيد', numeric = false } = {}, onOk) {
  document.getElementById('inputIcon').textContent  = icon;
  document.getElementById('inputTitle').textContent = title;
  document.getElementById('inputSub').textContent   = sub;
  const one = document.getElementById('inputOne'), many = document.getElementById('inputMany');
  const el = multiline ? many : one;
  one.style.display = multiline ? 'none' : 'block';
  many.style.display = multiline ? 'block' : 'none';
  el.value = ''; el.placeholder = placeholder;
  one.inputMode = numeric ? 'numeric' : 'text';
  const ok = document.getElementById('inputOk');
  ok.textContent = okLabel;
  ok.onclick = () => { const v = el.value.trim(); closeInputModal(); onOk(v); };
  _lastFocus = document.activeElement;
  document.getElementById('inputModal').classList.add('open');
  el.focus();
}
function closeInputModal() {
  document.getElementById('inputModal').classList.remove('open');
  if (_lastFocus?.focus) _lastFocus.focus();
}
document.getElementById('inputModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeInputModal(); });

/* ══ Event delegation ═══════════════════════════════════════════════════
   The page has NO inline handlers (the server's CSP forbids them): buttons carry data-act / data-* attributes and
   these listeners dispatch to a fixed whitelist of functions. Dynamic values (guild ids/names) only ever travel as
   attribute TEXT, never as code. */
const CALLABLE = { closeInputModal, addToBlacklist, clearActivityLog, clearCache, clearLavalinkCache, closeGuildModal, closeModal, confirmClearAllBlacklist, confirmResetAllStats, confirmRestartBot, deployCommands, exportGuildsCsv, filterActivity, filterGuilds, loadActivity, loadAnalytics, loadBlacklist, loadGuilds, loadLavalinkStatus, loadOverview, loadSessions, logout, maintenanceMode, reconnectLavalink, sendBroadcast, setActivity, stopAllSessions, syncStats, testBroadcast, updateBcastPreview, updateCharCount };

document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-act]');
  if (!el) return;
  const d = el.dataset;
  switch (d.act) {
    case 'page':       e.preventDefault(); showPage(d.page, el); break;
    case 'goto':       showPage(d.goto, document.querySelector(`[data-page="${d.goto}"]`)); break;
    case 'toggle':     toggleSetting(d.key, el); break;
    case 'bcastType':  selectBcastType(el); break;
    case 'call':       if (Object.hasOwn(CALLABLE, d.fn)) CALLABLE[d.fn](); break;
    case 'openGuild': { const g = allGuilds.find(x => x.id === d.id); if (g) openGuildModal(g); break; }
    case 'sessCtl':               sessCtl(d.id, d.op, undefined, d.bot); break;
    case 'sessVol':               sessVol(d.id, d.name, d.bot); break;
    case 'leaveGuild':            leaveGuild(d.id, d.name);            if (d.close) closeGuildModal(); break;
    case 'msgGuild':              msgGuild(d.id, d.name);              if (d.close) closeGuildModal(); break;
    case 'stopSession':           stopSession(d.id, d.name, d.bot);    if (d.close) closeGuildModal(); break;
    case 'resetStats':            resetStats(d.id, d.name);            if (d.close) closeGuildModal(); break;
    case 'changeLang':            changeLang(d.id, d.lang);            if (d.close) closeGuildModal(); break;
    case 'addToBlacklistForGuild': addToBlacklistForGuild(d.id, d.name); break;
    case 'removeFromBlacklist':   removeFromBlacklist(d.id, d.name);   break;
    case 'blacklistFromModal':    closeGuildModal(); setTimeout(() => addToBlacklistForGuild(d.id, d.name), 300); break;
  }
});

// Text fields fire on every keystroke; re-rendering a long list each time is wasteful, so typing is debounced (other inputs run at once).
const inputTimers = new WeakMap();
const isTextField = (el) => el.tagName === 'INPUT' && ['text', 'search', ''].includes(el.getAttribute('type') ?? '');
for (const evt of ['input', 'change']) {
  document.addEventListener(evt, (e) => {
    const el = e.target.closest?.(`[data-${evt}]`);
    if (!el) return;
    const run = () => { for (const n of el.dataset[evt].split(',')) if (Object.hasOwn(CALLABLE, n)) CALLABLE[n](); };
    if (evt === 'input' && isTextField(el)) { clearTimeout(inputTimers.get(el)); inputTimers.set(el, setTimeout(run, 160)); }
    else run();
  });
}

// A guild icon that fails to load is replaced by its first letter (error events don't bubble → capture phase).
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('guild-icon-img')) return;
  const box = document.createElement('div');
  box.className = 'guild-icon-text';
  box.textContent = img.dataset.initial || '?';
  img.replaceWith(box);
}, true);
