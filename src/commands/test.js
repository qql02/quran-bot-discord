import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } from 'discord.js';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { COLORS } from '../utils/embeds.js';
import { getAllSessions, MAX_SESSIONS } from '../managers/sessionManager.js';
import { fetchReciters } from '../services/quranService.js';
import { findFfmpeg } from '../services/sources/ffmpegSource.js';
import { buildAdhkarEmbeds, sendAdhkar, sendScatter, buildScatterEmbed } from '../services/adhkarService.js';
import { fetchAyah, buildAyahMessage, sendAyah } from '../services/ayahService.js';
import { buildEventMessage, sendEvent } from '../services/eventService.js';
import { ayahRefForDate } from '../data/ayahs.js';
import { buildHadithMessage, sendHadith } from '../services/hadithService.js';
import { hadithForDate } from '../data/hadiths.js';
import * as wirdUi from '../utils/wirdUi.js';

/**
 * /owner — bot owner only (ADMIN_IDS). Everything here is a PREVIEW or a delivery check:
 *   • nothing is written to the database, no real subscription / schedule / claim is touched;
 *   • previews are ephemeral; `post: true` sends the real message to THIS channel so the real delivery path
 *     (channel lookup, permissions, mentions, embeds) is exercised too.
 */
const EPH = MessageFlags.Ephemeral;
const isOwner = (i) => config.admin.ids.includes(i.user.id);
const todayUtc = () => new Date().toISOString().slice(0, 10);
const OK = '✅', BAD = '❌', WARN = '⚠️';

const postOpt = (o) => o.setName('post').setDescription('Send it for real in this channel (tests delivery) / أرسلها فعلياً في هذه القناة');

export default {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('🛠 Owner only: health check & previews / للمالك فقط: فحص ومعاينة')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('health').setDescription('Check database, API, ffmpeg, sessions, permissions / فحص شامل'))
    .addSubcommand(s => s.setName('khatma').setDescription('Preview the khatma completion messages / معاينة رسائل إتمام الختمة')
      .addIntegerOption(o => o.setName('number').setDescription('Khatma number to show / رقم الختمة').setMinValue(1).setMaxValue(999))
      .addIntegerOption(o => o.setName('days').setDescription('Days it took / عدد الأيام').setMinValue(1).setMaxValue(999))
      .addBooleanOption(postOpt))
    .addSubcommand(s => s.setName('adhkar').setDescription('Preview morning/evening adhkar / معاينة الأذكار')
      .addStringOption(o => o.setName('kind').setDescription('Which one / أيهما').setRequired(true)
        .addChoices({ name: 'Morning / الصباح', value: 'morning' }, { name: 'Evening / المساء', value: 'evening' }, { name: 'All-day dhikr / ذكر خلال اليوم', value: 'scatter' }))
      .addStringOption(o => o.setName('style').setDescription('Style / النمط')
        .addChoices({ name: 'Full / كامل', value: 'full' }, { name: 'Compact / مختصر', value: 'compact' }))
      .addBooleanOption(postOpt))
    .addSubcommand(s => s.setName('ayah').setDescription("Preview today's verse / معاينة آية اليوم").addBooleanOption(postOpt))
    .addSubcommand(s => s.setName('hadith').setDescription("Preview today's hadith / معاينة حديث اليوم").addBooleanOption(postOpt))
    .addSubcommand(s => s.setName('event').setDescription('Preview a religious-event post / معاينة منشور فعالية').addBooleanOption(postOpt))
    .addSubcommand(s => s.setName('wird').setDescription('Preview the wird (reading plan) messages / معاينة رسائل الورد')
      .addStringOption(o => o.setName('view').setDescription('Which message / أي رسالة').setRequired(true)
        .addChoices(
          { name: 'Reminder / التذكير', value: 'reminder' }, { name: 'Status / الحالة', value: 'status' },
          { name: 'Reading saved / تسجيل قراءة', value: 'reading' }, { name: 'Khatma done / تمام الختمة', value: 'khatma' },
          { name: 'Expiring / قارب الانتهاء', value: 'expiring' }, { name: 'Inactive / انقطاع', value: 'inactive' }
        ))),

  async execute(interaction) {
    if (!isOwner(interaction)) {
      return interaction.reply({ content: '🔒 هذا الأمر لمالك البوت فقط (`ADMIN_IDS`).', flags: EPH });
    }
    await interaction.deferReply({ flags: EPH });
    const sub = interaction.options.getSubcommand();
    const payloads = await HANDLERS[sub](interaction);
    await sendAll(interaction, payloads);
  }
};

