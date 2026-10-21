// One-off notices: delete confirmation, subscription expiring / expired, inactivity, and the public-safe room versions.
import { EmbedBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { COLORS, THUMBNAIL } from '../../utils/embeds.js';
import { withEmoji } from '../../utils/emojis.js';
import { TOTAL_PAGES, SUBSCRIPTION_DAYS, INACTIVITY_PAUSE_DAYS } from '../../utils/wird.js';
import { ts } from './shared.js';
import { btn, renewRow } from './components.js';
import { wirdText, subLang } from './text.js';

// ── Data deletion ──
export function deleteConfirmMessage(lang = 'ar') {
  const t = wirdText(lang);
  const embed = new EmbedBuilder().setColor(COLORS.warning).setTitle(withEmoji('warning', t.deleteTitle)).setDescription(t.deleteDesc);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(
    btn('wird:delete:yes', t.btn.deleteYes, ButtonStyle.Danger), btn('wird:delete:no', t.btn.deleteNo))] };
}

export function deletedMessage(lang = 'ar') {
  const t = wirdText(lang);
  const embed = new EmbedBuilder().setColor(COLORS.dark).setTitle(t.deletedTitle).setDescription(t.deletedDesc);
  return { embeds: [embed], components: [] };
}

// ── Expiry / inactivity (DM) ──
export function expiringMessage(sub) {
  const lang = subLang(sub), t = wirdText(lang);
  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle(withEmoji('expiring', t.expiringTitle))
    .setDescription(t.expiringDesc(ts(sub.expiresAt), ts(sub.expiresAt, 'R'), SUBSCRIPTION_DAYS))
    .setThumbnail(THUMBNAIL);
  return { embeds: [embed], components: [renewRow(lang, 'renewNow')] };
}

export function expiredMessage(sub) {
  const lang = subLang(sub), t = wirdText(lang);
  const embed = new EmbedBuilder()
    .setColor(COLORS.dark)
    .setTitle(withEmoji('expired', t.expiredTitle))
    .setDescription(t.expiredDesc(sub.currentPage, TOTAL_PAGES))
    .setThumbnail(THUMBNAIL);
  return { embeds: [embed], components: [renewRow(lang)] };
}

/** Sent once when reminders pause because nothing was logged for INACTIVITY_PAUSE_DAYS days. */
export function inactiveMessage(sub) {
  const lang = subLang(sub), t = wirdText(lang);
  const embed = new EmbedBuilder()
    .setColor(COLORS.dark)
    .setTitle(withEmoji('inactive', t.inactiveTitle))
    .setDescription(t.inactiveDesc(INACTIVITY_PAUSE_DAYS, sub.currentPage ?? 0, TOTAL_PAGES))
    .setThumbnail(THUMBNAIL);
  return { embeds: [embed], components: [renewRow(lang, 'resume')] };
}

// ── Room versions (DMs closed) ──
/**
 * Public-safe pointers used when the member's DMs are closed and a notice has to go to the wird room instead:
 * a mention and one sentence — never the member's progress, and no buttons (a button there would act on whoever clicks it).
 */
const roomNotice = (userId, content) => ({ content, allowedMentions: { users: [userId] } });
export const roomExpiringMessage = (sub) => roomNotice(sub.userId, wirdText(subLang(sub)).roomExpiring(sub.userId, ts(sub.expiresAt, 'R')));
export const roomExpiredMessage  = (sub) => roomNotice(sub.userId, wirdText(subLang(sub)).roomExpired(sub.userId));
export const roomInactiveMessage = (sub) => roomNotice(sub.userId, wirdText(subLang(sub)).roomInactive(sub.userId, INACTIVITY_PAUSE_DAYS));
