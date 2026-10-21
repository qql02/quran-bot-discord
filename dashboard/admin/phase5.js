/* Owner panel — phase 5: Fleet & /pull, Stations & reciters, Wird / adhkar / events, Security.
   Loaded after control.js; reuses apiFetch, post, toast, confirmModal, escHtml, timeAgo, $, num.
   No inline handlers (CSP): buttons carry data-act="own" data-fn="<name>" and are dispatched through OWNER_FN.
   Every string that came from the server goes through escHtml before it touches innerHTML. */

const P5 = {
  fleet:    { tab: 'bots',    tabs: [['bots', 'الأسطول'], ['jobs', 'المهام'], ['pulls', 'إحصائيات /pull']] },
  stations: { tab: 'global',  tabs: [['global', 'المحطات العامة'], ['guild', 'محطات السيرفرات'], ['reciters', 'القرّاء']] },
  content:  { tab: 'wird',    tabs: [['wird', 'الورد'], ['schedules', 'النشر المجدول'], ['events', 'المناسبات']] },
  security: { tab: 'overview', tabs: [['overview', 'نظرة عامة'], ['sessions', 'الجلسات'], ['logins', 'الدخول'], ['export', 'التصدير']] }
};
const p5e = escHtml;
const p5body = (page) => $(`p5-${page}-body`);
const p5q = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const p5v = (id) => ($(id)?.value ?? '').trim();
const p5err = (page, e) => { const b = p5body(page); if (b) b.innerHTML = `<div class="empty">${p5e(e.message)}</div>`; };
const p5spin = (page) => { const b = p5body(page); if (b) b.innerHTML = '<div class="empty"><span class="spinner"></span></div>'; };
const p5dur = (ms) => (ms == null ? '—' : ms < 1000 ? `${num(ms)} ms` : `${num(Math.round(ms / 100) / 10)} ث`);
const p5ago = (sec) => (sec == null ? '—' : sec < 60 ? `${num(sec)} ث` : sec < 3600 ? `${num(Math.round(sec / 60))} د` : `${num(Math.round(sec / 3600))} س`);
const p5stat = (label, val, sub = '') => `<div class="stat-card"><div class="stat-top">${p5e(label)}</div><div class="stat-val">${val}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
const p5chip = (text, cls = 'muted') => `<span class="chip chip-${cls}">${p5e(text)}</span>`;
const p5btn = (fn, label, attrs = {}, cls = 'btn-ghost') =>
  `<button class="btn ${cls} btn-sm" data-act="own" data-fn="${fn}"${Object.entries(attrs).map(([k, v]) => ` data-${k}="${p5e(v)}"`).join('')}>${p5e(label)}</button>`;
const p5table = (heads, rows, empty = 'لا توجد بيانات.') => rows.length
  ? `<div class="card" style="overflow:auto;margin-bottom:1rem"><table><thead><tr>${heads.map(h => `<th>${p5e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : `<div class="empty">${p5e(empty)}</div>`;
const p5pager = (fn, d, extra = {}) => {
  const pages = Math.max(1, Math.ceil(d.total / d.limit));
  if (pages < 2) return '';
  return `<div class="adv-row" style="justify-content:center">
    ${p5btn(fn, 'السابق', { ...extra, page: d.page - 1 }).replace('<button', d.page <= 1 ? '<button disabled' : '<button')}
    <span class="dr-hint">${num(d.page)} / ${num(pages)} · ${num(d.total)}</span>
    ${p5btn(fn, 'التالي', { ...extra, page: d.page + 1 }).replace('<button', d.page >= pages ? '<button disabled' : '<button')}</div>`;
};
const p5copy = { remote: 'سحب مع الجلسة', clone: 'نسخ إلى بوت آخر', move: 'نقل الجلسة' };
const P5_KEYS = {
  not_in_voice: 'ليس في قناة صوتية', pull_someone_joined: 'انضم شخص للقناة القديمة', worker_still_joining: 'البوت ما زال ينضم', timeout: 'انتهت المهلة',
  station_unreachable: 'المحطة لا تستجيب', station_not_audio: 'الرابط ليس بثًا صوتيًا', no_url: 'لا رابط', unexpected: 'خطأ غير متوقع', unknown: 'غير معروف'
};
const p5key = (k) => P5_KEYS[k] ?? k ?? '—';

/* ── shell: tabs + page loader ───────────────────────────────────────────── */
function p5Tabs(page) {
  const box = $(`p5-${page}-tabs`); if (!box) return;
  box.innerHTML = P5[page].tabs.map(([k, label]) => p5btn('p5Tab', label, { page, tab: k }, P5[page].tab === k ? 'btn-primary' : 'btn-ghost')).join('');
}
function p5Tab(d) { if (!P5[d.page]) return; P5[d.page].tab = d.tab; p5Load(d.page); }
function p5Load(page) {
  p5Tabs(page); p5spin(page);
  const fn = P5_LOADERS[`${page}:${P5[page].tab}`];
  if (fn) fn({});
}
const p5Reload = (d) => p5Load(d.page);

/* ══ 1. Fleet & /pull ════════════════════════════════════════════════════ */
async function fleetBots() {
  try {
    const [d, sec, sw] = await Promise.all([apiFetch('/api/admin/fleet'), apiFetch('/api/admin/fleet/second').catch(() => null), apiFetch('/api/admin/second-bot').catch(() => null)]);
    const t = d.totals;
    const cards = d.rows.map(r => `<div class="ctrl-card">
      <div class="ctrl-title">${p5e(r.tag)} ${r.self ? p5chip('هذه العملية', 'blue') : ''} ${p5chip(r.role === 'secondary' ? 'عامل صوت' : 'رئيسي', r.role === 'secondary' ? 'purple' : 'teal')} ${r.alive ? p5chip('متصل', 'green') : p5chip('غير متصل', 'red')}</div>
      <div class="info-row"><span class="info-label">آخر نبضة</span><span class="info-val">${r.alive ? 'قبل ' + p5ago(r.lastSeenAgoSec) : 'قبل ' + p5ago(r.lastSeenAgoSec)}</span></div>
      <div class="info-row"><span class="info-label">السيرفرات</span><span class="info-val">${num(r.guilds)}</span></div>
      <div class="info-row"><span class="info-label">جلسات نشطة</span><span class="info-val">${num(r.sessions)}</span></div>
      ${r.self && r.ping != null ? `<div class="info-row"><span class="info-label">Ping</span><span class="info-val">${num(r.ping)} ms</span></div>` : ''}
      ${r.sessionList.slice(0, 6).map(s => `<div class="dr-hint">${p5e(s.guildName ?? s.guildId)} · ${p5e(s.channelName || s.channelId)} · ${p5e(s.status)}${s.surah ? ' · ' + p5e(s.surah) : ''}</div>`).join('')}
      ${r.sessionList.length > 6 ? `<div class="dr-hint">+${num(r.sessionList.length - 6)} أخرى</div>` : ''}
      ${!r.alive && !r.self ? `<div class="adv-row">${p5btn('fleetForget', 'نسيان هذا البوت', { id: r.id, tag: r.tag }, 'btn-danger')}</div>` : ''}
    </div>`).join('');
    p5body('fleet').innerHTML = `<div class="stats-row">
      ${p5stat('كل البوتات', num(t.bots))}${p5stat('متصل', num(t.alive), `نافذة النبض ${num(d.aliveWindowSec)} ث`)}${p5stat('غير متصل', num(t.offline))}
      ${p5stat('عمّال الصوت', num(t.workers))}${p5stat('عمّال فارغون', num(t.freeWorkers), 'جاهزون للسحب')}${p5stat('جلسات نشطة', num(t.sessions))}</div>
      <div class="cc-grid">${cards || '<div class="empty">لا بوتات مسجلة.</div>'}</div>
      ${fleetSwitchHtml(sw)}
      ${fleetSecondHtml(sec)}`;
  } catch (e) { p5err('fleet', e); }
}
/** ON / OFF for the second bot started from this project. OFF ends its process, so all of its memory (caches included) is released. */
function fleetSwitchHtml(sw) {
  if (!sw) return '';
  const head = `<h4 style="margin:1.4rem 0 .5rem">🎧 تشغيل / إيقاف البوت الثاني</h4>`;
  if (!sw.managed) return `${head}<div class="dr-hint">البوت الثاني لا يُشغَّل من هذا المشروع (لا يوجد <code>SECOND_BOT_TOKEN</code> هنا)، لذلك لا يمكن إيقافه من هذه اللوحة. أوقفه من استضافته.</div>`;
  const state = sw.running ? p5chip('يعمل', 'green') : sw.paused ? p5chip('متوقف من اللوحة', 'red') : sw.gaveUp ? p5chip('توقف بعد أعطال متكررة', 'red') : p5chip('يبدأ…', 'blue');
  const ram = sw.running && sw.ramMb != null ? `<div class="info-row"><span class="info-label">الرام التي يستهلكها</span><span class="info-val">${num(sw.ramMb)} MB</span></div>` : '';
  const up = sw.running && sw.uptimeSec != null ? `<div class="info-row"><span class="info-label">يعمل منذ</span><span class="info-val">${p5ago(sw.uptimeSec)}</span></div>` : '';
  const btn = sw.running
    ? p5btn('secondBotStop', '⏹ إيقاف كامل', {}, 'btn-danger')
    : p5btn('secondBotStart', sw.paused || sw.gaveUp ? '▶ تشغيل البوت الثاني' : '▶ تشغيل', {}, 'btn-primary');
  const hint = sw.running
    ? 'الإيقاف ينهي عمليته بالكامل: يخرج من الرومات الصوتية وتُحرَّر كل ذاكرته (الكاش وغيره) فوراً، ولا يعود حتى بعد إعادة تشغيل البوت الرئيسي إلى أن تشغّله من هنا.'
    : 'متوقف: لا يستهلك أي رام. عند التشغيل يعود بجلساته المحفوظة.';
  return `${head}<div class="cc-grid"><div class="ctrl-card"><div class="ctrl-title">${state}</div>${up}${ram}
    <div class="dr-hint">${p5e(hint)}</div><div class="adv-row">${btn}</div></div></div>`;
}
function secondBotStop() {
  confirmModal('⏹', 'إيقاف البوت الثاني كاملاً', 'سيخرج من كل الرومات الصوتية وتُنهى عمليته وتُحرَّر ذاكرته. يمكنك تشغيله من هنا في أي وقت.', async () => {
    try { await post('/api/admin/second-bot', { action: 'stop' }); toast('أُوقف البوت الثاني ✓', 'success'); fleetBots(); }
    catch (e) { toast(e.message, 'error'); }
  }, 'إيقاف');
}
async function secondBotStart() {
  try { await post('/api/admin/second-bot', { action: 'start' }); toast('جارٍ تشغيل البوت الثاني ✓', 'success'); setTimeout(fleetBots, 1500); }
  catch (e) { toast(e.message, 'error'); }
}
/** The second bot across servers: where it is, where it is missing, and a pinned invite link per server (opens Discord in a new tab). */
function fleetSecondHtml(d) {
  if (!d) return '';
  if (!d.configured) return `<h4 style="margin:1.4rem 0 .5rem">🎧 البوت الثاني</h4><div class="dr-hint">لا يوجد بوت ثانٍ مسجّل. شغّل <code>npm run add-bot</code> ثم شغّل البوت الثاني مرة واحدة ليظهر هنا.</div>`;
  const link = (url, label) => (typeof url === 'string' && url.startsWith('https://discord.com/') ? `<a class="btn btn-ghost btn-sm" href="${p5e(url)}" target="_blank" rel="noopener noreferrer">${p5e(label)}</a>` : '');
  const rows = d.missing.map(g => `<tr><td>${p5e(g.name ?? g.id)}</td><td><code>${p5e(g.id)}</code></td><td>${num(g.members)}</td><td>${link(g.invite, 'رابط الإضافة')}</td></tr>`);
  return `<h4 style="margin:1.4rem 0 .5rem">🎧 البوت الثاني</h4>
    <div class="stats-row">${p5stat('البوتات الثانية', num(d.bots.length), d.bots.map(b => `${p5e(b.tag)} ${b.alive ? '🟢' : '🔴'}`).join(' · '))}
      ${p5stat('سيرفرات فيها بوت ثانٍ', `${num(d.covered)} / ${num(d.guildsTotal)}`, `${num(d.coveredAlive)} منها متصل الآن`)}
      ${p5stat('بلا بوت ثانٍ', num(d.guildsTotal - d.covered), 'لا يُسلَّم الطلب فيها لأحد')}</div>
    <div class="adv-row">${link(d.invite, 'رابط دعوة عام')}<span class="dr-hint">يضيفه مدير كل سيرفر بنفسه من زر «🎧 البوت الثاني» تحت /invite.</span></div>
    ${p5table(['السيرفر', 'المعرّف', 'الأعضاء', ''], rows, 'كل السيرفرات فيها بوت ثانٍ ✓')}
    ${d.guildsTotal - d.covered > d.missing.length ? `<div class="dr-hint">يُعرض أكبر ${num(d.missing.length)} سيرفر فقط.</div>` : ''}`;
}
function fleetForget(d) {
  confirmModal('🗑', `نسيان ${d.tag}`, 'يُحذف سجل البوت غير المتصل من القائمة فقط. إن عاد للعمل يظهر من جديد.', async () => {
    try { await post(`/api/admin/fleet/bots/${encodeURIComponent(d.id)}/forget`, { confirm: 'FORGET' }); toast('حُذف السجل ✓', 'success'); fleetBots(); }
    catch (e) { toast(e.message, 'error'); }
  }, 'نسيان', 'FORGET');
}

async function fleetJobs(d = {}) {
  const status = d.status ?? P5.fleet.jobStatus ?? '';
  P5.fleet.jobStatus = status;
  try {
    const r = await apiFetch(`/api/admin/fleet/jobs?${p5q({ status })}`);
    const s = r.summary;
    const rows = r.rows.map(j => `<tr>
      <td>${p5chip(j.status, j.status === 'done' ? 'green' : j.status === 'failed' ? 'red' : j.status === 'cancelled' ? 'muted' : 'gold')}${j.stuck ? ' ' + p5chip('عالقة', 'orange') : ''}</td>
      <td>${p5e(j.kind)}</td><td>${p5e(j.guildName ?? j.guildId)}</td><td><code>${p5e(j.targetBotId)}</code></td>
      <td>${p5ago(j.ageSec)}</td><td>${p5dur(j.durationMs)}</td><td>${j.error ? p5e(p5key(j.error)) : '—'}</td>
      <td>${j.status === 'pending' || j.status === 'claimed' ? p5btn('fleetCancelJob', 'إلغاء', { id: j.id }, 'btn-danger') : ''}</td></tr>`);
    p5body('fleet').innerHTML = `<div class="stats-row">
      ${p5stat('آخر 24 ساعة', num(s.total))}${p5stat('نجحت', num(s.byStatus.done))}${p5stat('فشلت', num(s.byStatus.failed), s.failRate == null ? '' : `${num(s.failRate)}%`)}
      ${p5stat('قيد الانتظار', num(s.byStatus.pending + s.byStatus.claimed))}${p5stat('عالقة', num(s.stuck), `> ${num(r.limits.pendingMs / 1000)} ث انتظار`)}
      ${p5stat('متوسط الزمن', p5dur(s.avgMs), `p95: ${p5dur(s.p95Ms)}`)}</div>
      <div class="adv-row">
        <select class="field" id="p5JobStatus" data-p5change="fleetJobs" style="width:auto">${['', 'pending', 'claimed', 'done', 'failed', 'cancelled'].map(v => `<option value="${v}"${v === status ? ' selected' : ''}>${v || 'كل الحالات'}</option>`).join('')}</select>
        ${s.stuck ? p5btn('fleetCancelStuck', `إلغاء العالقة (${num(s.stuck)})`, {}, 'btn-warning') : ''}
        ${p5btn('p5Reload', 'تحديث', { page: 'fleet' })}</div>
      ${Object.keys(s.errors).length ? `<div class="dr-hint">أسباب الفشل: ${Object.entries(s.errors).map(([k, n]) => `${p5e(p5key(k))} (${num(n)})`).join(' · ')}</div>` : ''}
      ${p5table(['الحالة', 'النوع', 'السيرفر', 'البوت', 'العمر', 'المدة', 'الخطأ', ''], rows, 'لا مهام.')}`;
  } catch (e) { p5err('fleet', e); }
}
async function fleetCancelJob(d) {
  try { await post(`/api/admin/fleet/jobs/${encodeURIComponent(d.id)}/cancel`, {}); toast('أُلغيت المهمة ✓', 'success'); } catch (e) { toast(e.message, 'error'); }
  fleetJobs();
}
function fleetCancelStuck() {
  confirmModal('⏹', 'إلغاء المهام العالقة', 'تُلغى كل مهمة تجاوزت حدّ الانتظار. لن يؤثر ذلك على الجلسات التي تعمل.', async () => {
    try { const r = await post('/api/admin/fleet/jobs/cancel-stuck', {}); toast(`أُلغي ${num(r.cancelled)} ✓`, 'success'); } catch (e) { toast(e.message, 'error'); }
    fleetJobs();
  }, 'إلغاء');
}

async function fleetPulls() {
  try {
    const d = await apiFetch('/api/admin/fleet/pulls'), s = d.summary;
    const max = Math.max(1, ...s.perDay.map(x => x.ok + x.failed));
    const bars = s.perDay.map(x => `<div class="cc-row"><span>${p5e(x.day)}</span>
      <span style="flex:3;display:flex;height:10px;background:var(--border);border-radius:5px;overflow:hidden">
        <i style="width:${(x.ok / max) * 100}%;background:var(--green)"></i><i style="width:${(x.failed / max) * 100}%;background:var(--red)"></i></span>
      <span class="dr-hint">${num(x.ok)} / ${num(x.failed)}</span></div>`).join('');
    const rows = d.recent.map(r => `<tr><td>${timeAgo(r.at)}</td><td>${r.ok ? p5chip('نجح', 'green') : p5chip('فشل', 'red')}</td><td>${p5e(p5copy[r.kind] ?? r.kind ?? '—')}</td>
      <td>${p5e(r.guildName ?? r.guildId)}</td><td>${r.ok ? '—' : p5e(p5key(r.key))}</td><td>${p5dur(r.ms)}</td></tr>`);
    p5body('fleet').innerHTML = `<div class="stats-row">
      ${p5stat('آخر 7 أيام', num(s.total))}${p5stat('نسبة النجاح', s.rate == null ? '—' : `${num(s.rate)}%`)}${p5stat('نقل', num(s.byKind.move))}${p5stat('نسخ', num(s.byKind.clone))}${p5stat('متوسط الزمن', p5dur(s.avgMs))}</div>
      <div class="cc-grid"><div class="ctrl-card"><div class="ctrl-title">حسب اليوم <small class="dr-hint">(نجح / فشل)</small></div>${bars}</div>
      <div class="ctrl-card"><div class="ctrl-title">أكثر أسباب الفشل</div>${s.topFailures.map(f => `<div class="cc-row"><span>${p5e(p5key(f.key))}</span><b>${num(f.count)}</b></div>`).join('') || '<div class="dr-hint">لا إخفاقات 🎉</div>'}</div></div>
      <h4 style="margin:1rem 0 .5rem">آخر العمليات</h4>${p5table(['الوقت', 'النتيجة', 'النوع', 'السيرفر', 'السبب', 'الزمن'], rows, 'لا عمليات /pull بعد.')}`;
  } catch (e) { p5err('fleet', e); }
}

/* ══ 2. Stations & reciters ══════════════════════════════════════════════ */
async function stGlobal() {
  try {
    const d = await apiFetch('/api/admin/stations');
    const rows = d.global.map(s => `<tr><td>${p5e(s.name)}</td><td dir="ltr" style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${p5e(s.url)}</td><td id="stLive-${p5e(s.id)}">—</td>
      <td>${p5btn('stCheck', 'فحص', { id: s.id })} ${p5btn('stRename', 'تسمية', { id: s.id, name: s.name })} ${p5btn('stDelete', 'حذف', { id: s.id, name: s.name }, 'btn-danger')}</td></tr>`);
    p5body('stations').innerHTML = `<div class="stats-row">${p5stat('محطات عامة', `${num(d.global.length)} / ${num(d.limit)}`)}${p5stat('محطات السيرفرات', num(d.guildTotal), `الحد ${num(d.guildLimit)} لكل سيرفر`)}</div>
      <div class="ctrl-card" style="margin-bottom:1rem"><div class="ctrl-title">إضافة محطة عامة</div>
        <div class="adv-row"><input class="field" id="stName" placeholder="الاسم" maxlength="120" style="flex:1;min-width:140px"><input class="field" id="stUrl" dir="ltr" placeholder="https://…" maxlength="600" style="flex:2;min-width:200px">
        ${p5btn('stAdd', 'إضافة', {}, 'btn-primary')}</div><div class="dr-hint">يُفحص الرابط قبل الحفظ (يجب أن يكون بثًا صوتيًا حيًا).</div></div>
      <div class="adv-row">${p5btn('stCheckAll', 'فحص كل المحطات', {}, 'btn-warning')}</div>
      ${p5table(['الاسم', 'الرابط', 'الحالة', ''], rows, 'لا محطات عامة.')}
      ${d.topGuilds.length ? `<div class="dr-hint">أكثر السيرفرات محطات: ${d.topGuilds.map(g => `${p5e(g.name ?? g.guildId)} (${num(g.count)})`).join(' · ')}</div>` : ''}`;
  } catch (e) { p5err('stations', e); }
}
async function stAdd() {
  try { await post('/api/admin/stations', { name: p5v('stName'), url: p5v('stUrl') }); toast('أُضيفت المحطة ✓', 'success'); stGlobal(); }
  catch (e) { toast(e.message, 'error'); }
}
function stRename(d) {
  const name = prompt('الاسم الجديد', d.name);          // eslint-disable-line no-alert
  if (name == null) return;
  post(`/api/admin/stations/${encodeURIComponent(d.id)}/rename`, { name }).then(() => { toast('تمت التسمية ✓', 'success'); stGlobal(); }).catch(e => toast(e.message, 'error'));
}
function stDelete(d) {
  confirmModal('🗑', `حذف «${d.name}»`, 'تُحذف المحطة من القائمة العامة لكل السيرفرات.', async () => {
    try { await post(`/api/admin/stations/${encodeURIComponent(d.id)}/delete`, {}); toast('حُذفت ✓', 'success'); stGlobal(); } catch (e) { toast(e.message, 'error'); }
  }, 'حذف');
}
function stShowLive(r) {
  const c = $(`stLive-${r.id}`); if (!c) return;
  c.innerHTML = r.live ? `${p5chip('يعمل', 'green')} <small class="dr-hint">${p5dur(r.ms)}</small>` : `${p5chip('لا يعمل', 'red')} <small class="dr-hint">${p5e(p5key(r.error))}</small>`;
}
async function stProbe(body) {
  try { const r = await post('/api/admin/stations/check', body); r.results.forEach(stShowLive); } catch (e) { toast(e.message, 'error'); }
}
const stCheck = (d) => { const c = $(`stLive-${d.id}`); if (c) c.innerHTML = '<span class="spinner"></span>'; return stProbe({ id: d.id }); };
function stCheckAll() { document.querySelectorAll('[id^="stLive-"]').forEach(c => { c.innerHTML = '<span class="spinner"></span>'; }); return stProbe({ all: true }); }

async function stGuild(d = {}) {
  const q = d.q ?? p5v('stGq'), page = Number(d.page) || 1;
  try {
    const r = await apiFetch(`/api/admin/stations/guild?${p5q({ q, page })}`);
    const rows = r.rows.map(s => `<tr><td>${p5e(s.name)}</td><td dir="ltr" style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${p5e(s.url)}</td><td>${p5e(s.guildName ?? s.guildId)}</td>
      <td>${p5btn('stGuildDelete', 'حذف', { id: s.id, name: s.name }, 'btn-danger')}</td></tr>`);
    p5body('stations').innerHTML = `<div class="adv-row"><input class="field p5-q" id="stGq" data-p5enter="stGuildSearch" placeholder="اسم محطة أو معرّف سيرفر" value="${p5e(q)}" style="flex:1">${p5btn('stGuildSearch', 'بحث', {}, 'btn-primary')}</div>
      <div class="dr-hint">محطات يضيفها مدراء السيرفرات. الحذف هنا للمخالفات (روابط مسيئة).</div>
      ${p5table(['الاسم', 'الرابط', 'السيرفر', ''], rows, 'لا نتائج.')}${p5pager('stGuildPage', r, { q })}`;
  } catch (e) { p5err('stations', e); }
}
const stGuildSearch = () => stGuild({ q: p5v('stGq'), page: 1 });
const stGuildPage = (d) => stGuild({ q: d.q, page: d.page });
function stGuildDelete(d) {
  confirmModal('🗑', `حذف «${d.name}»`, 'تُحذف المحطة من هذا السيرفر.', async () => {
    try { await post(`/api/admin/stations/guild/${encodeURIComponent(d.id)}/delete`, {}); toast('حُذفت ✓', 'success'); stGuild({ q: p5v('stGq') }); } catch (e) { toast(e.message, 'error'); }
  }, 'حذف');
}

async function stReciters(d = {}) {
  const q = d.q ?? p5v('rcQ'), hidden = d.hidden ?? (P5.stations.rcHidden ?? ''), page = Number(d.page) || 1;
  P5.stations.rcHidden = hidden;
  try {
    const r = await apiFetch(`/api/admin/reciters/catalog?${p5q({ q, hidden, page })}`);
    const rows = r.rows.map(x => `<tr><td>${p5e(x.arabicName ?? x.name)}<div class="dr-hint">${p5e(x.name)}</div></td><td><code>${p5e(x.id)}</code></td><td>${num(x.moshaf)}</td><td>${num(x.surahs)}</td>
      <td>${x.hidden ? p5chip('مخفي', 'orange') : p5chip('ظاهر', 'green')}${x.extra ? ' ' + p5chip('إضافي', 'purple') : ''}<span id="rcLive-${p5e(x.id)}"></span></td>
      <td>${p5btn('rcCheck', 'فحص', { id: x.id })} ${p5btn('rcHide', x.hidden ? 'إظهار' : 'إخفاء', { id: x.id, hide: x.hidden ? '0' : '1' }, x.hidden ? 'btn-primary' : 'btn-warning')}</td></tr>`);
    p5body('stations').innerHTML = `<div class="stats-row">${p5stat('كل القرّاء', num(r.all))}${p5stat('المخفيون', num(r.hiddenCount), 'لا يظهرون في القوائم، ويعمل المحفوظ منهم')}</div>
      <div class="adv-row"><input class="field p5-q" id="rcQ" data-p5enter="rcSearch" placeholder="ابحث باسم القارئ" value="${p5e(q)}" style="flex:1">
        <select class="field" id="rcHidden" data-p5change="rcSearch" style="width:auto"><option value="">الكل</option><option value="1"${hidden === '1' ? ' selected' : ''}>المخفيون فقط</option></select>
        ${p5btn('rcSearch', 'بحث', {}, 'btn-primary')}</div>
      ${p5table(['القارئ', 'المعرّف', 'المصاحف', 'السور', 'الحالة', ''], rows, 'لا نتائج.')}${p5pager('rcPage', r, { q, hidden })}`;
  } catch (e) { p5err('stations', e); }
}
const rcSearch = () => stReciters({ q: p5v('rcQ'), hidden: $('rcHidden')?.value ?? '', page: 1 });
const rcPage = (d) => stReciters({ q: d.q, hidden: d.hidden, page: d.page });
async function rcHide(d) {
  try { await post('/api/admin/reciters/hide', { id: d.id, hidden: d.hide === '1' }); toast(d.hide === '1' ? 'أُخفي القارئ ✓' : 'أُظهر القارئ ✓', 'success'); stReciters({ q: p5v('rcQ'), hidden: $('rcHidden')?.value ?? '' }); }
  catch (e) { toast(e.message, 'error'); }
}
async function rcCheck(d) {
  const c = $(`rcLive-${d.id}`); if (c) c.innerHTML = ' <span class="spinner"></span>';
  try {
    const r = await post('/api/admin/reciters/check', { id: d.id });
    if (c) c.innerHTML = r.live ? ` ${p5chip('الرابط يعمل', 'green')}` : ` ${p5chip('لا يعمل: ' + p5key(r.error), 'red')}`;
  } catch (e) { if (c) c.innerHTML = ''; toast(e.message, 'error'); }
}

/* ══ 3. Wird / adhkar / events ═══════════════════════════════════════════ */
const WIRD_LABEL = { active: ['نشط', 'green'], expiring: ['ينتهي قريبًا', 'gold'], expired: ['منتهٍ', 'red'], paused: ['موقوف', 'muted'], failing: ['فاشل', 'orange'] };
const EVENT_LABEL = { active: ['جارية', 'green'], upcoming: ['قادمة', 'blue'], finished: ['انتهت', 'muted'], disabled: ['معطّلة', 'orange'] };
const p5state = (map, k) => p5chip(map[k]?.[0] ?? k, map[k]?.[1] ?? 'muted');

async function ctWird(d = {}) {
  const q = d.q ?? p5v('wQ'), state = d.state ?? P5.content.wState ?? '', page = Number(d.page) || 1;
  P5.content.wState = state;
  try {
    const [s, u] = await Promise.all([apiFetch('/api/admin/content/wird'), apiFetch(`/api/admin/content/wird/users?${p5q({ q, state, page })}`)]);
    const rows = u.rows.map(x => `<tr><td><code>${p5e(x.userId)}</code></td><td>${p5state(WIRD_LABEL, x.state)}</td><td>${p5e(x.guildName ?? x.guildId ?? '—')}</td>
      <td>${num(x.currentPage)} · ${num(x.khatmaCount)} ختمة</td><td>${num(x.streak)} <small class="dr-hint">/ ${num(x.bestStreak)}</small></td><td>${x.expiresAt ? timeAgo(x.expiresAt) : '—'}</td>
      <td>${p5btn('wirdAct', 'تجديد', { uid: x.userId, action: 'renew' })} ${x.state === 'paused' || x.state === 'failing' ? p5btn('wirdAct', 'استئناف', { uid: x.userId, action: 'resume' }, 'btn-primary') : p5btn('wirdAct', 'إيقاف', { uid: x.userId, action: 'pause' })}
        ${x.failCount ? p5btn('wirdAct', `تصفير الإخفاق (${num(x.failCount)})`, { uid: x.userId, action: 'reset-fails' }) : ''} ${p5btn('wirdDelete', 'حذف', { uid: x.userId }, 'btn-danger')}</td></tr>`);
    p5body('content').innerHTML = `<div class="stats-row">
      ${p5stat('المشتركون', num(s.total))}${p5stat('نشط', num(s.states.active))}${p5stat('ينتهي خلال 7 أيام', num(s.states.expiring))}${p5stat('منتهٍ', num(s.states.expired))}
      ${p5stat('موقوف', num(s.states.paused))}${p5stat('فاشل', num(s.states.failing), 'تعذّر الإرسال مرارًا')}${p5stat('ختمات', num(s.khatmas))}${p5stat('صفحات مقروءة', num(s.pagesRead))}
      ${p5stat('متوسط السلسلة', num(s.avgStreak))}${p5stat('أذكار شخصية', num(s.personalAdhkar.morning + s.personalAdhkar.evening), `${num(s.personalAdhkar.morning)} صباح · ${num(s.personalAdhkar.evening)} مساء`)}</div>
      ${s.top.length ? `<div class="dr-hint">أطول السلاسل: ${s.top.slice(0, 5).map(t => `<code>${p5e(t.userId)}</code> (${num(t.streak)})`).join(' · ')}</div>` : ''}
      <div class="adv-row"><input class="field p5-q" id="wQ" data-p5enter="wirdSearch" placeholder="معرّف عضو أو سيرفر (أرقام)" value="${p5e(q)}" style="flex:1">
        <select class="field" id="wState" data-p5change="wirdSearch" style="width:auto"><option value="">كل الحالات</option>${Object.entries(WIRD_LABEL).map(([k, [l]]) => `<option value="${k}"${state === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${p5btn('wirdSearch', 'بحث', {}, 'btn-primary')}</div>
      ${p5table(['العضو', 'الحالة', 'السيرفر', 'الصفحة', 'السلسلة', 'الانتهاء', ''], rows, 'لا نتائج.')}${p5pager('wirdPage', u, { q, state })}`;
  } catch (e) { p5err('content', e); }
}
const wirdSearch = () => ctWird({ q: p5v('wQ'), state: $('wState')?.value ?? '', page: 1 });
const wirdPage = (d) => ctWird({ q: d.q, state: d.state, page: d.page });
async function wirdAct(d) {
  try { await post(`/api/admin/content/wird/users/${encodeURIComponent(d.uid)}/${encodeURIComponent(d.action)}`, {}); toast('تم ✓', 'success'); ctWird({ q: p5v('wQ'), state: $('wState')?.value ?? '' }); }
  catch (e) { toast(e.message, 'error'); }
}
function wirdDelete(d) {
  confirmModal('🗑', 'حذف اشتراك الورد', `سيُحذف تقدّم العضو ${d.uid} نهائيًا (الصفحة والسلسلة والختمات).`, async () => {
    try { await post(`/api/admin/content/wird/users/${encodeURIComponent(d.uid)}/delete`, { confirm: 'DELETE' }); toast('حُذف ✓', 'success'); ctWird({ q: p5v('wQ'), state: $('wState')?.value ?? '' }); }
    catch (e) { toast(e.message, 'error'); }
  }, 'حذف', 'DELETE');
}

async function ctSchedules() {
  try {
    const d = await apiFetch('/api/admin/content/schedules');
    const names = { adhkar: 'الأذكار', ayah: 'آية اليوم', hadith: 'الحديث', wird: 'الورد' };
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    p5body('content').innerHTML = `<div class="stats-row">${p5stat('سيرفرات لها إعدادات', num(d.guildsWithSettings), `من ${num(d.guildsTotal)}`)}
      ${p5stat('فعاليات جارية', num(d.events.active))}${p5stat('قادمة', num(d.events.upcoming))}${p5stat('منتهية', num(d.events.finished))}${p5stat('معطّلة', num(d.events.disabled))}</div>
      <div class="cc-grid">${d.kinds.map(k => `<div class="ctrl-card"><div class="ctrl-title">${p5e(names[k.key] ?? k.key)} ${k.globallyOff ? p5chip('موقوف عالميًا', 'orange') : ''}</div>
        <div class="info-row"><span class="info-label">مفعّل</span><span class="info-val">${num(k.enabled)} <small class="dr-hint">(${num(pct(k.enabled, d.guildsWithSettings))}%)</small></span></div>
        <div class="info-row"><span class="info-label">جاهز للنشر (له قناة)</span><span class="info-val">${num(k.ready)}</span></div>
        ${k.enabled > k.ready ? `<div class="dr-hint">⚠ ${num(k.enabled - k.ready)} سيرفر مفعّل بلا قناة — لن يُنشر فيه شيء.</div>` : ''}</div>`).join('')}</div>
      <div class="dr-hint">إيقاف نوع كامل يتم من «مركز التحكم ← الميزات».</div>`;
  } catch (e) { p5err('content', e); }
}

async function ctEvents(d = {}) {
  const q = d.q ?? p5v('eQ'), state = d.state ?? P5.content.eState ?? '', page = Number(d.page) || 1;
  P5.content.eState = state;
  try {
    const r = await apiFetch(`/api/admin/content/events?${p5q({ q, state, page })}`);
    const rows = r.rows.map(x => `<tr><td>${p5e(x.title)}</td><td>${p5e(x.guildName ?? x.guildId)}</td><td>${p5state(EVENT_LABEL, x.status)}</td><td dir="ltr">${p5e(x.startDate)} → ${p5e(x.endDate)}</td><td dir="ltr">${p5e(x.time ?? '')}</td>
      <td>${p5btn('evToggle', x.enabled ? 'تعطيل' : 'تفعيل', { id: x.id, on: x.enabled ? '0' : '1' }, x.enabled ? 'btn-warning' : 'btn-primary')} ${p5btn('evTest', 'اختبار', { id: x.id })} ${p5btn('evDelete', 'حذف', { id: x.id, title: x.title }, 'btn-danger')}</td></tr>`);
    p5body('content').innerHTML = `<div class="adv-row"><input class="field p5-q" id="eQ" data-p5enter="evSearch" placeholder="عنوان أو معرّف سيرفر" value="${p5e(q)}" style="flex:1">
      <select class="field" id="eState" data-p5change="evSearch" style="width:auto"><option value="">كل الحالات</option>${Object.entries(EVENT_LABEL).map(([k, [l]]) => `<option value="${k}"${state === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${p5btn('evSearch', 'بحث', {}, 'btn-primary')}</div>
      ${p5table(['العنوان', 'السيرفر', 'الحالة', 'المدة', 'الوقت', ''], rows, 'لا فعاليات.')}${p5pager('evPage', r, { q, state })}`;
  } catch (e) { p5err('content', e); }
}
const evSearch = () => ctEvents({ q: p5v('eQ'), state: $('eState')?.value ?? '', page: 1 });
const evPage = (d) => ctEvents({ q: d.q, state: d.state, page: d.page });
const evRefresh = () => ctEvents({ q: p5v('eQ'), state: $('eState')?.value ?? '' });
async function evToggle(d) {
  try { await post(`/api/admin/content/events/${encodeURIComponent(d.id)}/toggle`, { enabled: d.on === '1' }); toast('تم ✓', 'success'); evRefresh(); } catch (e) { toast(e.message, 'error'); }
}
async function evTest(d) {
  try { await post(`/api/admin/content/events/${encodeURIComponent(d.id)}/test`, {}); toast('أُرسلت رسالة اختبار ✓', 'success'); }
  catch (e) { toast(`تعذّر الإرسال: ${p5key(e.message)}`, 'error'); }
}
function evDelete(d) {
  confirmModal('🗑', `حذف «${d.title}»`, 'تُحذف الفعالية نهائيًا.', async () => {
    try { await post(`/api/admin/content/events/${encodeURIComponent(d.id)}/delete`, { confirm: 'DELETE' }); toast('حُذفت ✓', 'success'); evRefresh(); } catch (e) { toast(e.message, 'error'); }
  }, 'حذف', 'DELETE');
}

/* ══ 4. Security ═════════════════════════════════════════════════════════ */
const LEVEL = { ok: ['سليم', 'green', '✓'], warn: ['تنبيه', 'gold', '!'], critical: ['حرج', 'red', '✕'] };
async function secOverview() {
  try {
    const d = await apiFetch('/api/admin/security/overview');
    const who = (x) => `<div class="cc-row"><span>${p5e(x.username ?? '—')}</span><code>${p5e(x.id)}</code></div>`;
    const act = await apiFetch('/api/admin/security/actions').catch(() => ({ rows: [] }));
    p5body('security').innerHTML = `<div class="stats-row">${p5stat('جلسات اللوحة', num(d.sessions.total), `${num(d.sessions.mods)} مشرف · ${num(d.sessions.dead)} ميتة`)}
      ${p5stat('دخول ناجح (7 أيام)', num(d.logins7d.ok))}${p5stat('محاولات مرفوضة', num(d.logins7d.refused))}${p5stat('مدة الجلسة', `${num(d.lifetime.sessionDays)} يوم`, `حد مطلق ${num(d.lifetime.absoluteDays)}`)}</div>
      <div class="ctrl-card" style="margin-bottom:1rem"><div class="ctrl-title">فحص الأمان</div>
        ${d.checklist.map(c => { const l = LEVEL[c.level] ?? LEVEL.warn; return `<div class="cc-row"><span>${l[2]} ${p5e(c.title)}<span class="cc-desc">${p5e(c.detail)}</span></span>${p5chip(l[0], l[1])}</div>`; }).join('')}</div>
      <div class="cc-grid"><div class="ctrl-card"><div class="ctrl-title">الملّاك (ADMIN_IDS)</div>${d.owners.map(who).join('') || '<div class="dr-hint">—</div>'}</div>
        <div class="ctrl-card"><div class="ctrl-title">المشرفون (MOD_IDS)</div>${d.mods.map(who).join('') || '<div class="dr-hint">لا يوجد.</div>'}
        <div class="dr-hint">${d.modCaps.map(c => `${c.on ? '✓' : '✕'} ${p5e(c.label)}`).join(' · ')}</div></div>
        <div class="ctrl-card"><div class="ctrl-title">أكثر الحسابات نشاطًا (7 أيام)</div>${act.rows.map(a => `<div class="cc-row"><span><code>${p5e(a.actor)}</code></span><b>${num(a.count)}</b><small class="dr-hint">${timeAgo(a.last)}</small></div>`).join('') || '<div class="dr-hint">لا نشاط.</div>'}</div></div>`;
  } catch (e) { p5err('security', e); }
}
async function secSessions() {
  try {
    const d = await apiFetch('/api/admin/security/sessions');
    const rows = d.rows.map(s => `<tr><td>${p5e(s.username)} <code>${p5e(s.userId)}</code> ${s.current ? p5chip('جلستك', 'blue') : ''}</td>
      <td>${s.role === 'owner' ? p5chip('مالك', 'teal') : s.role === 'mod' ? p5chip('مشرف', 'purple') : p5chip('لا صلاحية', 'red')}</td>
      <td>${s.signedInAt ? timeAgo(s.signedInAt) : '—'}</td><td dir="ltr">${p5e(s.ip ?? '—')}</td><td dir="ltr" style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${p5e(s.ua ?? '')}">${p5e(s.ua ?? '—')}</td>
      <td>${s.current ? '' : p5btn('secRevoke', 'إنهاء', { ref: s.ref, name: s.username }, 'btn-danger')}</td></tr>`);
    p5body('security').innerHTML = `<div class="adv-row">${p5btn('secRevokeMods', 'إنهاء جلسات المشرفين', {}, 'btn-warning')}${p5btn('secRevokeAll', 'إنهاء كل الجلسات الأخرى', {}, 'btn-danger')}${p5btn('p5Reload', 'تحديث', { page: 'security' })}</div>
      <div class="dr-hint">IP والمتصفح يظهران للجلسات المنشأة بعد هذا التحديث فقط. الجلسة «بلا صلاحية» لا تعمل أصلًا (الحساب أُزيل من القائمة) ويمكن إنهاؤها للتنظيف.</div>
      ${p5table(['الحساب', 'الدور', 'الدخول', 'IP', 'المتصفح', ''], rows, 'لا جلسات.')}`;
  } catch (e) { p5err('security', e); }
}
function secRevoke(d) {
  confirmModal('🔒', `إنهاء جلسة ${d.name}`, 'يُخرَج صاحبها فورًا ويحتاج تسجيل دخول جديد.', async () => {
    try { await post('/api/admin/security/sessions/revoke', { ref: d.ref }); toast('أُنهيت ✓', 'success'); secSessions(); } catch (e) { toast(e.message, 'error'); }
  }, 'إنهاء');
}
const secRevokeBulk = (onlyMods) => confirmModal('🔒', onlyMods ? 'إنهاء جلسات المشرفين' : 'إنهاء كل الجلسات الأخرى', 'جلستك الحالية لا تتأثر.', async () => {
  try { const r = await post('/api/admin/security/sessions/revoke-all', { confirm: 'REVOKE', onlyMods }); toast(`أُنهيت ${num(r.revoked)} جلسة ✓`, 'success'); secSessions(); } catch (e) { toast(e.message, 'error'); }
}, 'إنهاء', 'REVOKE');
const secRevokeMods = () => secRevokeBulk(true), secRevokeAll = () => secRevokeBulk(false);

async function secLogins(d = {}) {
  const page = Number(d.page) || 1;
  try {
    const r = await apiFetch(`/api/admin/security/logins?${p5q({ page })}`);
    const rows = r.rows.map(x => `<tr><td>${timeAgo(x.ts)}</td><td>${x.ok ? p5chip('ناجح', 'green') : p5chip('مرفوض', 'red')}</td><td>${p5e(x.action)}</td><td>${p5e(x.meta ?? '')}</td></tr>`);
    p5body('security').innerHTML = p5table(['الوقت', 'النتيجة', 'الحدث', 'التفاصيل'], rows, 'لا سجل دخول.') + p5pager('secLoginPage', r);
  } catch (e) { p5err('security', e); }
}
const secLoginPage = (d) => secLogins({ page: d.page });
const EXPORT_NAMES = { settings: 'إعدادات السيرفرات', stations: 'محطات الراديو المخصصة', blacklist: 'القائمة السوداء', control: 'إعدادات التحكم العامة', notes: 'ملاحظات الأونر والوسوم', events: 'الفعاليات الدينية', broadcasts: 'سجل الإعلانات' };
function secExport() {
  p5body('security').innerHTML = `<div class="dr-hint" style="margin-bottom:1rem">نسخ JSON للقراءة والأرشفة. لا تتضمن بيانات الأعضاء الشخصية (الورد، المفضلة)، ولا يوجد استيراد من اللوحة عمدًا. كل تنزيل يُسجَّل في سجل النشاط.</div>
    <div class="cc-grid">${Object.entries(EXPORT_NAMES).map(([k, label]) => `<div class="ctrl-card"><div class="ctrl-title">${p5e(label)}</div>
      <a class="btn btn-ghost btn-sm" href="${API}/api/admin/security/export?set=${encodeURIComponent(k)}" download>تنزيل JSON</a></div>`).join('')}</div>`;
}

const P5_LOADERS = {
  'fleet:bots': fleetBots, 'fleet:jobs': fleetJobs, 'fleet:pulls': fleetPulls,
  'stations:global': stGlobal, 'stations:guild': stGuild, 'stations:reciters': stReciters,
  'content:wird': ctWird, 'content:schedules': ctSchedules, 'content:events': ctEvents,
  'security:overview': secOverview, 'security:sessions': secSessions, 'security:logins': secLogins, 'security:export': secExport
};

Object.assign(OWNER_FN, {
  p5Tab, p5Reload, secondBotStop, secondBotStart, fleetForget, fleetJobs, fleetCancelJob, fleetCancelStuck,
  stAdd, stRename, stDelete, stCheck, stCheckAll, stGuildSearch, stGuildPage, stGuildDelete, rcSearch, rcPage, rcHide, rcCheck,
  wirdSearch, wirdPage, wirdAct, wirdDelete, evSearch, evPage, evToggle, evTest, evDelete,
  secRevoke, secRevokeMods, secRevokeAll, secLoginPage
});

const _showPageP5 = showPage;
showPage = function (id, el) {
  const r = _showPageP5(id, el);
  if (P5[id]) p5Load(id);
  return r;
};

// Enter in a search box = press its button; changing a filter select re-runs it. The <a download> export links are plain navigation.
document.addEventListener('keydown', (e) => {
  const fn = e.key === 'Enter' ? e.target?.dataset?.p5enter : null;
  if (fn && Object.hasOwn(OWNER_FN, fn)) { e.preventDefault(); OWNER_FN[fn]({}); }
});
document.addEventListener('change', (e) => {
  const fn = e.target?.dataset?.p5change;
  if (!fn || !Object.hasOwn(OWNER_FN, fn)) return;
  OWNER_FN[fn](fn === 'fleetJobs' ? { status: e.target.value } : {});
});
