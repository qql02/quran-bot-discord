import { reportError } from '../utils/errorReporter.js';
import { logger } from '../utils/logger.js';
import { Blacklist } from '../models/Blacklist.js';
import { buildErrorEmbed } from '../utils/embeds.js';
import { getSession } from '../managers/sessionManager.js';
import { config } from '../config.js';
import { getRestrictions } from '../utils/guildRestrictions.js';
import { blockedBy } from '../utils/restrictionRules.js';
import { globalBlockedBy } from '../utils/botControl.js';
import { getControlSync } from '../services/controlService.js';
import { guideHome, GUIDE_DM_PREFIX } from '../panels/guide.js';

const ADMIN_IDS = config.admin.ids;

// ── Per-user cooldown — stops a single account flooding commands/buttons (each one can hit the
//    Quran API, Mongo and the voice engine). Autocomplete is exempt; owners are exempt.
const COOLDOWN_MS = { command: 2000, button: 800 };
const lastUse = new Map();                       // `${userId}:${kind}` → timestamp
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, ts] of lastUse) if (ts < cutoff) lastUse.delete(k);
}, 5 * 60_000).unref?.();

// Autocomplete fires on every keystroke and hits cache + Mongo. A normal typist stays well under
// this; a modified client hammering the endpoint just gets empty answers.
const acWindow = new Map();   // userId → { start, count }
function acFlooded(userId) {
  const now = Date.now();
  const w = acWindow.get(userId);
  if (!w || now - w.start > 2000) { acWindow.set(userId, { start: now, count: 1 }); return false; }
  return ++w.count > 12;
}
setInterval(() => {
  const cutoff = Date.now() - 10_000;
  for (const [k, w] of acWindow) if (w.start < cutoff) acWindow.delete(k);
}, 60_000).unref?.();

function onCooldown(interaction) {
  const kind = interaction.isChatInputCommand() ? 'command' : (interaction.isButton() || interaction.isStringSelectMenu?.()) ? 'button' : null;
  if (!kind || ADMIN_IDS.includes(interaction.user.id)) return false;
  const key = `${interaction.user.id}:${kind}`;
  const now = Date.now();
  if (now - (lastUse.get(key) ?? 0) < COOLDOWN_MS[kind]) return true;
  lastUse.set(key, now);
  return false;
}

// ── Safety net: a press that nobody answers shows Discord's "This interaction failed". That happens with a button from before a restart,
//    one whose waiting code already timed out, or an id no handler knows. `answerIfStale` checks after a short wait (the handler has
//    returned by then, so nobody else is going to answer) and tells the person what to do. It never touches an interaction that was
//    answered, deferred or got a modal.
const STALE_WAIT_MS = 2500;
const STALE = (i) => (isArabicUi(i) ? '⌛ هذه اللوحة قديمة أو انتهت مدتها. افتح لوحة جديدة بكتابة `/help`.' : '⌛ This panel is out of date or has expired. Open a fresh one with `/help`.');
const GONE  = (i) => (isArabicUi(i) ? '⚠️ هذا الأمر لم يعد متاحاً. اكتب `/help` لرؤية ما يمكنك فعله.' : '⚠️ This command is no longer available. Type `/help` to see what you can do.');
export function answerIfStale(interaction, { wait = STALE_WAIT_MS, text = STALE } = {}) {
  const check = () => {
    try {
      if (!interaction.isRepliable?.() || interaction.replied || interaction.deferred) return;
      interaction.reply({ content: text(interaction), ephemeral: true }).catch(() => {});
    } catch { /* best effort */ }
  };
  if (wait <= 0) return check();
  setTimeout(check, wait).unref?.();
}

// ── /wird buttons & modals work in DMs too (the reminder arrives there), so they are routed BEFORE the "servers
//    only" guard. Every button acts on the presser's OWN subscription — never on someone else's.
const isWird = (i) => (i.isMessageComponent?.() || i.isModalSubmit?.()) && i.customId?.startsWith('wird:');

