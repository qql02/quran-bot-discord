/* Owner panel — control centre + remote queue (loaded after owner.js; reuses apiFetch, post, toast, confirmModal, escHtml, $, num).
   No inline handlers (CSP): buttons carry data-act="own" data-fn="<name>" and are dispatched through OWNER_FN. */

/* ══ Remote queue (inside the server drawer → Voice tab) ═════════════════ */
let qState = null;                                   // { id, data } of the queue currently shown

async function drvQueueLoad(id) {
  const box = $('drvQueue'); if (!box) return;
  try {
    const q = await apiFetch(`/api/admin/guilds/${encodeURIComponent(id)}/queue`);
    if (drawerId !== id || !$('drvQueue')) return;     // another server was opened meanwhile
    qState = { id, data: q };
    qRender();
  } catch (e) {
    if (drawerId === id && $('drvQueue')) $('drvQueue').innerHTML = `<h4>الطابور</h4><div class="dr-hint">${escHtml(e.message)}</div>`;
  }
}

function qRender() {
  const box = $('drvQueue'); if (!box || !qState) return;
  const { id, data: q } = qState, eid = escHtml(id), n = q.queue.length;
  const rows = q.queue.map((it, i) => `
    <div class="q-row">
      <span class="q-n">${num(i + 1)}</span>
      <span class="q-t">${escHtml(it.surah)} <small>${escHtml(it.reciter)}</small></span>
      <button class="btn btn-ghost btn-sm" data-act="own" data-fn="qMove" data-id="${eid}" data-from="${i}" data-to="${i - 1}" ${i === 0 ? 'disabled' : ''} aria-label="رفع">↑</button>
      <button class="btn btn-ghost btn-sm" data-act="own" data-fn="qMove" data-id="${eid}" data-from="${i}" data-to="${i + 1}" ${i === n - 1 ? 'disabled' : ''} aria-label="خفض">↓</button>
      <button class="btn btn-danger btn-sm" data-act="own" data-fn="qRemove" data-id="${eid}" data-index="${i}" aria-label="حذف">✕</button>
    </div>`).join('');
  box.innerHTML = `<h4>الطابور <span class="chip chip-muted">${num(q.total)} / ${num(q.cap)}</span></h4>
    <div class="dr-hint">${q.now ? `الآن: <b>${escHtml(q.now.surah)}</b>` : 'لا شيء يُشغَّل الآن'}${q.fullQuran ? ' · وضع القرآن كاملاً' : ''}${q.radio ? ' · بث مباشر' : ''}</div>
    ${rows || '<div class="dr-hint">الطابور فارغ.</div>'}
    ${q.total > n ? `<div class="dr-hint">يُعرض أول ${num(n)} فقط.</div>` : ''}
    <div class="adv-row">
      <button class="btn btn-ghost btn-sm" data-act="own" data-fn="qShuffle" data-id="${eid}" ${n < 2 ? 'disabled' : ''}>خلط</button>
      <button class="btn btn-danger btn-sm" data-act="own" data-fn="qClear" data-id="${eid}" ${n ? '' : 'disabled'}>مسح الطابور</button>
      <button class="btn btn-ghost btn-sm" data-act="own" data-fn="qReload" data-id="${eid}">تحديث</button>
    </div>`;
}

async function qCall(id, path, body, okMsg) {
  try {
    const r = await post(`/api/admin/guilds/${encodeURIComponent(id)}/queue/${path}`, body ?? {});
    if (drawerId === id) { qState = { id, data: r }; qRender(); }
    if (okMsg) toast(okMsg, 'success');
  } catch (e) { toast(e.message, 'error'); if (drawerId === id) drvQueueLoad(id); }
}
const qMove    = d => qCall(d.id, 'move', { from: Number(d.from), to: Number(d.to) });
const qRemove  = d => qCall(d.id, 'remove', { index: Number(d.index) }, 'حُذفت من الطابور ✓');
const qShuffle = d => qCall(d.id, 'shuffle', {}, 'خُلط الطابور ✓');
const qReload  = d => drvQueueLoad(d.id);
function qClear(d) {
  confirmModal('', 'مسح الطابور', 'سيُحذف كل ما في الطابور، ويتوقف وضع «القرآن كاملاً» والتكرار حتى لا يمتلئ من جديد. السورة الحالية تكمل.', () => qCall(d.id, 'clear', {}, 'مُسح الطابور ✓'), 'مسح');
}

