// The wird cards (embeds): reminder, status, saved, reading and khatma. Every card speaks the member's language (`sub.lang`).
import { EmbedBuilder } from 'discord.js';
import { COLORS, THUMBNAIL } from '../../utils/embeds.js';
import { withEmoji } from '../../utils/emojis.js';
import {
  TOTAL_PAGES, SUBSCRIPTION_DAYS, todayPortion, progressBar, percent, liveStreak, subscriptionState,
  goalStatus, daysAtPace, daysLeft, isVaried, isFriday, hasPersonalAdhkar
} from '../../utils/wird.js';
import { mushafText } from '../../utils/mushafText.js';
import { ts, hhmm, range, where, todayFor, remainingToday, durationLabel, pagesLabel } from './shared.js';
import { actionRows, renewRow } from './components.js';
import { wirdText, subLang } from './text.js';

function subscriptionLine(sub, now) {
  const t = wirdText(subLang(sub));
  if (!sub.active) return t.subStopped;
  const state = subscriptionState(sub.expiresAt, now);
  if (state === 'expired') return t.subExpired;
  return t.subActive(state === 'expiring', ts(sub.expiresAt), ts(sub.expiresAt, 'R'));
}

// ── Sections (each one is a field with its own header, in the same order on every card) ──────────────────────────

/** 📖 Today's portion: the pages and where they are. */
const todayField = (left, lang) => ({
  name: withEmoji('today', wirdText(lang).todayName),
  value: left ? `${range(left.from, left.to, lang)}\n${where(left.from, lang)}` : wirdText(lang).todayDone
});

/** 📊 Khatma progress bar. */
const progressField = (sub) => {
  const t = wirdText(subLang(sub));
  const cur = sub.currentPage ?? 0;
  return { name: withEmoji('progress', t.progressName), value: t.progressValue(progressBar(cur / TOTAL_PAGES), percent(cur), cur, TOTAL_PAGES) };
};

/** 🏆 Streak, khatmas and total pages — three small cells in one row. */
const statsFields = (sub, today) => {
  const t = wirdText(subLang(sub));
  return [
    { name: withEmoji('streak', t.streakName), value: t.streakValue(liveStreak(sub, today), sub.bestStreak ?? 0), inline: true },
    { name: withEmoji('khatma', t.khatmasName), value: t.khatmasValue(sub.khatmaCount ?? 0), inline: true },
    { name: withEmoji('books', t.readName), value: t.readValue(sub.totalPagesRead ?? 0), inline: true }
  ];
};

/** 🎯 The plan (pace + finish date) and, only when a period was chosen, a separate goal section. */
function planFields(sub, today, now) {
  const lang = subLang(sub), t = wirdText(lang);
  const cur  = sub.currentPage ?? 0;
  const days = daysAtPace(cur, sub.pagesPerDay);
  const eta  = new Date(now.getTime() + days * 86_400_000);
  const g    = goalStatus(sub, today);
  const fields = [{ name: withEmoji('goal', t.planName), value: t.planValue(pagesLabel(sub.pagesPerDay, lang), days, ts(eta), !g) }];
  if (g?.overdue) fields.push({ name: t.goalName, value: t.goalOverdue });
  else if (g) {
    const lines = [t.goalLine(durationLabel(sub.goalDays, lang), g.deadline), g.onTrack ? t.goalOnTrack : t.goalBehind(g.needed)];
    if (sub.active && daysLeft(sub.expiresAt, now) < g.daysLeft) lines.push(t.goalSubEnds);
    fields.push({ name: t.goalName, value: lines.join('\n') });
  }
  return fields;
}

/** 🔔 Subscription, then reminder time and timezone side by side. */
const settingsFields = (sub, now) => {
  const t = wirdText(subLang(sub));
  return [
    { name: withEmoji('subscribe', t.subName), value: subscriptionLine(sub, now) },
    { name: withEmoji('clock', t.reminderName), value: isVaried(sub) ? t.reminderVaried : `\`${hhmm(sub.remindTime)}\``, inline: true },
    { name: withEmoji('globe', t.zoneName), value: `\`${sub.timezone}\``, inline: true },
    { name: t.adhkarName, value: hasPersonalAdhkar(sub) ? t.adhkarValue(sub.adhkarMorning, sub.adhkarEvening) : t.adhkarOff }
  ];
};

/** 💡 "How to use" — shown right after subscribing / renewing, so the member knows what to do next. */
const guideField = (lang) => ({ name: withEmoji('guide', wirdText(lang).guideName), value: wirdText(lang).guideValue });

