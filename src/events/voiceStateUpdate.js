import { logger }        from '../utils/logger.js';
import { config }        from '../config.js';
import { notifySessionsChanged, getSiblings, shouldYield } from '../services/siblingService.js';
import { getSession, destroySession, startAutoLeaveTimer, onListenerArrived, deletePanel } from '../managers/sessionManager.js';
import { rememberLeftRoom, rememberJoinedRoom } from '../utils/recentRooms.js';

export default {
  name: 'voiceStateUpdate',

  async execute(oldState, newState, client) {
    // ── 00. A member left / switched rooms: remember where they were, so /pull knows which recitation they mean ──
    if (oldState.channelId && oldState.channelId !== newState.channelId && !oldState.member?.user?.bot) {
      rememberLeftRoom(oldState.guild.id, oldState.id, oldState.channelId);
    }
    if (newState.channelId && newState.channelId !== oldState.channelId && !newState.member?.user?.bot) {
      rememberJoinedRoom(newState.guild.id, newState.id, newState.channelId);   // so a stay of a few seconds can be told from real listening
    }

    // ── 0. Someone who ran /start outside voice has just joined a channel → send the panel there ──
    if (newState.channelId && newState.channelId !== oldState.channelId && !newState.member?.user?.bot) {
      const { onVoiceJoin } = await import('../utils/panelRegistry.js');   // loaded on demand: only people who ran /start are waiting
      await onVoiceJoin(newState, client).catch(err => logger.warn(`Voice-join panel failed: ${err.message}`));
    }

    // ── 0b. ANOTHER bot joined (or was moved into) the channel we are playing in → leave at once, so a music bot and the
    //        Quran are never heard together. Our own join/move and human members are not affected.
    // A Quran sibling that joined our room is handled first: exactly one of the two leaves (the same rule runs in both processes), even
    // when LEAVE_FOR_OTHER_BOTS is off.
    if (newState.channelId && newState.channelId !== oldState.channelId && newState.member?.user?.bot && newState.member.id !== client.user.id) {
      const guildId = newState.guild.id;
      const session = getSession(guildId);
      if (session && session.voiceChannelId === newState.channelId) {
        const other = (await getSiblings(guildId)).find(s => s.id === newState.member.id);
        if (other) {
          if (!shouldYield({ id: client.user.id, role: config.bot.role }, other)) return;   // the other bot gives way
          logger.warn(`[${guildId}] Sibling bot ${other.id} is in #${session.channelName} too — giving way`);
          await destroySession(guildId).catch(() => {});
          return;
        }
      }
    }
    if (config.session.leaveForOtherBots && newState.channelId && newState.channelId !== oldState.channelId
        && newState.member?.user?.bot && newState.member.id !== client.user.id) {
      const guildId = newState.guild.id;
      const session = getSession(guildId);
      if (session && session.voiceChannelId === newState.channelId) {
        logger.warn(`[${guildId}] Another bot (${newState.member.user.tag}) joined #${session.channelName} — leaving`);
        client._pushActivity?.('info', `🤖 بوت آخر دخل القناة: ${session.channelName}`, `السيرفر: ${newState.guild.name}`);
        await destroySession(guildId).catch(() => {});
        return;
      }
    }

    // ── 1. Bot itself was moved / disconnected / kicked ────────────────────
    if (oldState.member?.id === client.user.id) {
      const guildId = oldState.guild.id;
      const session = getSession(guildId);
      if (!session) return;

      // Bot left a channel
      if (oldState.channelId && !newState.channelId) {
        logger.warn(`[${guildId}] Bot was disconnected from voice — destroying session`);
        if (client._pushActivity) {
          client._pushActivity('stop',
            `⚠️ تم فصل البوت من القناة: ${oldState.channel?.name ?? 'Unknown'}`,
            `السيرفر: ${oldState.guild.name}`
          );
        }
        await destroySession(guildId).catch(() => {});
        return;
      }

      // Bot was moved to a different channel — update session metadata
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        session.voiceChannelId = newState.channelId;
        session.channelName    = newState.channel?.name ?? session.channelName;
        logger.info(`[${guildId}] Bot moved → #${session.channelName}`);
        notifySessionsChanged();
        if (client._pushActivity) {
          client._pushActivity('info',
            `🔀 نُقل البوت إلى: ${session.channelName}`,
            `السيرفر: ${oldState.guild.name}`
          );
        }
        return;
      }
    }

    // ── 2. Voice channel was deleted while bot is in it ────────────────────
    if (oldState.channelId && !newState.channelId) {
      const guildId = oldState.guild.id;
      const session = getSession(guildId);
      if (!session) return;

      // Check if the deleted channel was the bot's channel
      if (session.voiceChannelId === oldState.channelId) {
        // Only act if it's actually gone (not just a member leaving)
        const channelStillExists = oldState.guild.channels.cache.has(oldState.channelId);
        if (!channelStillExists) {
          logger.warn(`[${guildId}] Voice channel deleted — destroying session`);
          await destroySession(guildId).catch(() => {});
        }
      }
    }

    // ── 3. Bot is alone in the channel (everyone left) ─────────────────────
    if (oldState.channelId) {
      const guildId = oldState.guild.id;
      const session = getSession(guildId);
      if (!session || session.voiceChannelId !== oldState.channelId) return;

      const channel = oldState.guild.channels.cache.get(oldState.channelId);
      if (!channel) return;

      // Count real members (non-bots) remaining in channel
      const realMembers = channel.members.filter(m => !m.user.bot).size;
      if (realMembers === 0) {
        // The last listener went to ANOTHER voice room (not out of voice altogether): they may want /pull, so wait a little longer.
        const movedOn = !!newState.channelId && newState.channelId !== oldState.channelId && !oldState.member?.user?.bot;
        const wait = movedOn ? Math.max(config.session.emptyLeaveMs, config.session.pullGraceMs) : config.session.emptyLeaveMs;
        logger.info(`[${guildId}] All members left voice — leaving in ${wait / 1000}s unless someone returns`);
        startAutoLeaveTimer(guildId, wait, { empty: true, graceMs: movedOn ? wait : 0 });
        await deletePanel(guildId);   // nobody is listening → remove the control panel from the channel
      }
    }

    // ── 4. A member arrived in the bot's channel — the "room is empty" countdown no longer applies ─
    // FIX: the original code only started the timer on empty channel but never
    // cancelled it when someone came back.  Covers two sub-cases:
    //   a) fresh join (oldState.channelId = null → newState.channelId = bot's ch)
    //   b) move from another channel into the bot's channel (both channelIds set)
    // We key on newState.channelId matching the session channel — that is the only
    // condition that matters; where the member was before is irrelevant.
    if (newState.channelId && newState.member && !newState.member.user.bot) {
      const guildId = newState.guild.id;
      const session = getSession(guildId);
      if (session && session.voiceChannelId === newState.channelId) {
        onListenerArrived(guildId);   // only replaces the "room is empty" timer; idle/paused timers keep running
      }
    }
  }
};
