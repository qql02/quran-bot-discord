// Subscribe, edit settings, status card, stop, renew and delete.
import { WirdSubscription } from '../../models/WirdSubscription.js';
import { parseTime, resolveTimeZone, suggestTimeZones } from '../../utils/adhkarSchedule.js';
import { TOTAL_PAGES, DEFAULT_PAGES, nextExpiry, subscriptionState } from '../../utils/wird.js';
import {
  subscribeModal, statusMessage, savedMessage, renewRow, deleteRow, deleteConfirmMessage, deletedMessage, wirdText, subLang
} from '../ui/index.js';
import { renewSubscription } from '../../services/wirdService.js';
import { fail, respond, notSubscribed, wirdLang, activeSub } from './shared.js';

/** "0".."603" → number, else null. */
function parseDonePage(input) {
  const ascii = String(input ?? '').trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!/^\d{1,3}$/.test(ascii)) return null;
  const n = Number(ascii);
  return n >= 0 && n < TOTAL_PAGES ? n : null;
}

/** Open the subscribe modal, or (returning / expired member) reactivate and show their card. */
export async function startSubscription(interaction) {
  const sub = await WirdSubscription.findOne({ userId: interaction.user.id }).lean();
  if (!sub) return interaction.showModal(subscribeModal(null, await wirdLang(interaction, null)));

  const lapsed = !sub.active || subscriptionState(sub.expiresAt) === 'expired';
  if (lapsed) {
    const renewed = await renewSubscription(interaction.user.id, interaction.guildId);
    return respond(interaction, savedMessage(renewed, new Date(), 'welcomeBack'));
  }
  return respond(interaction, statusMessage(sub));
}

export async function showStatus(interaction) {
  const sub = await WirdSubscription.findOne({ userId: interaction.user.id }).lean();
  if (!sub) return notSubscribed(interaction);
  return respond(interaction, statusMessage(sub));
}



export async function stopSubscription(interaction) {
  const sub = await WirdSubscription.findOneAndUpdate(
    { userId: interaction.user.id, active: true }, { $set: { active: false } }, { new: true }
  ).lean();
  if (!sub) { const l = await wirdLang(interaction, null); return fail(interaction, wirdText(l).stopAlready, l); }
  const lang = subLang(sub);
  const card = statusMessage(sub, new Date(), wirdText(lang).stopped);
  return respond(interaction, { embeds: card.embeds, components: [renewRow(lang, 'resume'), deleteRow(lang)] });
}

export async function askDelete(interaction) {
  const sub = await WirdSubscription.findOne({ userId: interaction.user.id }, { _id: 1, lang: 1 }).lean();
  if (!sub) return notSubscribed(interaction);
  return respond(interaction, deleteConfirmMessage(subLang(sub)));
}

export async function confirmDelete(interaction) {
  const sub = await WirdSubscription.findOneAndDelete({ userId: interaction.user.id }, { projection: { lang: 1 } }).lean();
  return respond(interaction, deletedMessage(await wirdLang(interaction, sub)));
}

export async function onSubscribeModal(interaction) {
  const f = interaction.fields;
  const rawTime = f.getTextInputValue('time').trim();
  const varied  = !rawTime;                       // blank = a different time every day
  const time    = varied ? null : parseTime(rawTime);
  const tz    = resolveTimeZone(f.getTextInputValue('tz'));
  const page  = parseDonePage(f.getTextInputValue('page'));
  const userId = interaction.user.id;
  const existing = await WirdSubscription.findOne({ userId }).lean();
  const formLang = await wirdLang(interaction, existing);          // the language the member just read the form in
  const t = wirdText(formLang);
  const errs = [];
  if (!varied && !time) errs.push(t.errTime);
  if (!tz) {
    const typed = f.getTextInputValue('tz').replace(/[`*_~|>\\\n]/g, '').slice(0, 40);
    errs.push(t.errZone(typed, suggestTimeZones(typed, formLang)));
  }
  if (page === null) errs.push(t.errPage(TOTAL_PAGES - 1));
  if (errs.length) return fail(interaction, errs.join('\n'), formLang);

  const now = new Date();
  // A new member takes the wird language of the server; someone who already has a record keeps their own, so the
  // form they just read and the card they get back are never in two different languages.
  const lang = !existing && interaction.guildId ? await wirdLang(interaction, null) : null;
  const plan = { remindMode: varied ? 'varied' : 'fixed', ...(varied ? {} : { remindTime: time }), timezone: tz, currentPage: page, ...(lang ? { lang } : {}) };     // the pace is chosen from the plan menus

  let sub;
  if (existing) {
    // Editing: keep streaks/khatmas. Changing the reminder time re-arms today's reminder if it has not passed yet.
    const lapsed = !existing.active || subscriptionState(existing.expiresAt, now) === 'expired';
    sub = await WirdSubscription.findOneAndUpdate({ userId }, {
      $set: {
        ...plan,
        ...(interaction.guildId ? { guildId: interaction.guildId } : {}),
        ...(lapsed ? { active: true, expiresAt: nextExpiry(now), renewWarned: false, expiredNoticed: false, failCount: 0 } : {}),
        ...((varied ? existing.remindMode !== 'varied' : (existing.remindMode === 'varied' || time !== existing.remindTime)) ? { lastRemindedDate: null } : {})
      }
    }, { new: true }).lean();
    return respond(interaction, savedMessage(sub, now, 'settingsSaved'));
  }

  try {
    sub = (await WirdSubscription.create({
      userId, guildId: interaction.guildId ?? null, ...plan, pagesPerDay: DEFAULT_PAGES,
      expiresAt: nextExpiry(now), startedAt: now, khatmaStartedAt: now
    })).toObject();
  } catch (err) {
    if (err?.code !== 11000) throw err;                 // double-submit: the first one already created it
    sub = await WirdSubscription.findOne({ userId }).lean();
  }
  return respond(interaction, savedMessage(sub, now));
}

/** Renew (or re-activate) and show the saved card. */
export async function renew(interaction) {
  const sub = await renewSubscription(interaction.user.id, interaction.guildId);
  return sub ? respond(interaction, savedMessage(sub, new Date(), 'renewed')) : notSubscribed(interaction);
}

/** Switch the member's personal morning / evening adhkar (DMs) on or off, then redraw their card. */
export async function toggleAdhkar(interaction, slot) {
  const field = slot === 'morning' ? 'adhkarMorning' : 'adhkarEvening';
  const last  = slot === 'morning' ? 'lastAdhkarMorning' : 'lastAdhkarEvening';
  const sub = await activeSub(interaction);
  if (!sub) return;
  const on = !sub[field];
  // Switching on: today's set is only sent if its time has NOT passed yet by more than the catch-up window (see dueSlots);
  // switching off clears nothing else. The date guard makes a double tap harmless.
  const updated = await WirdSubscription.findOneAndUpdate(
    { userId: interaction.user.id, [field]: Boolean(sub[field]) },
    { $set: { [field]: on, ...(on ? { [last]: null } : {}) } },
    { new: true }
  ).lean();
  const fresh = updated ?? await WirdSubscription.findOne({ userId: interaction.user.id }).lean();
  const t = wirdText(subLang(fresh));
  return respond(interaction, statusMessage(fresh, new Date(), (fresh[field] ? t.adhkarOn : t.adhkarOffMsg)(slot)));
}

/** Open the settings modal (reminder time, timezone, current page). */
export async function editSettings(interaction) {
  const sub = await WirdSubscription.findOne({ userId: interaction.user.id }).lean();
  return sub ? interaction.showModal(subscribeModal(sub)) : notSubscribed(interaction);
}
