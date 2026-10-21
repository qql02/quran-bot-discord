import { logger } from '../utils/logger.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { Blacklist } from '../models/Blacklist.js';
import { hasArabic } from '../utils/arabic.js';
import { pickAnnouncementChannel } from '../utils/channels.js';
import { buildWelcomeMessage } from '../utils/welcome.js';
import { isFeatureOn } from '../utils/botControl.js';
import { getControlSync } from '../services/controlService.js';
import { config } from '../config.js';
import { notifySessionsChanged } from '../services/siblingService.js';

export default {
  name: 'guildCreate',

  async execute(guild) {
    // ── Blacklist check — leave immediately if this guild is banned ─────────
    try {
      const banned = await Blacklist.isBanned(guild.id);
      if (banned) {
        logger.warn(`[Blacklist] Joined banned guild ${guild.name} (${guild.id}) — leaving immediately`);
        if (guild.client._pushActivity) {
          guild.client._pushActivity('ban', `رفض انضمام سيرفر محظور: ${guild.name}`, 'محظور');
        }
        await guild.leave().catch(() => {});
        return;
      }
    } catch (err) {
      logger.error('[guildCreate] Blacklist check failed:', err.message);
      // On DB error, allow join — better than leaving valid guilds
    }

    logger.success(`Joined guild: ${guild.name} (${guild.id}) | Members: ${guild.memberCount}`);
    notifySessionsChanged();                       // the registry (guild list) is refreshed at once
    // The voice-only second bot joins quietly: no welcome message and no settings document (those belong to the main bot).
    if (config.bot.role === 'secondary') return;
    // First time we see this guild → pick a sensible default language and say hello once.
    // (guildCreate can fire again on gateway re-syncs; the settings document is the "already greeted" marker.)
    const known = await GuildSettings.exists({ guildId: guild.id }).catch(() => true);
    if (!known) {
      const language = hasArabic(guild.name) || hasArabic(guild.description) ? 'ar' : 'en';
      const created  = await GuildSettings.create({ guildId: guild.id, language }).then(() => true).catch(() => false);
      if (created) {
        try {
          const channel = isFeatureOn(getControlSync(), 'welcome') ? pickAnnouncementChannel(guild) : null;
          await channel?.send(buildWelcomeMessage());
        } catch (err) {
          logger.warn(`[${guild.id}] Welcome message failed: ${err.message}`);
        }
      }
    }
    // Push to activity log
    if (guild.client._pushActivity) {
      guild.client._pushActivity('join', `انضم البوت لسيرفر: ${guild.name}`, `${guild.memberCount} عضو`);
    }
  }
};