// ── Cards ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The daily reminder (DM, or the wird room when DMs are closed): today → progress → streak / remaining. */
export function reminderMessage(sub, now = new Date()) {
  const lang = subLang(sub), t = wirdText(lang);
  const today  = todayFor(sub, now);
  const portion = remainingToday(sub, today) ?? todayPortion(sub.currentPage ?? 0, sub.pagesPerDay) ?? { from: 1, to: sub.pagesPerDay };
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(withEmoji('reminder', t.reminderTitle))
    .setDescription(isFriday(today) ? `${t.reminderGreeting}\n\n${mushafText(lang).fridayNote}` : t.reminderGreeting)
    .addFields(
      todayField(portion, lang),
      progressField(sub),
      { name: withEmoji('streak', t.streakName), value: t.streakInline(liveStreak(sub, today)), inline: true },
      { name: t.leftName, value: t.leftValue(daysAtPace(sub.currentPage ?? 0, sub.pagesPerDay)), inline: true }
    )
    .setThumbnail(THUMBNAIL)
    .setFooter({ text: t.reminderFooter });
  return { embeds: [embed], components: actionRows(sub, { today }) };
}

/** Short, public-safe reminder used when the member's DMs are closed (no progress, no personal buttons). */
export function roomReminderMessage(sub, now = new Date()) {
  const lang = subLang(sub);
  const today   = todayFor(sub, now);
  const portion = remainingToday(sub, today) ?? todayPortion(sub.currentPage ?? 0, sub.pagesPerDay) ?? { from: 1, to: sub.pagesPerDay };
  return {
    content: wirdText(lang).roomReminder(sub.userId, range(portion.from, portion.to, lang)),
    allowedMentions: { users: [sub.userId] }
  };
}

/**
 * Full status card (/wird me, the settings button). Sections in a fixed order:
 * today → progress → plan (+ goal) → stats → subscription / reminder / timezone — and the plan menus underneath.
 * `opts.guide` adds the "how to use" section (first subscription / renewal).
 */
export function statusMessage(sub, now = new Date(), note, { guide = false } = {}) {
  const lang = subLang(sub), t = wirdText(lang);
  const today  = todayFor(sub, now);
  const left   = remainingToday(sub, today);
  const active = sub.active && subscriptionState(sub.expiresAt, now) !== 'expired';
  const embed = new EmbedBuilder()
    .setColor(active ? COLORS.primary : COLORS.dark)
    .setTitle(withEmoji('quran', t.statusTitle))
    .addFields(
      todayField(left, lang),
      progressField(sub),
      ...planFields(sub, today, now),
      ...statsFields(sub, today),
      ...settingsFields(sub, now),
      ...(guide ? [guideField(lang)] : [])
    )
    .setThumbnail(THUMBNAIL);
  if (note) embed.setDescription(note);
  if (active) embed.setFooter({ text: t.statusFooter });
  return { embeds: [embed], components: active ? actionRows(sub, { today, full: true }) : [renewRow(lang)] };
}

/** `kind`: 'subscribed' · 'welcomeBack' · 'settingsSaved' · 'renewed'. */
export function savedMessage(sub, now = new Date(), kind = 'subscribed') {
  const t = wirdText(subLang(sub));
  return statusMessage(sub, now, t.saved(t.savedTitles[kind] ?? t.savedTitles.subscribed, SUBSCRIPTION_DAYS), { guide: true });
}

export function readingMessage(sub, result, now = new Date()) {
  const t = wirdText(subLang(sub));
  const today = todayFor(sub, now);
  const lines = [t.readingSaved(result.added)];
  if (result.newlyDone) lines.push(t.readingDayDone(liveStreak(sub, today)));
  else if (!result.dayDone) lines.push(t.readingLeft);
  return statusMessage(sub, now, lines.join('\n'));
}

export function khatmaMessage(sub) {
  const t = wirdText(subLang(sub));
  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(withEmoji('khatma', t.khatmaTitle))
    .setDescription(t.khatmaDesc(sub.khatmaCount))
    .setThumbnail(THUMBNAIL);
  return { embeds: [embed] };
}

/** Posted in the wird room, so it follows the room's language (`lang`), not the member's. */
export const khatmaAnnouncement = (userId, count, days, lang = 'ar') => ({
  content: wirdText(lang).khatmaAnnounce(userId, count, days),
  allowedMentions: { users: [userId] }
});