/* ══ Control centre page ═════════════════════════════════════════════════ */
let ccData = null;

async function ccLoad() {
  try { ccData = await apiFetch('/api/admin/control'); ccRender(); }
  catch (e) { $('ccBody').innerHTML = `<div class="empty">${escHtml(e.message)}</div>`; }
}

function ccRender() {
  const { control: c, commands, features, modCaps, mods, maxQueueGlobal } = ccData;
  const off = new Set(c.disabledFeatures), offCmd = new Set(c.disabledCommands);
  const until = c.lockedUntil && c.lockedNow ? ` · يُفتح بعد ${fmtRemain(c.lockedUntil - Date.now())}` : '';
  $('ccBody').innerHTML = `<div class="cc-grid">
    <div class="ctrl-card ${c.lockedNow ? 'danger-zone' : ''}">
      <div class="ctrl-title">قفل عام لكل السيرفرات</div>
      <div class="ctrl-desc">وضع القراءة فقط في كل مكان: لا أوامر ولا أزرار، وتبقى الأذكار المجدولة والمصحف والورد و /help /invite /donation. الفرق عن «الصيانة»: الصيانة توقف كل شيء.</div>
      <div class="cc-lockstate">${c.lockedNow ? `<span class="chip chip-orange">مقفل</span> <span class="dr-hint">${c.lockedUntil ? escHtml(until.slice(3)) : 'حتى تفتحه يدويًا'}</span>` : '<span class="chip chip-green">مفتوح</span>'}</div>
      <div class="adv-row">${c.lockedNow
        ? '<button class="btn btn-primary btn-sm" data-act="own" data-fn="ccUnlock">فتح الآن</button>'
        : '<button class="btn btn-warning btn-sm" data-act="own" data-fn="ccLockAsk">قفل…</button>'}</div>
    </div>

    <div class="ctrl-card">
      <div class="ctrl-title">الميزات</div>
      <div class="ctrl-desc">إيقاف ميزة كاملة في كل السيرفرات (الأوامر والأزرار والنشر المجدول). أنت مستثنى دائمًا.</div>
      ${features.map(f => `<div class="cc-row"><span>${escHtml(f.label)}<span class="cc-desc">${escHtml(f.desc)}</span></span>
        <div class="toggle ${off.has(f.key) ? '' : 'on'}" role="switch" aria-checked="${!off.has(f.key)}" tabindex="0" data-act="own" data-fn="ccFeature" data-key="${escHtml(f.key)}" title="${off.has(f.key) ? 'متوقفة' : 'تعمل'}"></div></div>`).join('')}
    </div>

    <div class="ctrl-card">
      <div class="ctrl-title">أوامر معطّلة عالميًا</div>
      <div class="ctrl-desc">اضغط على الأمر لتعطيله/تفعيله ثم احفظ. الأحمر = معطّل.</div>
      <div class="perm-row" id="ccCmds">${commands.map(n => `<span class="chip chip-muted cmd-chip${offCmd.has(n) ? ' on' : ''}" data-act="own" data-fn="advToggleCmd" data-cmd="${escHtml(n)}">/${escHtml(n)}</span>`).join('')}</div>
      <label for="ccNote">ملاحظة تظهر لمن يحاول (اختياري)</label>
      <input class="field" id="ccNote" maxlength="200" value="${escHtml(c.note)}">
      <div class="adv-row" style="margin-top:0.6rem"><button class="btn btn-danger btn-sm" data-act="own" data-fn="ccSaveCommands">حفظ الأوامر والملاحظة</button></div>
    </div>

    <div class="ctrl-card">
      <div class="ctrl-title">حد الطابور العام</div>
      <div class="ctrl-desc">يسري على كل السيرفرات (والسيرفر يستطيع أن يكون أقصر فقط). الحد الأقصى الحالي ${num(maxQueueGlobal)}.</div>
      <input class="field" id="ccMaxQueue" type="number" min="1" max="${maxQueueGlobal}" placeholder="الافتراضي ${num(maxQueueGlobal)}" value="${c.maxQueue ?? ''}" aria-label="حد الطابور">
      <div class="adv-row"><button class="btn btn-primary btn-sm" data-act="own" data-fn="ccSaveQueue">حفظ</button></div>
    </div>

    <div class="ctrl-card">
      <div class="ctrl-title">صلاحيات المشرفين</div>
      <div class="ctrl-desc">ما يستطيع المشرفون (MOD_IDS) فعله. يسري فورًا حتى على من سجّل دخوله. المشرف يرى اللوحة دائمًا. ${mods.length ? `عدد المشرفين الحاليين: <b>${num(mods.length)}</b> — تُضاف الحسابات وتُحذف من ملف .env.` : 'لا يوجد مشرفون في MOD_IDS حاليًا.'}</div>
      ${modCaps.map(m => `<div class="cc-row"><span>${escHtml(m.label)}</span>
        <div class="toggle ${c.modCaps[m.key] ? 'on' : ''}" role="switch" aria-checked="${!!c.modCaps[m.key]}" tabindex="0" data-act="own" data-fn="ccCap" data-key="${escHtml(m.key)}"></div></div>`).join('')}
    </div>
  </div>`;
}

