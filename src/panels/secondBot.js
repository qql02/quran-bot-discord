/**
 * "Second bot" page — opened from the 🎧 button under /invite and in the /help menu; works in any server the bot is in.
 *   sbot:open  → the steps (or "ready" when it is already there)
 *   sbot:check → asks Discord whether the second bot joined, and what it still lacks
 */
import { config } from '../config.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { getSecondaryBots } from '../services/siblingService.js';
import { pickSecondBot, probeMembership, secondBotState, buildSecondBotMessage, secondBotOpenRow } from '../utils/secondBot.js';

const load = async (guildId) => pickSecondBot(await getSecondaryBots(), guildId, config.bot.altBotId ?? null);

/** Components for /invite and the menu: the open button when a second bot exists, nothing otherwise. Never throws. */
export async function secondBotComponents(lang, guildId) {
  try { return (await load(guildId)) ? [secondBotOpenRow(lang)] : []; } catch { return []; }
}

export async function handleSecondBot(i) {
  if (!i.guildId || !i.guild) return i.deferUpdate?.().catch(() => {});
  const lang = await GuildSettings.getLanguage(i.guildId).catch(() => 'en');
  const bot = await load(i.guildId);
  const checking = i.customId === 'sbot:check';

  if (checking) await i.deferUpdate().catch(() => {});
  const probe = bot
    ? await probeMembership({ fetchMember: (id) => i.guild.members.fetch(id), botId: bot.id, listedInGuild: bot.listedInGuild, retries: checking ? 1 : 0 })
    : { joined: false, gaps: [], source: 'none' };
  const msg = buildSecondBotMessage({ lang, state: secondBotState({ bot, probe }), bot, guildId: i.guildId, probe, checked: checking });

  if (checking) return i.editReply(msg);
  return i.reply({ ...msg, ephemeral: true });
}
