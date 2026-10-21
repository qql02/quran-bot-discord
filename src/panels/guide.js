import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { COLORS, THUMBNAIL } from '../utils/embeds.js';
import { config } from '../config.js';
import { GUIDE_TOPICS, GUIDE_KEYS, guideTopic } from '../data/guideText.js';

// The user guide card: one topic per screen, a menu to move between them. Stateless — the menu itself is the only state
// (custom id `menu:guide_topic`), so a card still on someone's screen after a restart keeps working.

export const GUIDE_MENU_ID = 'menu:guide_topic';
/** In the bot's private chat the menu id also carries the language (a DM has no server to read it from): menu:guide_topic:dm:ar */
export const GUIDE_DM_PREFIX = 'menu:guide_topic:dm:';

const withPrefix = (text) => text.replaceAll('{prefix}', config.bot.prefix);

/** @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }} the guide card showing `key` (an unknown key shows the first topic). */
export function guideHome(lang, key = GUIDE_KEYS[0], { dm = false } = {}) {
  const ar = lang === 'ar';
  const topic = guideTopic(key);
  const text = ar ? topic.ar : topic.en;
  const menu = new StringSelectMenuBuilder().setCustomId(dm ? `${GUIDE_DM_PREFIX}${lang === 'ar' ? 'ar' : 'en'}` : GUIDE_MENU_ID)
    .setPlaceholder(ar ? 'اختر موضوعاً…' : 'Choose a topic…')
    .addOptions(GUIDE_TOPICS.map(t => {
      const x = ar ? t.ar : t.en;
      return { label: x.label.slice(0, 100), description: x.desc.slice(0, 100), value: t.key, default: t.key === topic.key };
    }));
  const idx = GUIDE_KEYS.indexOf(topic.key) + 1;
  const embed = new EmbedBuilder().setColor(COLORS.primary).setThumbnail(THUMBNAIL)
    .setTitle(text.label)
    .setDescription(withPrefix(text.body))
    .setFooter({ text: ar ? `دليل المستخدم · ${idx}/${GUIDE_KEYS.length}` : `User guide · ${idx}/${GUIDE_KEYS.length}` });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}
