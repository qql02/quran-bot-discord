// Helpers shared by the wird handlers: replying, the "not subscribed" answer, language and guards.
import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { WirdSubscription } from '../../models/WirdSubscription.js';
import { GuildSettings } from '../../models/GuildSettings.js';
import { buildErrorEmbed } from '../../utils/embeds.js';
import { subscriptionState } from '../../utils/wird.js';
import { renewRow, wirdText, subLang, guildWirdLang } from '../ui/index.js';

export const eph = (payload) => ({ ...payload, ephemeral: true });
export const fail = (i, msg, lang = 'ar') => i.reply(eph({ embeds: [buildErrorEmbed(msg, lang)] }));

/**
 * The language of a wird screen: the member's own (stored on their subscription) wins; before they have one it is the
 * language of the wird room of this server (the panel they clicked), then the server's language. DMs read as Arabic.
 */
export async function wirdLang(interaction, sub) {
  if (sub) return subLang(sub);                 // a record without a language (older ones) reads as Arabic, same as its cards
  if (!interaction.guildId) return 'ar';
  try {
    const doc = await GuildSettings.findOne({ guildId: interaction.guildId }, { wird: 1, language: 1 }).lean();
    return guildWirdLang(doc);
  } catch { return 'en'; }
}

/**
 * Show a card. When the click came from an ephemeral card (a button, a menu, or a modal opened from one) the SAME
 * card is edited in place, so changing the plan never piles up new messages. Otherwise (slash command, DM reminder,
 * room panel) a new ephemeral reply is sent.
 */
export function respond(interaction, payload) {
  const fromCard = (interaction.isMessageComponent?.() || interaction.isFromMessage?.())
    && interaction.message?.flags?.has?.(MessageFlags.Ephemeral);
  return fromCard ? interaction.update(payload) : interaction.reply(eph(payload));
}

export async function notSubscribed(interaction) {
  const lang = await wirdLang(interaction, null);
  return interaction.reply(eph({ embeds: [buildErrorEmbed(wirdText(lang).notSubscribed, lang)] }));
}

/**
 * Direct logging ("I finished my wird" / "log another number") no longer exists: reading is recorded page by page in the reader.
 * Old messages that still carry those buttons land here instead of recording anything.
 */
export async function readerOnly(interaction) {
  const lang = await wirdLang(interaction, await WirdSubscription.findOne({ userId: interaction.user.id }, { lang: 1 }).lean());
  return interaction.reply(eph({
    embeds: [buildErrorEmbed(wirdText(lang).readerOnly, lang)],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mushaf:open').setLabel(wirdText(lang).btn.readNow).setStyle(ButtonStyle.Primary))]
  }));
}

/** The member's active subscription, or null after replying with the right message (none / expired). `key` names the "expired" text. */
export async function activeSub(interaction, key = 'expiredPlan') {
  const sub = await WirdSubscription.findOne({ userId: interaction.user.id }).lean();
  if (!sub) { await notSubscribed(interaction); return null; }
  if (!sub.active || subscriptionState(sub.expiresAt) === 'expired') {
    const lang = subLang(sub);
    await interaction.reply(eph({ embeds: [buildErrorEmbed(wirdText(lang)[key], lang)], components: [renewRow(lang)] }));
    return null;
  }
  return sub;
}