// ── /mushaf reader buttons: also work in DMs (the reminder's "اقرأ هنا" button lives there). Page turning has its own,
//    lighter limit so reading feels instant, while the API stays protected by the page cache.
const MUSHAF_COOLDOWN_MS = 350;
const mushafLast = new Map();
setInterval(() => { const cutoff = Date.now() - 60_000; for (const [k, ts] of mushafLast) if (ts < cutoff) mushafLast.delete(k); }, 5 * 60_000).unref?.();
const isMushaf = (i) => (i.isMessageComponent?.() || i.isModalSubmit?.()) && i.customId?.startsWith('mushaf:');

async function routeMushaf(interaction, client) {
  if (!interaction.isModalSubmit?.() && !ADMIN_IDS.includes(interaction.user.id)) {
    const now = Date.now();
    if (now - (mushafLast.get(interaction.user.id) ?? 0) < MUSHAF_COOLDOWN_MS) {
      return interaction.reply({ content: SLOW_DOWN(interaction), ephemeral: true }).catch(() => {});
    }
    mushafLast.set(interaction.user.id, now);
  }
  try {
    const { handleMushaf } = await import('../components/mushafHandler.js');
    await handleMushaf(interaction, client);
    answerIfStale(interaction);
  } catch (err) {
    if (err?.code === 10062 || err?.code === 40060) return;      // expired / already answered
    logger.error(`[mushaf] ${interaction.customId} failed (user=${interaction.user?.id}): ${err?.message}\n${err?.stack ?? ''}`);
    const payload = { embeds: [buildErrorEmbed(UNEXPECTED(interaction), isArabicUi(interaction) ? 'ar' : 'en')], ephemeral: true };
    (interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload)).catch(() => {});
  }
}

// Generic fallbacks (cool-down, unexpected error) have no member record to read a language from, so they follow the
// language of the member's Discord app.
const isArabicUi = (i) => String(i.locale ?? '').toLowerCase().startsWith('ar');
const SLOW_DOWN  = (i) => (isArabicUi(i) ? 'أبطئ قليلاً.' : 'Slow down a little.');
const UNEXPECTED = (i) => (isArabicUi(i) ? 'حدث خطأ غير متوقع، حاول مرة أخرى بعد قليل.' : 'Something unexpected went wrong. Please try again in a moment.');

async function routeWird(interaction, client) {
  if ((interaction.isButton() || interaction.isStringSelectMenu?.()) && onCooldown(interaction)) {
    return interaction.reply({ content: SLOW_DOWN(interaction), ephemeral: true }).catch(() => {});
  }
  try {
    const { handleWird } = await import('../components/wirdHandler.js');
    await handleWird(interaction, client);
    answerIfStale(interaction);
  } catch (err) {
    if (err?.code === 10062 || err?.code === 40060) return;      // expired / already answered
    logger.error(`[wird] ${interaction.customId} failed (user=${interaction.user?.id}): ${err?.message}\n${err?.stack ?? ''}`);
    const payload = { embeds: [buildErrorEmbed(UNEXPECTED(interaction), isArabicUi(interaction) ? 'ar' : 'en')], ephemeral: true };
    (interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload)).catch(() => {});
  }
}

// prefix of the custom id → the module that handles it (loaded on first use). `modals`: its forms come through here too.
const PANEL_ROUTES = [
  { prefix: 'hub:',      run: async (i) => (await import('../panels/hub.js')).handleHub(i) },
  { prefix: 'adhkar:',   run: async (i) => (await import('../panels/adhkarPanel.js')).handleAdhkarComponent(i) },
  { prefix: 'azkar:',    run: async (i) => (await import('../commands/azkar.js')).handleAzkarButton(i) },
  { prefix: 'hadith:',   run: async (i) => (await import('../commands/hadith.js')).handleHadithButton(i) },
  { prefix: 'journey:',  run: async (i) => (await import('../commands/journey.js')).handleJourneyButton(i) },
  { prefix: 'events:',   modals: true, run: async (i) => (await import('../panels/eventsPanel.js')).handleEventsComponent(i) },
  { prefix: 'stations:', modals: true, run: async (i) => (await import('../panels/stationsPanel.js')).handleStationsComponent(i) },
  { prefix: 'menu:',     run: async (i) => (await import('../panels/menu.js')).handleMenu(i) },
  { prefix: 'sbot:',     run: async (i) => (await import('../panels/secondBot.js')).handleSecondBot(i) }
];

