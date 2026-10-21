import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';

// A DM has no bulk-delete, so every message is removed one by one. These limits keep one run bounded:
// a run that stops early says so and the person simply runs /cleardm again.
const MAX_SCAN        = 1000;          // newest messages looked at
const MAX_DELETE      = 300;           // bot messages removed per run
const TIME_BUDGET_MS  = 10 * 60_000;   // an interaction token lives 15 minutes; stop well before that
const PARALLEL        = 3;

const running = new Set();             // userIds with a /cleardm in progress (a second one would only fight the first)

/** Discord answers a bot that tries to delete somebody else's message in a DM with one of these (the permission to do it exists only in servers). */
export const isDmRefusal = (err) => err?.code === 50003 || err?.code === 50001 || err?.code === 50013 || err?.status === 403;

/**
 * Delete the messages in `user`'s DM: the bot's own, and (includeUser) the member's too.
 * Deleting the member's own messages is attempted, but Discord normally refuses it for bots in DMs: the first refusal stops those attempts
 * (no wasted calls), the bot's messages are still all deleted, and `userBlocked` tells the command to explain it to the member.
 * Returns what happened so the command (and tests) can report it.
 * @returns {Promise<{ found: number, deleted: number, failed: number, more: boolean, userFound: number, userDeleted: number, userBlocked: boolean }>}
 */
export async function clearBotDms(client, user, { maxScan = MAX_SCAN, maxDelete = MAX_DELETE, budgetMs = TIME_BUDGET_MS, keepInteractionId = null, includeUser = true } = {}) {
  const dm = await user.createDM();
  const mine = [];
  let before;
  let scanned = 0;
  let more = false;

  while (scanned < maxScan) {
    const batch = await dm.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    scanned += batch.size;
    before = batch.last().id;
    for (const m of batch.values()) {
      const own = m.author?.id === client.user.id;
      if (!own && !(includeUser && m.author?.id === user.id)) continue;
      // Our own reply to this very command (visible when /cleardm runs in a DM) must stay, or editReply would fail.
      if (keepInteractionId && (m.interaction?.id === keepInteractionId || m.interactionMetadata?.id === keepInteractionId)) continue;
      mine.push(m);
    }
    if (mine.length >= maxDelete) { more = true; break; }
    if (batch.size < 100) break;
    if (scanned >= maxScan) more = true;
  }

  const todo = mine.slice(0, maxDelete);
  if (mine.length > todo.length) more = true;

  const startedAt = Date.now();
  let deleted = 0;
  let failed  = 0;
  let next    = 0;
  let userBlocked = false;
  let userDeleted = 0;
  const isOwn = (m) => m.author?.id === client.user.id;
  const userFound = todo.filter(m => !isOwn(m)).length;
  const worker = async () => {
    while (next < todo.length) {
      if (Date.now() - startedAt > budgetMs) { more = true; return; }
      const m = todo[next++];
      const mine = isOwn(m);
      if (!mine && userBlocked) continue;            // Discord already refused one of the member's messages: do not ask again
      try { await m.delete(); deleted++; if (!mine) userDeleted++; }
      catch (err) {
        if (err.code === 10008) { deleted++; if (!mine) userDeleted++; }   // already gone: the goal is reached
        else if (!mine && isDmRefusal(err)) userBlocked = true;
        else { failed++; logger.debug?.(`[clear] could not delete DM message ${m.id}: ${err.message}`); }
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  return { found: todo.length, deleted, failed, more, userFound, userDeleted, userBlocked };
}

export default {
  data: new SlashCommandBuilder()
    .setName('cleardm')
    .setDescription('ℹ️ Delete the bot\'s messages and yours in your DM / حذف رسائل البوت ورسائلك في خاصك'),

  async execute(interaction) {
    const lang = interaction.guildId
      ? await GuildSettings.getLanguage(interaction.guildId)
      : (String(interaction.locale ?? '').startsWith('ar') ? 'ar' : 'en');
    const ar = lang === 'ar';

    if (running.has(interaction.user.id)) {
      return interaction.reply({
        embeds: [buildErrorEmbed(ar ? 'الحذف جارٍ بالفعل، انتظر حتى ينتهي.' : 'A cleanup is already running. Please wait for it to finish.', lang)],
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    running.add(interaction.user.id);
    try {
      const { found, deleted, failed, more, userBlocked } = await clearBotDms(interaction.client, interaction.user, { keepInteractionId: interaction.id });

      if (found === 0) {
        return interaction.editReply({
          embeds: [buildSuccessEmbed(
            ar ? 'لا يوجد ما يُحذف' : 'Nothing to delete',
            ar ? 'لا توجد رسائل في الخاص.' : 'There are no messages in your DMs.',
            lang
          )]
        });
      }

      const parts = [ar ? `تم حذف **${deleted}** رسالة من الخاص.` : `Deleted **${deleted}** message(s) from your DMs.`];
      if (userBlocked) parts.push(ar
        ? 'ℹ️ ديسكورد لا يسمح للبوت بحذف **رسائلك أنت** في الخاص، فحُذفت رسائل البوت فقط. لحذف رسائلك: اضغط على الرسالة ← حذف.'
        : 'ℹ️ Discord does not let a bot delete **your own** messages in a DM, so only the bot\'s messages were removed. To remove yours: press the message → Delete.');
      if (failed > 0) parts.push(ar ? `تعذّر حذف ${failed}.` : `${failed} could not be deleted.`);
      if (more)       parts.push(ar ? 'ما زالت هناك رسائل أخرى، أعد تشغيل `/cleardm`.' : 'More messages remain — run `/cleardm` again.');
      return interaction.editReply({
        embeds: [buildSuccessEmbed(ar ? 'تم الحذف' : 'Cleared', parts.join('\n'), lang)]
      });
    } catch (err) {
      logger.warn(`[clear] failed for ${interaction.user.id}: ${err.message}`);
      return interaction.editReply({
        embeds: [buildErrorEmbed(ar ? 'تعذّر الوصول إلى الرسائل الخاصة.' : 'Could not access your DMs.', lang)]
      }).catch(() => {});
    } finally {
      running.delete(interaction.user.id);
    }
  }
};
