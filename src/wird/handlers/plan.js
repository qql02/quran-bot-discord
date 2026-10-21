// The reading plan: khatma period, pages per day, and recalculation.
import { WirdSubscription } from '../../models/WirdSubscription.js';
import {
  parsePages, MAX_PAGES_PER_DAY, GOAL_OPTIONS, PAGE_PRESETS, pagesForGoal, goalDeadlineFrom, goalStatus, parseGoalDays, daysAtPace
} from '../../utils/wird.js';
import {
  statusMessage, MENU_DURATION, MENU_PAGES, goalModal, pagesModal, todayFor, durationLabel, pagesLabel, wirdText, subLang
} from '../ui/index.js';
import { fail, respond, notSubscribed, activeSub, wirdLang } from './shared.js';

/** Khatma in `days` days: the daily pace is derived from the pages that are left. */
export async function applyGoal(interaction, days) {
  const sub = await activeSub(interaction, 'expiredGoal');
  if (!sub) return;
  const lang = subLang(sub), t = wirdText(lang);
  const now = new Date();
  const pagesPerDay = pagesForGoal(sub.currentPage ?? 0, days);
  const updated = await WirdSubscription.findOneAndUpdate(
    { userId: sub.userId },
    { $set: { goalDays: days, goalDeadline: goalDeadlineFrom(todayFor(sub, now), days), pagesPerDay } },
    { new: true }
  ).lean();
  const real = daysAtPace(updated.currentPage ?? 0, pagesPerDay);
  const exact = real < days ? t.goalFaster(real) : '';
  return respond(interaction, statusMessage(updated, now, t.goalApplied(durationLabel(days, lang), pagesPerDay) + exact));
}

/** Plan drop-downs: a preset period / preset pages applies at once; "custom" opens a small modal. */
export async function onPlanMenu(interaction) {
  const value = interaction.values?.[0];
  if (interaction.customId === MENU_DURATION) {
    if (value === 'custom') return openModal(interaction, (sub) => goalModal(subLang(sub)), 'expiredPlan');
    const days = Number(value);
    return GOAL_OPTIONS.includes(days) ? applyGoal(interaction, days) : undefined;
  }
  if (interaction.customId === MENU_PAGES) {
    if (value === 'custom') return openModal(interaction, pagesModal, 'expiredPlan');
    const n = Number(value);
    return PAGE_PRESETS.includes(n) ? applyPages(interaction, n) : undefined;
  }
}

async function openModal(interaction, build, key) {
  const sub = await activeSub(interaction, key);
  return sub ? interaction.showModal(build(sub)) : undefined;
}

export async function onGoalModal(interaction) {
  const days = parseGoalDays(interaction.fields.getTextInputValue('days'));
  if (!days) {
    const lang = await wirdLang(interaction, await WirdSubscription.findOne({ userId: interaction.user.id }, { lang: 1 }).lean());
    return fail(interaction, wirdText(lang).goalBadDays, lang);
  }
  return applyGoal(interaction, days);
}

/** Free mode: the member chooses the pages per day; no goal, no calculation. */
async function applyPages(interaction, n) {
  const sub = await activeSub(interaction, 'expiredPages');
  if (!sub) return;
  const lang = subLang(sub), t = wirdText(lang);
  const updated = await WirdSubscription.findOneAndUpdate(
    { userId: sub.userId }, { $set: { pagesPerDay: n, goalDays: null, goalDeadline: null } }, { new: true }
  ).lean();
  const days = daysAtPace(updated.currentPage ?? 0, n);
  return respond(interaction, statusMessage(updated, new Date(), t.pagesApplied(pagesLabel(n, lang), days)));
}

export async function onPagesModal(interaction) {
  const n = parsePages(interaction.fields.getTextInputValue('pages'));
  if (!n) {
    const lang = await wirdLang(interaction, await WirdSubscription.findOne({ userId: interaction.user.id }, { lang: 1 }).lean());
    return fail(interaction, wirdText(lang).pagesBad(MAX_PAGES_PER_DAY), lang);
  }
  return applyPages(interaction, n);
}

/** Behind the goal? Raise the daily pace to what is needed from today. */
export async function recalcGoal(interaction) {
  const sub = await WirdSubscription.findOne({ userId: interaction.user.id }).lean();
  if (!sub) return notSubscribed(interaction);
  const lang = subLang(sub), t = wirdText(lang);
  const now = new Date();
  const g = goalStatus(sub, todayFor(sub, now));
  if (!g) return fail(interaction, t.noGoal, lang);
  if (g.overdue) return respond(interaction, statusMessage(sub, now, t.goalEnded));
  const pagesPerDay = Math.min(MAX_PAGES_PER_DAY, Math.max(1, g.needed));
  const updated = await WirdSubscription.findOneAndUpdate({ userId: sub.userId }, { $set: { pagesPerDay } }, { new: true }).lean();
  const note = g.needed > MAX_PAGES_PER_DAY ? t.goalMaxed(MAX_PAGES_PER_DAY) : t.goalRecalc(pagesPerDay);
  return respond(interaction, statusMessage(updated, now, note));
}

/** Open the khatma-period modal (legacy button). */
export async function openGoalModal(interaction) {
  const sub = await activeSub(interaction, 'expiredGoal');
  return sub ? interaction.showModal(goalModal(subLang(sub))) : undefined;
}

/** Open the pages-per-day modal (legacy button). */
export async function openPagesModal(interaction) {
  const sub = await activeSub(interaction, 'expiredPages');
  return sub ? interaction.showModal(pagesModal(sub)) : undefined;
}
