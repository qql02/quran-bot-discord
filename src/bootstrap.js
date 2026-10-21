import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config, configIssues } from './config.js';
import { createCrashGuard } from './utils/crashGuard.js';
import { logger }        from './utils/logger.js';
import { connectMongo }  from './services/mongoService.js';
import { loadCommands }  from './handlers/commandHandler.js';
import { loadEvents }    from './handlers/eventHandler.js';
import { startApiServer } from './api/server.js';
import { initAudio }     from './services/audioService.js';
import { registerShutdown } from './services/shutdown.js';
import { buildCacheOptions } from './utils/discordCache.js';
import { startAdhkarScheduler } from './services/adhkarService.js';
import { startAyahScheduler }   from './services/ayahService.js';
import { startHadithScheduler } from './services/hadithService.js';
import { startWirdScheduler }   from './services/wirdService.js';
import { startEventScheduler }  from './services/eventService.js';
import { startControl, getControlSync } from './services/controlService.js';
import { setHiddenRecitersSource } from './services/quranService.js';
import { startSiblingSync, getSecondaryBots } from './services/siblingService.js';
import { startJobWorker }       from './services/playerJobs.js';
import { getAllSessions }       from './managers/sessionManager.js';
import { checkEnv, printEnvReport } from './utils/startupCheck.js';
import { existsSync }          from 'fs';
import { startSecondBot }      from './services/secondBotLauncher.js';
import { registerSecondBot, isSecondBotPaused } from './services/secondBotControl.js';
import { watchParent }         from './utils/parentWatch.js';
import { startMemoryJanitor }  from './services/memoryJanitor.js';

// ─── Validate Environment ──────────────────────────────────────────────────────
// All parsing/validation lives in src/config.js — here we only report the result.
printEnvReport(logger, checkEnv(process.env, { hasEnvFile: existsSync('.env') }));   // every variable, ok / missing / wrong, in plain words
configIssues.warnings.forEach(w => logger.warn(`⚠️  Config: ${w}`));
if (configIssues.errors.length) {
  configIssues.errors.forEach(e => logger.error(`❌ Config: ${e}`));
  process.exit(1);
}

// ─── Discord Client ────────────────────────────────────────────────────────────
// BOT_ROLE=secondary is a voice-only player: no slash commands, no private-chat commands, no dashboard. It needs servers + voice states only.
const voiceOnly = config.bot.role === 'secondary';
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    ...(voiceOnly ? [] : [GatewayIntentBits.DirectMessages])     // prefix commands in the bot's private chat (DM text is delivered without the privileged MessageContent intent)
    // GuildMessages removed: the bot has no messageCreate handler, and with the intent discord.js caches
    // up to 200 messages per channel in EVERY server (the main source of RAM growth over time).
  ],
  partials: voiceOnly ? [] : [Partials.Channel],
  // RAM policy lives in one place — see src/utils/discordCache.js for what is dropped and why.
  ...buildCacheOptions(() => client)
});

// Discord-side problems that discord.js only emits as events (nothing is printed unless we listen).
client.on('error',  e => logger.error('Discord client error:', e));
client.on('warn',   m => logger.warn(`Discord warning: ${m}`));
client.on('shardError', e => logger.error('Discord connection error (shard):', e));
client.on('shardDisconnect', (ev, id) => logger.warn(`Discord shard ${id} disconnected (code ${ev?.code ?? '?'})`));
client.on('shardReconnecting', id => logger.warn(`Discord shard ${id} reconnecting…`));
client.on('shardResume', id => logger.info(`Discord shard ${id} resumed`));
client.on('invalidated', () => { logger.error('Discord session invalidated — exiting for a clean restart'); process.exit(1); });