export default {
  name: 'interactionCreate',

  async execute(interaction, client) {
    // ── Voice-only second bot: it answers ONLY the buttons/menus of its own player panel ──────────────────────────────
    // It has no slash commands (a leftover one would land here) and no other panels. Everything else is pointed to the main bot.
    if (config.bot.role === 'secondary') {
      const own = interaction.guildId && (interaction.isMessageComponent?.() || interaction.isModalSubmit?.()) && interaction.customId?.startsWith('panel:');
      if (!own) {
        if (interaction.isAutocomplete?.()) return interaction.respond([]).catch(() => {});
        if (interaction.isRepliable?.()) interaction.reply({ content: '🎧 هذا البوت لتشغيل الصوت فقط — استخدم أوامر البوت الرئيسي · This bot only plays audio — use the main bot\'s commands.', ephemeral: true }).catch(() => {});
        return;
      }
    }

    // ── DMs: the bot only works inside servers (answer instead of "application did not respond") ──
    if (!interaction.guildId) {
      if (isWird(interaction)) return routeWird(interaction, client);
      if (isMushaf(interaction)) return routeMushaf(interaction, client);
      // The guide's topic menu in the bot's private chat (opened with the prefix command): the language is in the id.
      if (interaction.isStringSelectMenu?.() && interaction.customId?.startsWith(GUIDE_DM_PREFIX)) {
        const lang = interaction.customId.slice(GUIDE_DM_PREFIX.length) === 'ar' ? 'ar' : 'en';
        return interaction.update(guideHome(lang, interaction.values?.[0], { dm: true })).catch(() => {});
      }
      // /cleardm works in DMs too: its whole job is to remove the bot's messages from the person's DM.
      if (interaction.isChatInputCommand?.() && interaction.commandName === 'cleardm') {
        try { return await client.commands.get('cleardm')?.execute(interaction, client); }
        catch (err) { return reportError(interaction, err, 'cmd:clear'); }
      }
      if (interaction.isRepliable?.() && !interaction.isAutocomplete()) {
        interaction.reply({ content: '🕌 البوت يعمل داخل السيرفرات فقط · This bot only works inside servers.', ephemeral: true }).catch(() => {});
      } else if (interaction.isAutocomplete?.()) {
        interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (interaction.isAutocomplete() && acFlooded(interaction.user.id)) {
      return interaction.respond([]).catch(() => {});
    }

    // ── Blacklist check — uses in-memory cache, no DB hit per interaction ───
    try {
      const banned = await Blacklist.isBanned(interaction.guildId);
      if (banned) {
        logger.warn(`[Blacklist] Blocked interaction from banned guild: ${interaction.guildId}`);
        if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => {});
        interaction.reply({ content: '🚫 هذا السيرفر محظور من استخدام البوت.', ephemeral: true }).catch(() => {});
        return;
      }
    } catch (err) {
      logger.error('[Blacklist] Cache check failed:', err.message);
      // On DB error, allow through — don't block valid guilds
    }

    // ── Maintenance mode — block non-admins ─────────────────────────────────
    if (client._maintenanceMode && !ADMIN_IDS.includes(interaction.user.id)) {
      if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => {});
      interaction.reply({ content: '🔧 البوت في وضع الصيانة حالياً، يرجى المحاولة لاحقاً.', ephemeral: true }).catch(() => {});
      return;
    }

    // ── Global controls (owner → dashboard): disabled commands / features everywhere, global lock ─────────────
    // Owners are exempt. Reads an in-memory copy, so it cannot fail or slow anything down.
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      const ctl  = getControlSync();
      const kind = interaction.isAutocomplete() ? 'autocomplete' : interaction.isChatInputCommand() ? 'command' : 'component';
      const why  = globalBlockedBy(ctl, { kind, name: interaction.commandName, customId: interaction.customId });
      if (why) {
        if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => {});
        const note = ctl.note ? `\n${ctl.note}` : '';
        const msg  = why === 'global-locked'
          ? `🔒 البوت في وضع القراءة فقط مؤقتاً من قِبل إدارة البوت.${note}`
          : why === 'global-feature'
            ? `⛔ هذه الميزة متوقفة مؤقتاً من قِبل إدارة البوت.${note}`
            : `⛔ هذا الأمر متوقف مؤقتاً من قِبل إدارة البوت.${note}`;
        interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
        return;
      }
    }

    // ── Per-server restrictions (owner → dashboard): locked / disabled commands / shorter queue ─────────────
    // Owners are exempt. A database hiccup never blocks anyone (fails open).
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      try {
        const rs = await getRestrictions(interaction.guildId);
        const live = getSession(interaction.guildId);
        if (live) live.queueCap = rs.maxQueue;                       // read by sessionManager.enqueue()
        const kind = interaction.isAutocomplete() ? 'autocomplete' : interaction.isChatInputCommand() ? 'command' : 'component';
        const why  = blockedBy(rs, { kind, name: interaction.commandName, customId: interaction.customId, values: interaction.values });
        if (why) {
          if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => {});
          const note = rs.note ? `\n${rs.note}` : '';
          const msg  = why === 'locked'
            ? `🔒 تم تعطيل استخدام البوت في هذا السيرفر من قِبل إدارة البوت.${note}`
            : `⛔ هذا الأمر معطّل في هذا السيرفر من قِبل إدارة البوت.${note}`;
          interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
          return;
        }
      } catch (err) { logger.warn(`[restrictions] check failed: ${err.message}`); }
    }

    // ── Daily wird (persistent buttons on reminders and on the room panel) ──────────
    if (isWird(interaction)) return routeWird(interaction, client);
    if (isMushaf(interaction)) return routeMushaf(interaction, client);

    // ── The rooms flow's confirm buttons (setup:) and the adhkar page's forms (adhkar: modals) are awaited by their own code ─────
    // If that waiting code is gone (restart, timeout) nobody answers: the safety net does.
    if (interaction.isMessageComponent?.() && interaction.customId?.startsWith('setup:')) return answerIfStale(interaction);
    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('adhkar:')) return answerIfStale(interaction);

    // ── Flood protection ────────────────────────────────────────────────────
    if (onCooldown(interaction)) {
      interaction.reply({ content: '⏳ أبطئ قليلاً / Slow down a little.', ephemeral: true }).catch(() => {});
      return;
    }

    // ── Panels: /setup (hub:, adhkar:, events:, stations:) and /help (menu:) — every press is its own stateless interaction ──
    const panelRoute = PANEL_ROUTES.find(r => (interaction.isMessageComponent?.() || interaction.isModalSubmit?.()) && interaction.customId?.startsWith(r.prefix));
    if (panelRoute) {
      if (interaction.isModalSubmit() && !panelRoute.modals) return answerIfStale(interaction, { wait: 0 });
      try {
        await panelRoute.run(interaction);
        answerIfStale(interaction);
      } catch (err) {
        await reportError(interaction, err, `panel:${panelRoute.prefix}${interaction.customId.split(':')[1] ?? ''}`);
      }
      return;
    }

    // ── Slash Commands ──────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return answerIfStale(interaction, { wait: 0, text: GONE });   // still registered in Discord but removed from the bot

      try {
        await command.execute(interaction, client);
        const s = getSession(interaction.guildId); if (s) s.textChannelId = interaction.channelId;
      } catch (err) {
        await reportError(interaction, err, `cmd:${interaction.commandName}`);
      }
      return;
    }

    // ── Autocomplete ────────────────────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction, client);
      } catch (err) {
        if (err.code === 40060 || err.code === 10062) return;
        logger.error(`Autocomplete /${interaction.commandName} error:`, err);
        interaction.respond([]).catch(() => {});
      }
      return;
    }

    // ── Button Interactions ─────────────────────────────────────────────────
    if (interaction.isButton() || ((interaction.isStringSelectMenu?.() || interaction.isModalSubmit?.()) && interaction.customId?.startsWith('panel:'))) {
      try {
        const { handleButton } = await import('../components/buttonHandler.js');
        await handleButton(interaction, client);
        const s = getSession(interaction.guildId); if (s) s.textChannelId = interaction.channelId;
        answerIfStale(interaction);                          // an id no handler knows (an old panel) must not end in "interaction failed"
      } catch (err) {
        await reportError(interaction, err, `btn:${interaction.customId.split(':').slice(0, 2).join(':')}`);
      }
      return;
    }

    // ── Anything else that was pressed/submitted and matched no route above (a select menu or form of an old panel) ──
    if (interaction.isMessageComponent?.() || interaction.isModalSubmit?.()) answerIfStale(interaction, { wait: 0 });
  }
};
