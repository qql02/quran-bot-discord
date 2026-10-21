// The /setup preview card: what will be created for the features the admin picked, plus the picker and the buttons.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { setupPlan, setupText, langName, normLang, cleanSelection, SETUP_KEYS } from '../data/setupLayout.js';

export const PICK_ID = 'setup:pick';
export const CONFIRM_ID = 'setup:confirm';
export const CANCEL_ID = 'setup:cancel';

/** The preview text. Everything is in one language; the time zone is only mentioned when the adhkar are picked. */
export function previewText({ lang, selected, timezone }) {
  lang = normLang(lang);
  const t = setupText(lang);
  const picked = cleanSelection(selected);
  const plan = setupPlan(lang, picked);
  const lines = [t.previewIntro, ''];
  if (!plan.items.length) lines.push(t.nothingPicked);
  else {
    lines.push(t.category(plan.category));
    for (const it of plan.items) lines.push(it.type === 'voice' ? t.voiceLine(it.name) : t.textLine(it.name, t.notes[it.key]));
  }
  const skipped = SETUP_KEYS.filter(k => !picked.includes(k));
  if (picked.length && skipped.length) lines.push('', t.notCreating(skipped.map(k => t.choices[k].label).join(lang === 'ar' ? '، ' : ', ')));
  lines.push('', t.langLine(langName(lang)));
  if (picked.includes('adhkar')) lines.push(t.zoneLine(timezone));
  lines.push('', `-# ${t.rerun}`);
  return lines.join('\n');
}

/** The multi-select (everything ticked at first) and the Create / Cancel buttons. Create is disabled until something is picked. */
export function previewComponents({ lang, selected }) {
  lang = normLang(lang);
  const t = setupText(lang);
  const picked = cleanSelection(selected);
  const menu = new StringSelectMenuBuilder().setCustomId(PICK_ID).setPlaceholder(t.pickerPlaceholder)
    .setMinValues(0).setMaxValues(SETUP_KEYS.length)
    .addOptions(...SETUP_KEYS.map(k => ({ label: t.choices[k].label, description: t.choices[k].description, value: k, default: picked.includes(k) })));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel(t.confirm).setStyle(ButtonStyle.Success).setDisabled(!picked.length),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel(t.cancel).setStyle(ButtonStyle.Secondary)
  );
  return [new ActionRowBuilder().addComponents(menu), row];
}
