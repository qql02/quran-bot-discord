import { Options } from 'discord.js';

/**
 * discord.js client cache policy — keeps RAM flat as the bot joins more servers.
 *
 * This bot only needs: guilds, channels + roles (permission checks), voice states, and the bot's own member.
 * Everything else discord.js caches by default is dead weight:
 *   • messages        — 200 per channel in EVERY server (~640KB per active channel, measured)
 *   • emojis/stickers/scheduled events/stage instances/invites/bans — ~20% of a guild's memory, never read
 * Members and users that are NOT needed are swept periodically (see `sweepers` below).
 *
 * Roles, channels, voice states and the bot member are deliberately left alone:
 * voice code and permissionsFor() read them, and a null there would crash.
 */
/**
 * Empty the discord.js caches that are safe to rebuild, right now (the memory janitor calls this under memory pressure — the
 * periodic sweepers below only run every 10–15 minutes). Same rules as the sweepers: the bot itself and anyone in a voice channel stay.
 * @returns {number} how many entries were dropped
 */
export function sweepClientNow(client) {
  const botId = client?.user?.id;
  let n = 0;
  try { n += client.sweepers.sweepMessages(() => true); } catch { /* best effort */ }
  try { n += client.sweepers.sweepGuildMembers((m) => m.id !== botId && !m.voice?.channelId); } catch { /* best effort */ }
  try { n += client.sweepers.sweepUsers((u) => u.id !== botId && !client.guilds.cache.some(g => g.members.cache.has(u.id))); } catch { /* best effort */ }
  return n;
}

export function buildCacheOptions(getClient) {
  const botId = () => getClient()?.user?.id;

  return {
    makeCache: Options.cacheWithLimits({
      MessageManager:             0,   // also covers guild + DM message managers
      ReactionManager:            0,
      PresenceManager:            0,
      GuildEmojiManager:          0,
      BaseGuildEmojiManager:      0,
      GuildStickerManager:        0,
      GuildScheduledEventManager: 0,
      StageInstanceManager:       0,
      GuildInviteManager:         0,
      GuildBanManager:            0,
      ThreadMemberManager:        0,
      AutoModerationRuleManager:  0,
      EntitlementManager:         0
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      // Members that arrived through interactions pile up forever. Keep the bot itself and anyone currently in a
      // voice channel (voiceStateUpdate / auto-leave read channel.members, which resolves through this cache).
      guildMembers: {
        interval: 600,
        filter: () => (m) => m.id !== botId() && !m.voice?.channelId
      },
      // A user is only dropped when no cached member anywhere still points at it (GuildMember#user resolves here).
      users: {
        interval: 900,
        filter: () => (u) => u.id !== botId() && !getClient().guilds.cache.some(g => g.members.cache.has(u.id))
      }
    }
  };
}