// Second bot started by the main bot: leave when the main bot is gone (no orphan copies after a hard kill).
watchParent(process.env.SECOND_BOT_PARENT_PID, () => { logger.warn('The main bot is gone — shutting the second bot down'); process.kill(process.pid, 'SIGTERM'); });

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  logger.info('🕌 Starting Quran Bot (local audio engine)...');

  await connectMongo();
  setHiddenRecitersSource(() => getControlSync().hiddenReciters);   // reciters the owner hid
  startControl();                   // owner's global controls (disabled commands / features, moderator rights)
  await loadCommands(client);
  await loadEvents(client);

  // Register BEFORE login so the event can never be missed.
  client.once('clientReady', () => {
    if (!voiceOnly) startApiServer(client);   // the owner dashboard lives on the main bot only (the voice-only bot opens no port)
    initAudio(client);   // verifies ffmpeg, then restores saved sessions
    void startMemoryJanitor({ client }).catch(err => logger.warn(`Memory janitor not started: ${err.message}`));   // periodic cache trimming, zombie sessions, stray ffmpeg (both bots)
    if (config.bot.role !== 'secondary') {                                                    // SECOND_BOT_TOKEN → the second bot runs from this same project
      void (async () => {
        const startPaused = await isSecondBotPaused().catch(() => false);                      // the owner switched it OFF in the dashboard: it stays off after a restart
        registerSecondBot(startSecondBot({ logger, primaryId: client.user.id, startPaused }));
      })();
    }
    startSiblingSync(client, getAllSessions);   // tell the other bot(s) on this database which rooms we are reciting in
    // A while after start (the other bot publishes itself to the shared database), say plainly whether a second bot exists.
    setTimeout(async () => {
      try {
        if (config.bot.role === 'secondary') return;
        const bots = await getSecondaryBots();
        if (bots.length) logger.success(`Second bot(s) registered: ${bots.map(b => `${b.tag ?? b.id}${b.alive ? ' (online)' : ' (offline)'}`).join(', ')}`);
        else logger.warn('No second bot is registered in the database yet — it appears automatically once a BOT_ROLE=secondary bot with the same MONGODB_URI is running (or set SECOND_BOT_TOKEN to run it from this project; ALT_BOT_ID only shows the 🎧 invite button earlier). Without one, /pull works only when you were alone in the old room');
      } catch (e) { logger.error('Second-bot check failed:', e); }
    }, 25_000).unref();
    if (config.bot.role === 'secondary') {
      // The primary bot owns every scheduled post/DM; running them here too would send each one twice.
      logger.info('BOT_ROLE=secondary — scheduled posts (adhkar, verse/hadith of the day, wird, events) are left to the primary bot');
      startJobWorker(client);   // recitation requests handed over by the main bot (same database)
    } else {
      startAdhkarScheduler(client);   // daily morning/evening adhkar auto-post
      startAyahScheduler(client);     // verse of the day (own channel)
      startHadithScheduler(client);   // hadith of the day (own channel)
      startWirdScheduler(client);     // daily wird reminders + free monthly subscriptions
      startEventScheduler(client);    // admin-scheduled religious events (Ramadan activities, ...)
    }
  });

  await client.login(config.discord.token);
}

// ─── Global Error Handling ─────────────────────────────────────────────────────
process.on('warning', (w) => logger.warn(`Node warning: ${w.name}: ${w.message}`));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

// One stray exception is logged and the bot carries on; a burst means the process is unhealthy → exit so the
// host restarts a clean one (needs auto-restart enabled on the host, otherwise the bot stays down).
const crashGuard = createCrashGuard({ limit: 5, windowMs: 60_000 });
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err.message, err.stack);
  if (crashGuard.record()) {
    logger.error(`${crashGuard.count} uncaught exceptions within 60s — exiting for a clean restart`);
    process.exit(1);
  }
});

registerShutdown(client);   // SIGINT / SIGTERM / SIGHUP → leave voice cleanly (no ghost connections)

bootstrap().catch(err => {
  logger.error('Bootstrap failed:', err);
  process.exit(1);
});
