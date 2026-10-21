import { ActivityType } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { syncCommands } from '../utils/commandDeploy.js';
import { useLogoAsThumbnail } from '../utils/botLogo.js';
import { startExtraReciters } from '../services/extraReciters.js';
import { startMushafImages } from '../services/mushafImages.js';

// ── Auto-deploy slash commands if they changed — always into ONE place (DEPLOY_SCOPE) ──
async function autoDeployCommands(client) {
  try {
    await syncCommands({
      token:         config.discord.token,
      appId:         client.application.id,
      scope:         config.discord.deployScope,
      guildId:       config.discord.guildId,
      commands:      [...client.commands.values()].map(c => c.data.toJSON()),
      onlyIfChanged: true,
      log:           m => logger.info(m)
    });
  } catch (err) {
    logger.error('Auto-deploy commands failed:', err.message);
  }
}

export default {
  name:  'clientReady',   // discord.js v14.22+: 'ready' is deprecated (it clashes with the gateway READY event)
  once:  true,

  async execute(client) {
    logger.success(`✅ Logged in as ${client.user.tag}`);
    logger.info(`Serving ${client.guilds.cache.size} guild(s)`);
    await useLogoAsThumbnail(client);
    void startExtraReciters().catch(err => logger.warn(`extra reciters: ${err.message}`));   // background: never delays the bot
    if (config.bot.role !== 'secondary') void startMushafImages().catch(err => logger.warn(`mushaf images: ${err.message}`));     // background: downloads only the missing page pictures (the voice-only bot has no Mushaf reader)

    client.user.setPresence({
      status: 'online',
      activities: [{
        name:  'Custom Status',
        type:  ActivityType.Custom,
        state: config.bot.activity
      }]
    });

    if (config.bot.role !== 'secondary') await autoDeployCommands(client);   // the voice-only bot never registers slash commands
    // Note: session recovery runs in audioService.js (initAudio) once ffmpeg is verified
  }
};
