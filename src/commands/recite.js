import { SlashCommandBuilder } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { ensureSession } from '../utils/ensureSession.js';
import { syncPanel, sendVoicePanel } from '../utils/panelRegistry.js';
import { SURAHS, getSurahByName, getSurahByNumber, searchSurahs, surahLabel } from '../data/surahs.js';
import { enqueue, playNext, clearQueue, skipSession } from '../managers/sessionManager.js';
import { findDefaultReciter, searchReciters, findReciter, getPlayableUrls, reciterAutocompleteFor } from '../services/quranService.js';

const MAX_SUGGESTIONS = 5;
const name = (r) => r.displayName ?? r.englishName ?? r.name;

/**
 * /recite — a surah and/or a reciter found by typing his name (the list answers as you type).
 *   surah + reciter → that surah · surah only → server's reciter · reciter only → the whole Quran, Al-Fatiha to An-Nas (a Khatma).
 */
export default {
  data: new SlashCommandBuilder()
    .setName('recite')
    .setDescription('Play a surah, optionally by a reciter you search by name / شغّل سورة بقارئ تبحث عنه بالاسم')
    .setDMPermission(false)
    .addStringOption(o => o.setName('surah').setDescription('Surah (empty = whole Quran) / السورة (فارغة = كل القرآن)').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('reciter').setDescription('Reciter name — type to search / اسم القارئ — اكتب للبحث').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'reciter') return interaction.respond(await reciterAutocompleteFor(interaction));
    const lang = await GuildSettings.getLanguage(interaction.guildId).catch(() => 'en');
    return interaction.respond(searchSurahs(String(focused.value ?? ''), lang).map(s => ({ name: surahLabel(s, lang).slice(0, 100), value: String(s.number) })));
  },

  async execute(interaction) {
    const lang = await GuildSettings.getLanguage(interaction.guildId);
    const ar = lang === 'ar';
    await interaction.deferReply();                       // the reciter list may need a download, and joining voice takes a moment
    const fail = (msg) => interaction.editReply({ embeds: [buildErrorEmbed(msg, lang)] });

    const rawSurah = interaction.options.getString('surah')?.trim();
    const typed = interaction.options.getString('reciter')?.trim();
    if (!rawSurah && !typed) return fail(ar ? 'اكتب اسم قارئ لتشغيل القرآن كاملاً بصوته، أو اختر سورة.' : 'Type a reciter to play the whole Quran by him, or pick a surah.');
    let surah = null;                                      // null = the whole Quran (Khatma)
    if (rawSurah) {
      surah = (/^\d{1,3}$/.test(rawSurah) ? getSurahByNumber(Number(rawSurah)) : null) ?? getSurahByName(rawSurah, lang);
      if (!surah) return fail(ar ? 'لم أجد هذه السورة. اكتب اسمها أو رقمها (1–114) واختر من القائمة.' : 'Surah not found. Type its name or number (1–114) and pick from the list.');
    }

    // The reciter: typed name → it must exist; nothing typed → the server's choice (panel) or the bot default.
    let reciter;
    if (typed) {
      reciter = await findReciter(typed);
      if (!reciter?.moshaf?.length) {
        const close = (await searchReciters(typed.split(/\s+/).sort((a, b) => b.length - a.length)[0], lang)).slice(0, MAX_SUGGESTIONS).map(name);
        return fail(ar
          ? `لا يوجد قارئ بهذا الاسم: **${typed}**.${close.length ? `\nربما تقصد: ${close.join(' · ')}` : '\nجرّب جزءاً أقصر من الاسم واختر من القائمة.'}`
          : `No reciter found for **${typed}**.${close.length ? `\nDid you mean: ${close.join(' · ')}` : '\nTry a shorter part of the name and pick from the list.'}`);
      }
    } else {
      reciter = await findDefaultReciter(interaction.user.id, interaction.guildId);
      if (!reciter) return fail(ar ? 'خدمة القرّاء لا تستجيب الآن. حاول بعد قليل.' : 'The reciters service is not responding right now. Please try again shortly.');
    }
    const reciterName = name(reciter);
    const probe = surah ?? SURAHS[0];                      // for the whole Quran: it starts with Al-Fatiha
    if (!(await getPlayableUrls(reciter, probe.number)).length) {
      return fail(ar ? `**${reciterName}** ليس لديه سورة **${probe.arabic}**. اختر قارئاً آخر.` : `**${reciterName}** has no recording of **${probe.english}**. Pick another reciter.`);
    }

    const { ok, session } = await ensureSession(interaction, lang, { kind: 'recite', surah: surah?.number ?? null, reciter: reciterName, reciterId: String(reciter.id ?? '') });   // voice checks + join (or hand-over to the second bot); the reply is already sent when not ok
    if (!ok) return;
    const gid = interaction.guildId;
    let busy = false;
    if (!surah) {                                          // the whole Quran, in order — same as the panel's Khatma button
      clearQueue(gid);
      session.fullQuran = true; session.loop = false; session.memorize = null;
      enqueue(gid, { surah: SURAHS[0], reciter: reciterName, reciterObj: reciter });
      if (session.status === 'paused' || session.status === 'playing') skipSession(gid); else await playNext(gid);
    } else {
      if (!enqueue(gid, { surah, reciter: reciterName, reciterObj: reciter })) return fail(ar ? 'قائمة الانتظار ممتلئة.' : 'The queue is full.');
      busy = session.status !== 'idle' && !!session.current;
      if (!busy) await playNext(gid);
    }

    if (!(await syncPanel(interaction.client, interaction.guildId))) {
      await sendVoicePanel(interaction.client, interaction.guild, interaction.member?.voice?.channel, interaction.channel).catch(() => {});
    }
    if (!surah) {
      return interaction.editReply({ embeds: [buildSuccessEmbed(ar ? 'ختمة كاملة' : 'Full Quran',
        ar ? `القرآن كاملاً من الفاتحة إلى الناس بصوت **${reciterName}**.` : `The whole Quran, Al-Fatiha to An-Nas, by **${reciterName}**.`, lang)] });
    }
    const label = ar ? surah.arabic : surah.english;
    return interaction.editReply({ embeds: [buildSuccessEmbed(
      busy ? (ar ? 'أُضيفت إلى القائمة' : 'Added to the queue') : (ar ? 'بدأ التشغيل' : 'Playing'),
      `**${label}** — ${reciterName}`, lang)] });
  }
};
