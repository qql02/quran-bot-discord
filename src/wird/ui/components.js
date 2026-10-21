// Buttons, plan drop-downs and button rows used by the wird cards.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { emojiObj } from '../../utils/emojis.js';
import { GOAL_OPTIONS, PAGE_PRESETS, goalStatus, pagesForGoal, daysAtPace } from '../../utils/wird.js';
import { todayFor, durationLabel, pagesLabel } from './shared.js';
import { wirdText, subLang } from './text.js';

// ── Buttons ──
const BTN_EMOJI = {
  'mushaf:open': 'mushaf', 'wird:done': 'done', 'wird:custom': 'more', 'wird:me': 'plan', 'wird:edit': 'settings', 'wird:stop': 'stop',
  'wird:recalc': 'renew', 'wird:renew': 'renew', 'wird:subscribe': 'subscribe', 'wird:delete': 'delete', 'wird:delete:yes': 'delete'
};
export const ADHKAR_BTN = { morning: 'wird:adhkar:morning', evening: 'wird:adhkar:evening' };
export const btn = (id, label, style = ButtonStyle.Secondary) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const e = BTN_EMOJI[id] && emojiObj(BTN_EMOJI[id]);
  return e ? b.setEmoji(e) : b;
};

// ── Plan drop-downs ──
export const MENU_DURATION = 'wird:plan:duration';
export const MENU_PAGES    = 'wird:plan:pages';

/** Two drop-downs: pick a PERIOD (pace is calculated) or pick PAGES PER DAY yourself. The current choice is pre-selected. */
function planMenus(sub, goal) {
  const lang = subLang(sub), t = wirdText(lang);
  const cur = sub.currentPage ?? 0;
  const byGoal = Boolean(sub.goalDays) && !goal?.overdue;
  const duration = new StringSelectMenuBuilder().setCustomId(MENU_DURATION).setPlaceholder(t.menuDuration).addOptions(
    ...GOAL_OPTIONS.map(d => {
      const ppd = pagesForGoal(cur, d);
      return { ...t.menuDurationItem(durationLabel(d, lang), pagesLabel(ppd, lang), daysAtPace(cur, ppd)), value: String(d), default: byGoal && sub.goalDays === d };
    }),
    { ...t.menuDurationOther, value: 'custom' }
  );
  const pages = new StringSelectMenuBuilder().setCustomId(MENU_PAGES).setPlaceholder(t.menuPages).addOptions(
    ...PAGE_PRESETS.map(n => ({ ...t.menuPagesItem(pagesLabel(n, lang), daysAtPace(cur, n)), value: String(n), default: !byGoal && sub.pagesPerDay === n })),
    { ...t.menuPagesOther, value: 'custom' }
  );
  return [new ActionRowBuilder().addComponents(duration), new ActionRowBuilder().addComponents(pages)];
}

// ── Button rows ──
/**
 * Reading is recorded ONLY through the in-Discord reader (page by page), never by a direct "I'm done" button.
 * `full` (the status card): the reader button, the two plan menus, and a small settings row.
 * Otherwise (reminders): the reader button plus one button that opens the settings card.
 */
export function actionRows(sub, { today, full = false } = {}) {
  const day  = today ?? todayFor(sub);
  const t    = wirdText(subLang(sub)).btn;
  const read = btn('mushaf:open', full ? t.readHere : t.readNow, ButtonStyle.Primary);   // opens the reader at the member's own page
  if (!full) {
    const settings = btn('wird:me', t.settings); const e = emojiObj('settings'); if (e) settings.setEmoji(e);
    return [new ActionRowBuilder().addComponents(read, settings)];
  }

  const goal = goalStatus(sub, day);
  const settings = new ActionRowBuilder().addComponents(
    btn('wird:edit', t.editSettings),
    btn('wird:stop', t.stop, ButtonStyle.Danger)
  );
  if (goal && !goal.overdue && !goal.onTrack) settings.addComponents(btn('wird:recalc', t.recalc, ButtonStyle.Primary));
  // Personal adhkar in DMs: two switches (green = on) — the whole card stays within Discord's 5 rows.
  const sw = (on, id, icon, label) => btn(id, `${on ? '✅ ' : ''}${icon} ${label}`, on ? ButtonStyle.Success : ButtonStyle.Secondary);
  const adhkar = new ActionRowBuilder().addComponents(
    sw(sub.adhkarMorning, ADHKAR_BTN.morning, '🌅', t.adhkarMorning),
    sw(sub.adhkarEvening, ADHKAR_BTN.evening, '🌙', t.adhkarEvening)
  );
  return [new ActionRowBuilder().addComponents(read), ...planMenus(sub, goal), adhkar, settings];
}

/** Offered once reminders are stopped: erase the member's record for good (asks for confirmation first). */
export const deleteRow = (lang = 'ar') => new ActionRowBuilder().addComponents(btn('wird:delete', wirdText(lang).btn.delete));

/** `kind`: 'renew' (default) · 'renewNow' · 'resume' — the label of the main button. */
export const renewRow = (lang = 'ar', kind = 'renew') => {
  const t = wirdText(lang).btn;
  return new ActionRowBuilder().addComponents(btn('wird:renew', t[kind], ButtonStyle.Success), btn('wird:me', t.myProgress));
};
