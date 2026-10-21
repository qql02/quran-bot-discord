// Modals: subscribe / edit settings, khatma period, pages per day.
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { DEFAULT_PAGES, DEFAULT_REMIND_TIME, isVaried } from '../../utils/wird.js';
import { DEFAULT_TIMEZONE } from '../../utils/adhkarSchedule.js';
import { wirdText, subLang } from './text.js';

export const MODAL_SUB = 'wird:modal:sub';
export const MODAL_CUSTOM = 'wird:modal:custom';
export const MODAL_GOAL = 'wird:modal:goal';
export const MODAL_PAGES = 'wird:modal:pages';

const input = (id, label, value, { max = 32, placeholder, required = true } = {}) => {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short)
    .setRequired(required).setMaxLength(max);
  const v = String(value ?? '');
  if (v) field.setValue(v.slice(0, max));
  if (placeholder) field.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(field);
};

/** `lang` is only needed before the member has a record (then it is the server's wird language). */
export function subscribeModal(sub, lang = subLang(sub)) {
  const t = wirdText(lang);
  return new ModalBuilder().setCustomId(MODAL_SUB).setTitle(sub ? t.modalSubEdit : t.modalSubNew).addComponents(
    input('time', t.fTime, sub && !isVaried(sub) ? (sub.remindTime ?? DEFAULT_REMIND_TIME) : '', { max: 5, required: false, placeholder: t.fTimePh }),
    input('tz', t.fTz, sub?.timezone ?? DEFAULT_TIMEZONE, { max: 64 }),
    input('page', t.fPage, sub?.currentPage ?? 0, { max: 3 })
  );
}

/** Any khatma period in days — the pace is calculated for the member. */
export const goalModal = (lang = 'ar') => {
  const t = wirdText(lang);
  return new ModalBuilder().setCustomId(MODAL_GOAL).setTitle(t.modalGoal).addComponents(input('days', t.fGoal, '', { max: 3, placeholder: t.fGoalPh }));
};

/** Free mode: the member picks the pages per day, nothing is calculated. */
export const pagesModal = (sub, lang = subLang(sub)) => {
  const t = wirdText(lang);
  return new ModalBuilder().setCustomId(MODAL_PAGES).setTitle(t.modalPages).addComponents(input('pages', t.fPages, sub?.pagesPerDay ?? DEFAULT_PAGES, { max: 3, placeholder: t.fPagesPh }));
};
