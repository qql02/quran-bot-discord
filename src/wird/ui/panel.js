// The panel posted in the wird room — one per language.
import { EmbedBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { COLORS, THUMBNAIL } from '../../utils/embeds.js';
import { withEmoji } from '../../utils/emojis.js';
import { SUBSCRIPTION_DAYS, INACTIVITY_PAUSE_DAYS } from '../../utils/wird.js';
import { btn } from './components.js';
import { wirdText } from './text.js';

/** The room panel: one short intro, then the way of use in numbered sections, then the subscription terms. */
export function roomPanelMessage(lang = 'ar') {
  const t = wirdText(lang);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(withEmoji('quran', t.panelTitle))
    .setDescription(t.panelDesc)
    .addFields(
      ...t.panelFields,
      { name: withEmoji('guide', t.panelInfoName), value: t.panelInfo(SUBSCRIPTION_DAYS, INACTIVITY_PAUSE_DAYS) }
    )
    .setThumbnail(THUMBNAIL);
  const row = new ActionRowBuilder().addComponents(
    btn('wird:subscribe', t.btn.subscribe, ButtonStyle.Success),
    btn('wird:me', t.btn.myPlan),
    btn('mushaf:open', t.btn.readMushaf)
  );
  return { embeds: [embed], components: [row] };
}