/** First payload edits the deferred reply, the rest are follow-ups — all ephemeral. */
async function sendAll(interaction, payloads) {
  const [first, ...rest] = payloads;
  await interaction.editReply(first);
  for (const p of rest) await interaction.followUp({ ...p, flags: EPH });
}

const note = (text) => ({ content: text });
const withoutButtons = (p) => ({ ...p, components: [] });   // a preview must never carry live buttons that act on a real subscription

// ── health ───────────────────────────────────────────────────────────────────
async function timed(fn) {
  const t0 = Date.now();
  try { return { ok: true, ms: Date.now() - t0, value: await fn() }; }
  catch (err) { return { ok: false, ms: Date.now() - t0, error: err?.message ?? String(err) }; }
}

async function health(interaction) {
  const { client } = interaction;
  const lines = [];

  lines.push(`${client.ws.ping >= 0 ? (client.ws.ping < 400 ? OK : WARN) : WARN} **Gateway:** ${client.ws.ping >= 0 ? `${client.ws.ping}ms` : 'no heartbeat yet'}`);

  const mongo = await timed(async () => {
    if (mongoose.connection.readyState !== 1) throw new Error(`state=${mongoose.connection.readyState}`);
    await mongoose.connection.db.admin().ping();
  });
  lines.push(`${mongo.ok ? OK : BAD} **MongoDB:** ${mongo.ok ? `${mongo.ms}ms` : mongo.error}`);

  const api = await timed(() => fetchReciters('ar'));
  lines.push(`${api.ok && api.value?.length ? OK : BAD} **Quran API:** ${api.ok ? `${api.value?.length ?? 0} reciters · ${api.ms}ms` : api.error}`);

  const ff = await timed(() => findFfmpeg());
  lines.push(`${ff.ok && ff.value ? OK : WARN} **ffmpeg:** ${ff.ok && ff.value ? 'found' : 'not found (WASM fallback will be used)'}  · backend=\`${config.audio?.backend ?? 'auto'}\``);

  const sessions = getAllSessions();
  const playing = sessions.filter(s => s.status === 'playing').length;
  lines.push(`${sessions.length < MAX_SESSIONS ? OK : WARN} **Voice sessions:** ${sessions.length}/${MAX_SESSIONS} (${playing} playing)`);

  const mem = process.memoryUsage();
  lines.push(`${OK} **Memory:** ${(mem.rss / 1048576).toFixed(0)}MB RSS · **Uptime:** ${fmtUptime(process.uptime())} · **Servers:** ${client.guilds.cache.size}`);

  // Permissions in THIS channel and in the caller's voice channel
  const me = interaction.guild.members.me;
  const need = [['ViewChannel', 'View'], ['SendMessages', 'Send'], ['EmbedLinks', 'Embeds'], ['UseExternalEmojis', 'Ext. emojis']];
  const here = interaction.channel?.permissionsFor(me);
  const missing = need.filter(([f]) => !here?.has(PermissionFlagsBits[f])).map(([, n]) => n);
  lines.push(`${missing.length ? BAD : OK} **This channel:** ${missing.length ? `missing ${missing.join(', ')}` : 'all needed permissions present'}`);

  const vc = interaction.member?.voice?.channel;
  if (vc) {
    const vp = vc.permissionsFor(me);
    const vmiss = [['Connect', 'Connect'], ['Speak', 'Speak']].filter(([f]) => !vp?.has(PermissionFlagsBits[f])).map(([, n]) => n);
    lines.push(`${vmiss.length ? BAD : OK} **Your voice channel (${vc.name}):** ${vmiss.length ? `missing ${vmiss.join(', ')}` : 'can connect & speak'}`);
  } else {
    lines.push(`${WARN} **Voice channel:** join one to check Connect/Speak`);
  }

  const failed = lines.some(l => l.startsWith(BAD));
  const embed = new EmbedBuilder()
    .setColor(failed ? COLORS.error ?? 0xe74c3c : COLORS.gold)
    .setTitle(failed ? 'Health check — problems found' : 'Health check — all good')
    .setDescription(lines.join('\n'))
    .setTimestamp();
  return [{ embeds: [embed] }];
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

// ── previews ─────────────────────────────────────────────────────────────────
const resultLine = (r) => (r.ok ? `${OK} Sent for real in this channel.` : `${BAD} Delivery failed: \`${r.reason}\``);

async function khatma(interaction) {
  const number = interaction.options.getInteger('number') ?? 1;
  const days   = interaction.options.getInteger('days') ?? 31;
  const out = [
    note('**Message the member sees (DM / reply):**'),
    wirdUi.khatmaMessage({ khatmaCount: number }),
    note('**Public announcement in the wird room:**'),
    wirdUi.khatmaAnnouncement(interaction.user.id, number, days)
  ];
  if (interaction.options.getBoolean('post')) {
    try { await interaction.channel.send(wirdUi.khatmaAnnouncement(interaction.user.id, number, days)); out.push(note(`${OK} Announcement posted in this channel (it only mentions you).`)); }
    catch (err) { out.push(note(`${BAD} Could not post here: ${err.message}`)); }
  }
  return out;
}

async function adhkar(interaction) {
  const kind  = interaction.options.getString('kind', true);
  const style = interaction.options.getString('style') ?? 'full';
  if (kind === 'scatter') {
    if (interaction.options.getBoolean('post')) {
      const r = await sendScatter(interaction.client, interaction.guildId, interaction.channelId);
      return [note(resultLine(r))];
    }
    return [{ embeds: [buildScatterEmbed().embed] }];
  }
  if (interaction.options.getBoolean('post')) {
    const r = await sendAdhkar(interaction.client, interaction.guildId, interaction.channelId, kind, { style });
    return [note(resultLine(r))];
  }
  const embeds = buildAdhkarEmbeds(kind, style);
  return [{ embeds: embeds.slice(0, 10) }];
}

async function ayah(interaction) {
  const date = todayUtc();
  if (interaction.options.getBoolean('post')) {
    const r = await sendAyah(interaction.client, interaction.guildId, interaction.channelId, date);
    return [note(resultLine(r))];
  }
  const verse = await fetchAyah(ayahRefForDate(date));
  if (!verse) return [note(`${BAD} Could not fetch today's verse (${ayahRefForDate(date)}) — the verse API is unreachable right now.`)];
  return [buildAyahMessage(verse)];
}

async function hadith(interaction) {
  const date = todayUtc();
  if (interaction.options.getBoolean('post')) {
    const r = await sendHadith(interaction.client, interaction.guildId, interaction.channelId, date);
    return [note(resultLine(r))];
  }
  return [buildHadithMessage(hadithForDate(date))];
}

async function event(interaction) {
  const ev = {
    _id: 'test', guildId: interaction.guildId, channelId: interaction.channelId, roleId: null,
    title: 'فعالية تجريبية', description: 'هذه رسالة تجريبية للتأكد من شكل منشورات الفعاليات.'
  };
  if (interaction.options.getBoolean('post')) {
    const r = await sendEvent(interaction.client, ev, null);
    return [note(resultLine(r))];
  }
  return [buildEventMessage(ev, null)];
}

async function wird(interaction) {
  const now  = new Date();
  const view = interaction.options.getString('view', true);
  const sub  = {
    userId: interaction.user.id, guildId: interaction.guildId, active: true,
    expiresAt: new Date(+now + (view === 'expiring' ? 2 : 20) * 864e5),
    pagesPerDay: 2, timezone: 'UTC', remindTime: '20:00', remindMode: 'varied',
    currentPage: 300, khatmaCount: 3, totalPagesRead: 2400, streak: 12, bestStreak: 30,
    lastReadDate: null, dayDate: null, dayPages: 0, startedAt: now, khatmaStartedAt: now
  };
  const build = {
    reminder: () => wirdUi.reminderMessage(sub, now),
    status:   () => wirdUi.statusMessage(sub, now),
    reading:  () => wirdUi.readingMessage(sub, { added: 2, completedKhatma: false, dayDone: true, newlyDone: true, set: { currentPage: 302 } }, now),
    khatma:   () => wirdUi.khatmaMessage({ ...sub, khatmaCount: 4 }),
    expiring: () => wirdUi.expiringMessage(sub),
    inactive: () => wirdUi.inactiveMessage(sub)
  };
  return [note('Sample data — your real subscription is not touched.'), withoutButtons(build[view]())];
}

const HANDLERS = { health, khatma, adhkar, ayah, hadith, event, wird };
