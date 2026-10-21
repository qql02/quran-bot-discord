/**
 * The optional "second bot" (voice-only helper) as the server's admins see it: which bot it is, whether it is in THIS server,
 * what it still lacks, and the message that explains the steps. Works for ANY server — nothing here is tied to one server ID.
 *
 * Pure except `probeMembership` (it asks Discord through an injected function), so it is testable without Discord.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { COLORS, THUMBNAIL } from './embeds.js';
import { t } from './i18n.js';
import { inviteUrl, VOICE_WORKER_PERMS, VOICE_WORKER_INVITE_PERMISSIONS } from './botToken.js';

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Which bot to offer this server.
 *   a bot that is already in the server wins (so the page can say "ready"), then a running one, then the most recent one;
 *   `fallbackId` (ALT_BOT_ID) is used only when the registry knows no voice-only bot at all.
 * @param {Array<{id,tag,alive,guildIds}>} bots registry entries, newest first
 * @returns {{ id, tag, alive, listedInGuild, fromFallback }|null}
 */
export function pickSecondBot(bots, guildId, fallbackId = null) {
  const list = (bots ?? []).filter(b => SNOWFLAKE.test(String(b?.id ?? '')));
  const inGuild = list.find(b => (b.guildIds ?? []).includes(guildId));
  const best = inGuild ?? list.find(b => b.alive) ?? list[0];
  if (best) return { id: String(best.id), tag: best.tag ?? null, alive: !!best.alive, listedInGuild: !!inGuild, fromFallback: false };
  if (SNOWFLAKE.test(String(fallbackId ?? ''))) return { id: String(fallbackId), tag: null, alive: false, listedInGuild: false, fromFallback: true };
  return null;
}

/** Permission names the second bot lacks, from the member object Discord returned for it. Administrator covers everything. */
export function missingPermissions(member) {
  const perms = member?.permissions;
  if (!perms?.has) return [];
  if (perms.has(1n << 3n)) return [];
  return Object.entries(VOICE_WORKER_PERMS).filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
}

/**
 * Is the second bot in this server? Discord is asked directly (no waiting for the bot's next heartbeat); when Discord cannot answer,
 * the registry's list of servers is the fallback. One retry covers the second between "authorised" and "visible".
 * @param {{ fetchMember:(id)=>Promise<object|null>, botId:string, listedInGuild?:boolean, sleep?:(ms)=>Promise<void>, retries?:number }} o
 * @returns {Promise<{ joined:boolean, gaps:string[], source:'discord'|'registry'|'none' }>}
 */
export async function probeMembership({ fetchMember, botId, listedInGuild = false, sleep = (ms) => new Promise(r => setTimeout(r, ms)), retries = 1 }) {
  let answered = false;
  for (let i = 0; i <= retries; i++) {
    try {
      const member = await fetchMember(botId);
      answered = true;
      if (member) return { joined: true, gaps: missingPermissions(member), source: 'discord' };
    } catch (e) {
      if (e?.code === 10007 || e?.code === 10013) answered = true;            // Unknown Member / Unknown User: a real "no"
    }
    if (i < retries) await sleep(1500);
  }
  if (listedInGuild) return { joined: true, gaps: [], source: 'registry' };
  return { joined: false, gaps: [], source: answered ? 'discord' : 'none' };
}

/** What the page should say. → 'none' | 'not_joined' | 'ok' | 'gaps' | 'offline' */
export function secondBotState({ bot, probe }) {
  if (!bot) return 'none';
  if (!probe?.joined) return 'not_joined';
  if (probe.gaps?.length) return 'gaps';
  return bot.alive ? 'ok' : 'offline';
}

const mention = (bot) => `<@${bot.id}>`;

/** The embed + buttons for a state. `checked` = the member pressed "Check" (so "not joined yet" is a real answer, not the first view). */
export function buildSecondBotMessage({ lang, state, bot, guildId, probe, checked = false }) {
  const L = (k, v) => t(lang, `commands.secondbot.${k}`, v);
  const embed = new EmbedBuilder().setThumbnail(THUMBNAIL).setFooter({ text: L('footer') });
  const rows = [];
  const checkBtn = new ButtonBuilder().setCustomId('sbot:check').setLabel(L('btn_check')).setStyle(ButtonStyle.Primary);

  if (state === 'none') {
    embed.setColor(COLORS.warning).setTitle(L('none_title')).setDescription(L('none_body'));
  } else if (state === 'ok') {
    embed.setColor(COLORS.success).setTitle(L('ok_title')).setDescription(L('ok_body', { bot: mention(bot) }));
    rows.push(new ActionRowBuilder().addComponents(checkBtn));
  } else if (state === 'gaps') {
    embed.setColor(COLORS.warning).setTitle(L('gaps_title')).setDescription(L('gaps_body', { bot: mention(bot), gaps: probe.gaps.join(', ') }));
    rows.push(new ActionRowBuilder().addComponents(checkBtn));
  } else if (state === 'offline') {
    embed.setColor(COLORS.warning).setTitle(L('offline_title')).setDescription(L('offline_body', { bot: mention(bot) }));
    rows.push(new ActionRowBuilder().addComponents(checkBtn));
  } else {                                                                      // not_joined: the steps
    const url = inviteUrl(bot.id, VOICE_WORKER_INVITE_PERMISSIONS, guildId, { commands: false });
    const lines = [L('intro'), '', `**${L('steps_title')}**`, `1️⃣ ${L('step1')}`, `2️⃣ ${L('step2')}`, `3️⃣ ${L('step3')}`, `4️⃣ ${L('step4')}`, '', L('bot_line', { bot: mention(bot) })];
    if (checked) lines.push('', L('not_joined'));
    embed.setColor(COLORS.teal).setTitle(L('title')).setDescription(lines.join('\n'));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(L('btn_add')).setEmoji('➕').setStyle(ButtonStyle.Link).setURL(url),
      checkBtn
    ));
  }
  return { embeds: [embed], components: rows };
}

/** The button that opens the page (shown under /invite and in the member menu only when a second bot exists). */
export const secondBotOpenRow = (lang) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('sbot:open').setLabel(t(lang, 'commands.secondbot.btn_open')).setStyle(ButtonStyle.Secondary)
);