async function ccSave(body, msg) {
  try { const r = await post('/api/admin/control', body); ccData.control = r.control; ccRender(); toast(msg ?? 'تم الحفظ ✓', 'success'); }
  catch (e) { toast(e.message, 'error'); ccLoad(); }
}
const ccFeature = (d) => {
  const off = new Set(ccData.control.disabledFeatures);
  off.has(d.key) ? off.delete(d.key) : off.add(d.key);
  ccSave({ disabledFeatures: [...off] }, off.has(d.key) ? 'أُوقفت الميزة ✓' : 'عادت الميزة ✓');
};
const ccCap = (d) => ccSave({ modCaps: { [d.key]: !ccData.control.modCaps[d.key] } });
const ccSaveCommands = () => ccSave({ disabledCommands: [...document.querySelectorAll('#ccCmds .cmd-chip.on')].map(c => c.dataset.cmd), note: $('ccNote').value.trim() });
function ccSaveQueue() {
  const v = $('ccMaxQueue').value.trim();
  ccSave({ maxQueue: v ? Number(v) : null });
}
function ccLockAsk() {
  pickOpen('🔒', 'قفل كل السيرفرات', 'اختر المدة. يُفتح تلقائيًا بعدها دون أن تفعل شيئًا.',
    [['', 'حتى أفتحه يدويًا'], ['15', '15 دقيقة'], ['60', 'ساعة'], ['360', '6 ساعات'], ['1440', 'يوم']],
    (v) => confirmModal('🔒', 'تأكيد القفل العام', 'سيتوقف استخدام أوامر البوت وأزراره في كل السيرفرات.', () => ccSave({ locked: true, minutes: v ? Number(v) : null }, 'قُفلت كل السيرفرات ✓'), 'قفل'), 'متابعة');
}
const ccUnlock = () => ccSave({ locked: false }, 'فُتحت كل السيرفرات ✓');

Object.assign(OWNER_FN, { qMove, qRemove, qShuffle, qClear, qReload, ccLoad, ccFeature, ccCap, ccSaveCommands, ccSaveQueue, ccLockAsk, ccUnlock });

const _showPageCc = showPage;
showPage = function (id, el) {
  const r = _showPageCc(id, el);
  if (id === 'cc') ccLoad();
  return r;
};

// Switches are keyboard-reachable: Enter / Space act like a click.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target?.matches?.('.toggle[data-act="own"]')) { e.preventDefault(); e.target.click(); }
});
