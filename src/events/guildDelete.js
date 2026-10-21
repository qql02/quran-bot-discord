import { logger } from '../utils/logger.js';
import { destroySession } from '../managers/sessionManager.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Statistics } from '../models/Statistics.js';
import { SessionSnapshot } from '../models/SessionSnapshot.js';
import { Favorites } from '../models/Favorites.js';
import { ReligiousEvent } from '../models/ReligiousEvent.js';
import { CustomStation } from '../models/CustomStation.js';
import { WirdSubscription } from '../models/WirdSubscription.js';
import { config } from '../config.js';
import { siblingStillInGuild, notifySessionsChanged } from '../services/siblingService.js';

export default {
  name: 'guildDelete',

  async execute(guild) {
    logger.warn(`Left guild: ${guild.name} (${guild.id})`);
    notifySessionsChanged();
    await destroySession(guild.id).catch(() => {});
    await SessionSnapshot.remove(guild.id).catch(() => {});   // this bot's own snapshot only (snapshots are per bot)

    // Two bots share ONE database. The server's settings, favourites, stations, statistics… belong to the server, not to this bot:
    // they are deleted only when no other bot of this database is left in the server. The voice-only second bot never deletes them,
    // and when the database cannot say whether a sibling remains, nothing is deleted (a skipped cleanup is harmless, a wrong one is not).
    if (config.bot.role === 'secondary' || await siblingStillInGuild(guild.id)) {
      logger.info(`[${guild.id}] Another bot of this database is still in the server (or this is the voice-only bot) — shared server data kept`);
      guild.client._pushActivity?.('leave', `غادر البوت سيرفر: ${guild.name}`, `ID: ${guild.id}`);
      return;
    }

    // Clean up all stored data for this guild
    const results = await Promise.allSettled([
      GuildSettings.deleteOne({ guildId: guild.id }),
      Statistics.deleteOne({ guildId: guild.id }),
      Favorites.deleteMany({ guildId: guild.id }),
      ReligiousEvent.deleteMany({ guildId: guild.id }),
      CustomStation.deleteMany({ scope: 'guild', guildId: guild.id }),
      // Wird members are global (their progress follows them): only forget the server they subscribed in.
      WirdSubscription.updateMany({ guildId: guild.id }, { $set: { guildId: null } })
    ]);

    // FIX Bug #8: Log any cleanup failures so they don't vanish silently
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const label = ['GuildSettings', 'Statistics', 'Favorites', 'ReligiousEvent', 'CustomStation', 'WirdSubscription'][i];
        logger.error(`[${guild.id}] Cleanup failed for ${label}:`, r.reason?.message ?? r.reason);
      }
    });

    logger.info(`[${guild.id}] Guild data cleaned up`);

    // Push to activity log
    if (guild.client._pushActivity) {
      guild.client._pushActivity('leave', `غادر البوت سيرفر: ${guild.name}`, `ID: ${guild.id}`);
    }
  }
};
