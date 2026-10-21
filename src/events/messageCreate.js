import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { parseDm, DM_HELP_SECTIONS, suggestCommand } from '../utils/dmCommands.js';
import { parseTarget } from '../utils/mushaf.js';
import { getControlSync } from '../services/controlService.js';
import { isFeatureOn } from '../utils/botControl.js';
import { buildInviteUrl } from '../utils/invite.js';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { COLORS, THUMBNAIL, buildErrorEmbed, buildInfoEmbed, buildSuccessEmbed } from '../utils/embeds.js';
import { guideHome } from '../panels/guide.js';
import { collectAccountData, eraseAccountData, resetSettings, buildExport, isEmptyAccount } from '../services/accountData.js';
import { dataEmbed, settingsEmbed, listEmbed, forgetEmbed, exportConsentEmbed } from '../utils/accountUi.js';
import { createConsent } from '../utils/consent.js';

// ─── Prefix commands in the bot's private chat ─────────────────────────────────────────────────────────────────
// A member can read the Quran, see their wird, get a verse… without going back to a server. Nothing here controls voice or a
// server's player: those words are simply unknown commands.
// Messages in servers never reach this handler (the bot has no guild-message intent).

const COOLDOWN_MS = 1500;
const lastUse = new Map();
const lastExport = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, ts] of lastUse) if (ts < cutoff) lastUse.delete(k);
  for (const [k, ts] of lastExport) if (ts < cutoff) lastExport.delete(k);
}, 5 * 60_000).unref?.();
const clearing = new Set();
const consent = createConsent();             // "send me a copy" / "delete my data": shown first, only then confirmed
const EXPORT_COOLDOWN_MS = 60_000;

const t = (lang, ar, en) => (lang === 'ar' ? ar : en);
const plain = (payload) => { const { ephemeral: _e, flags: _f, ...rest } = payload; return { ...rest, allowedMentions: { parse: [] } }; };

async function reply(message, payload) {
  try { return await message.channel.send(plain(payload)); }
  catch (err) { logger.debug?.(`[dm] could not reply to ${message.author?.id}: ${err.message}`); return null; }
}

// Personal list: pages and verses the member saved. Stored under the sender's own id only — never read from, or written for,
// anyone else, and never tied to a server.
async function personal(message, cmd, prefix) {
  const { lang } = cmd;
  const userId = message.author.id;
  const { PersonalList } = await import('../models/PersonalList.js');
  const P = await import('../utils/personal.js');
  const load = () => PersonalList.findOne({ userId }).lean();
  const store = (r) => PersonalList.updateOne({ userId }, { $set: { pages: r.pages, verses: r.verses, updatedAt: new Date() } }, { upsert: true });
  const err = (ar, en) => reply(message, { embeds: [buildErrorEmbed(t(lang, ar, en), lang)] });
  const ok = (ar, en) => reply(message, { embeds: [buildSuccessEmbed(t(lang, 'تم', 'Done'), t(lang, ar, en), lang)] });

  switch (cmd.name) {
    case 'mark': {
      if (!cmd.args) return err(`اكتب رقم الصفحة أو اسم السورة، مثل: \`${prefix}علامة 45\`.`, `Type a page number or a surah name, e.g. \`${prefix}mark 45\`.`);
      const target = parseTarget(cmd.args, lang);
      if (target.error) return reply(message, { embeds: [buildErrorEmbed(target.error, lang)] });
      const r = P.addPage(await load(), target.page);
      if (r.status === 'full') return err(`قائمتك ممتلئة (${P.MAX_ITEMS} صفحة). احذف شيئاً بـ \`${prefix}ازل\`.`, `Your list is full (${P.MAX_ITEMS} pages). Free a place with \`${prefix}remove\`.`);
      if (r.status === 'exists') return ok(`الصفحة ${target.page} محفوظة عندك من قبل.`, `Page ${target.page} is already in your list.`);
      await store(r);
      return ok(`حُفظت الصفحة ${target.page}. اعرض قائمتك بـ \`${prefix}قائمتي\`.`, `Saved page ${target.page}. See your list with \`${prefix}mine\`.`);
    }
    case 'save': {
      const norm = P.normalizeRef(cmd.args);
      if (!norm) return err(`اكتب رقم السورة والآية، مثل: \`${prefix}احفظ 2:255\`.`, `Type the surah and verse numbers, e.g. \`${prefix}save 2:255\`.`);
      const r = P.addVerse(await load(), norm);
      if (r.status === 'full') return err(`قائمتك ممتلئة (${P.MAX_ITEMS} آية). احذف شيئاً بـ \`${prefix}ازل\`.`, `Your list is full (${P.MAX_ITEMS} verses). Free a place with \`${prefix}remove\`.`);
      if (r.status === 'exists') return ok(`الآية ${norm} محفوظة عندك من قبل.`, `Verse ${norm} is already in your list.`);
      await store(r);
      return ok(`حُفظت الآية ${norm}. اعرض قائمتك بـ \`${prefix}قائمتي\`.`, `Saved verse ${norm}. See your list with \`${prefix}mine\`.`);
    }
    case 'mine': {
      const doc = await load();
      if (!P.combined(doc).length) return reply(message, { embeds: [buildInfoEmbed(t(lang, 'قائمتك فارغة', 'Your list is empty'), t(lang, `احفظ صفحة بـ \`${prefix}علامة 45\` أو آية بـ \`${prefix}احفظ 2:255\`.`, `Save a page with \`${prefix}mark 45\` or a verse with \`${prefix}save 2:255\`.`), lang)] });
      return reply(message, { embeds: [listEmbed(doc, lang, prefix)] });
    }
    case 'open': {
      const items = P.combined(await load());
      const n = Math.trunc(Number(String(cmd.args).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))));
      const it = items[n - 1];
      if (!it) return err(items.length ? `اكتب رقماً من قائمتك (1 إلى ${items.length}).` : `قائمتك فارغة. احفظ شيئاً أولاً.`, items.length ? `Type a number from your list (1 to ${items.length}).` : 'Your list is empty. Save something first.');
      if (it.type === 'page') {
        if (!isFeatureOn(getControlSync(), 'mushaf')) return reply(message, { embeds: [buildInfoEmbed(t(lang, 'غير متاح', 'Not available'), t(lang, 'هذه الميزة متوقفة حالياً.', 'This feature is switched off right now.'), lang)] });
        const { mushafMessage } = await import('../components/mushafHandler.js');
        return reply(message, await mushafMessage(userId, it.value, lang));
      }
      const { fetchAyah, buildAyahMessage } = await import('../services/ayahService.js');
      const a = await fetchAyah(it.value);
      if (!a) return err('تعذّر جلب الآية الآن. حاول بعد قليل.', 'Could not load the verse right now. Try again shortly.');
      return reply(message, buildAyahMessage(a, { title: `${a.surahName} ${a.surah}:${a.ayah}`, footer: t(lang, 'التفسير الميسر', 'Al-Tafsir Al-Muyassar') }));
    }
    case 'remove': {
      const r = P.removeNumber(await load(), cmd.args);
      if (r.status === 'invalid') return err(`اكتب رقم العنصر كما في \`${prefix}قائمتي\`.`, `Type the item number as shown by \`${prefix}mine\`.`);
      await store(r);
      return ok('حُذف من قائمتك.', 'Removed from your list.');
    }
    case 'settings': {
      const { MushafPref } = await import('../models/MushafPref.js');
      const parsed = P.parseSetting(cmd.args);
      if (parsed?.error) return err(`اكتب مثلاً: \`${prefix}اعدادات لغة en\` أو \`${prefix}اعدادات عرض حفص\` (نص · حفص · ورش) أو \`${prefix}اعدادات اعادة\`.`, `Try: \`${prefix}settings lang ar\`, \`${prefix}settings view hafs\` (text · hafs · warsh) or \`${prefix}settings reset\`.`);
      if (parsed?.key === 'reset') {
        await resetSettings(userId);
        (await import('../components/mushafHandler.js')).forgetUserView(userId);
        return ok('رجعت إعداداتك للوضع الافتراضي. قائمتك المحفوظة كما هي.', 'Your settings are back to the defaults. Your saved list is untouched.');
      }
      if (parsed?.key === 'lang') {
        await PersonalList.updateOne({ userId }, { $set: { lang: parsed.value, updatedAt: new Date() } }, { upsert: true });
        return reply(message, { embeds: [buildSuccessEmbed(parsed.value === 'ar' ? 'تم' : 'Done', parsed.value === 'ar' ? 'ستصلك ردود البوت بالعربية.' : 'The bot will reply to you in English.', parsed.value)] });
      }
      if (parsed?.key === 'view') {
        await MushafPref.updateOne({ userId }, { $set: { view: parsed.value, updatedAt: new Date() } }, { upsert: true });
        return ok(`صار المصحف يُعرض لك بنمط: ${parsed.value}.`, `The Mushaf will now open in: ${parsed.value}.`);
      }
      return reply(message, { embeds: [settingsEmbed(await collectAccountData(userId), lang, prefix)] });
    }
    case 'data':
      return reply(message, { embeds: [dataEmbed(await collectAccountData(userId), lang, prefix)] });
    case 'export': {
      const data = await collectAccountData(userId);
      if (isEmptyAccount(data)) return reply(message, { embeds: [buildInfoEmbed(t(lang, 'لا توجد بيانات', 'No data'), t(lang, 'لا يوجد شيء محفوظ باسم حسابك.', 'Nothing is stored under your account.'), lang)] });
      if (!P.parseForget(cmd.args).confirm || !consent.take(userId, 'export')) {   // nothing is sent without the member's own, fresh "yes"
        consent.ask(userId, 'export');
        return reply(message, { embeds: [exportConsentEmbed(data, lang, prefix)] });
      }
      if (Date.now() - (lastExport.get(userId) ?? 0) < EXPORT_COOLDOWN_MS) return err('انتظر دقيقة قبل طلب نسخة أخرى.', 'Wait a minute before asking for another copy.');
      lastExport.set(userId, Date.now());
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(buildExport(userId, data), null, 2), 'utf8'), { name: 'my-quran-bot-data.json' });
      return reply(message, { embeds: [buildSuccessEmbed(t(lang, 'نسخة من بياناتك', 'A copy of your data'), t(lang, 'الملف المرفق فيه كل ما هو محفوظ باسم حسابك.', 'The attached file holds everything stored under your account.'), lang)], files: [file] });
    }
    case 'forget': {
      const { confirm, scope } = P.parseForget(cmd.args);
      const data = await collectAccountData(userId);
      if (isEmptyAccount(data)) return reply(message, { embeds: [buildInfoEmbed(t(lang, 'لا توجد بيانات', 'No data'), t(lang, 'لا يوجد شيء محفوظ باسم حسابك لأحذفه.', 'Nothing is stored under your account to delete.'), lang)] });
      if (!confirm || !consent.take(userId, 'forget')) {   // deleting needs the screen first, then a fresh confirmation
        consent.ask(userId, 'forget');
        return reply(message, { embeds: [forgetEmbed(data, lang, prefix)] });
      }
      const { failed } = await eraseAccountData(userId, scope);
      (await import('../components/mushafHandler.js')).forgetUserView(userId);
      if (failed) return err('لم يكتمل الحذف: بقي جزء من بياناتك. أعد المحاولة بعد قليل (اطلب `' + prefix + 'انسني` ثم أكّد).', 'The deletion did not finish — part of your data is still stored. Try again shortly (type `' + prefix + 'forget`, then confirm).');
      return ok(scope === 'all'
        ? 'حُذفت كل بياناتك، بما فيها اشتراك الورد وتقدّمك. توقفت التذكيرات.'
        : 'حُذفت بياناتك الشخصية. اشتراك الورد لا يتأثر؛ احذفه أيضاً بـ `' + prefix + 'انسني الكل` ثم التأكيد، أو ألغِه من لوحة الورد.',
      scope === 'all'
        ? 'All your data was deleted, including the wird subscription and progress. Reminders have stopped.'
        : 'Your personal data was deleted. Your wird subscription is not affected; remove it too with `' + prefix + 'forget all` and then confirm, or cancel it from the wird panel.');
    }
  }
  return null;
}

const SLOW = new Set(['mushaf', 'read', 'ayah', 'wird', 'open', 'export']);   // they fetch a page / a verse / the member's data: show "typing…" meanwhile

async function run(message, cmd, client) {
  const { lang } = cmd;
  if (SLOW.has(cmd.name)) Promise.resolve(message.channel?.sendTyping?.()).catch(() => {});
  const userId = message.author.id;
  const prefix = config.bot.prefix;
  const ctl = getControlSync();

  switch (cmd.name) {
    case 'help':
      return reply(message, { embeds: [new EmbedBuilder().setColor(COLORS.primary).setThumbnail(THUMBNAIL)
        .setTitle(t(lang, 'الأوامر في الخاص', 'Commands in this chat')).addFields(DM_HELP_SECTIONS[lang](prefix))
        .setFooter({ text: t(lang, 'تعمل هنا في الخاص فقط، ولا تصل إلى أي سيرفر', 'They work here in private only and never reach a server') })] });

    case 'guide':
      return reply(message, guideHome(lang, undefined, { dm: true }));

    case 'invite': {
      const url = buildInviteUrl(client.user?.id ?? config.discord.clientId);
      return reply(message, { embeds: [buildInfoEmbed(t(lang, 'أضف البوت إلى سيرفرك', 'Add the bot to your server'), `[${t(lang, 'اضغط هنا', 'Click here')}](${url})`, lang)] });
    }

    case 'mushaf':
    case 'read': {
      if (!isFeatureOn(ctl, 'mushaf')) return reply(message, { embeds: [buildInfoEmbed(t(lang, 'غير متاح', 'Not available'), t(lang, 'هذه الميزة متوقفة حالياً.', 'This feature is switched off right now.'), lang)] });
      let page = null;
      if (cmd.name === 'read') {
        if (!cmd.args) return reply(message, { embeds: [buildErrorEmbed(t(lang, `اكتب رقم الصفحة أو اسم السورة، مثل: \`${prefix}صفحة 45\` أو \`${prefix}سورة الكهف\` أو \`${prefix}جزء 5\`.`, `Type a page number or a surah name, e.g. \`${prefix}page 45\`, \`${prefix}surah kahf\` or \`${prefix}juz 5\`.`), lang)] });
        const target = parseTarget(cmd.args, lang);
        if (target.error) return reply(message, { embeds: [buildErrorEmbed(target.error, lang)] });
        page = target.page;
      }
      const { mushafMessage } = await import('../components/mushafHandler.js');
      return reply(message, await mushafMessage(userId, page, lang));
    }

    case 'ayah': {
      const { parseRef, AYAH_REFS } = await import('../data/ayahs.js');
      const { fetchAyah, buildAyahMessage } = await import('../services/ayahService.js');
      const ref = !cmd.args ? AYAH_REFS[Math.floor(Math.random() * AYAH_REFS.length)] : String(cmd.args ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/\s+/g, '').replace('،', ':');
      if (!parseRef(ref)) return reply(message, { embeds: [buildErrorEmbed(t(lang, `اكتب رقم السورة والآية، مثل: \`${prefix}اية 2:255\`.`, `Type the surah and verse numbers, e.g. \`${prefix}ayah 2:255\`.`), lang)] });
      const a = await fetchAyah(ref);
      if (!a) return reply(message, { embeds: [buildErrorEmbed(t(lang, 'تعذّر جلب الآية الآن. حاول بعد قليل.', 'Could not load the verse right now. Try again shortly.'), lang)] });
      return reply(message, buildAyahMessage(a, { title: `${a.surahName} ${a.surah}:${a.ayah}`, footer: t(lang, 'التفسير الميسر', 'Al-Tafsir Al-Muyassar') }));
    }

    case 'hadith': {
      if (!isFeatureOn(ctl, 'hadith')) return reply(message, { embeds: [buildInfoEmbed(t(lang, 'غير متاح', 'Not available'), t(lang, 'هذه الميزة متوقفة حالياً.', 'This feature is switched off right now.'), lang)] });
      const { HADITHS } = await import('../data/hadiths.js');
      const { buildHadithMessage } = await import('../services/hadithService.js');
      const raw = String(cmd.args ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).trim();
      let h;
      if (!raw) h = HADITHS[Math.floor(Math.random() * HADITHS.length)];
      else {
        h = /^\d{1,3}$/.test(raw) ? HADITHS.find(x => x.s === 'n' && x.n === Number(raw)) : null;
        if (!h) return reply(message, { embeds: [buildErrorEmbed(t(lang, `اكتب رقماً من 1 إلى 42 للأربعين النووية، مثل: \`${prefix}حديث 13\`، أو \`${prefix}حديث\` وحدها لحديث عشوائي.`, `Type a number from 1 to 42 for the Forty Nawawi, e.g. \`${prefix}hadith 13\`, or \`${prefix}hadith\` alone for a random one.`), lang)] });
      }
      return reply(message, buildHadithMessage(h, { title: t(lang, 'حديث شريف', 'Hadith'), footer: t(lang, 'اللهم صلّ وسلّم على نبينا محمد', 'Peace and blessings be upon our Prophet Muhammad') }));
    }

    case 'adhkar': {
      const { buildAdhkarEmbeds } = await import('../services/adhkarService.js');
      const kind = /^(?:مساء|المساء|evening|masaa|pm)$/i.test(cmd.args.trim()) ? 'evening' : 'morning';
      const embeds = buildAdhkarEmbeds(kind, 'full');
      for (let i = 0; i < embeds.length; i += 3) await reply(message, { embeds: embeds.slice(i, i + 3) });   // a message holds at most 10 embeds; 3 keeps each one readable
      return;
    }

    case 'dua': {
      const { libraryCategories, renderLibraryPages, SCATTER_META } = await import('../data/adhkar.js');
      const { normalizeText } = await import('../utils/arabic.js');
      const cats = libraryCategories();
      const q = String(cmd.args ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).trim();
      const send = (pages) => (async () => {
        for (let i = 0; i < pages.length; i += 3) {
          await reply(message, { embeds: pages.slice(i, i + 3).map((pg) => new EmbedBuilder().setColor(SCATTER_META.color).setTitle(pg.title).addFields(pg.fields).setFooter({ text: t(lang, 'حصن المسلم · القرآن الكريم', "Hisn al-Muslim · the Qur'an") })) });
        }
      })();
      if (/^\d+$/.test(q) && cats[Number(q) - 1]) return send(renderLibraryPages(cats[Number(q) - 1]));
      const nq = normalizeText(q);
      if (nq) {                                                       // punctuation-only input is not a search: it lists the chapters
        const hits = cats.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => normalizeText(c.title).includes(nq) || normalizeText(c.group).includes(nq));
        if (hits.length === 1) return send(renderLibraryPages(hits[0].c));
        if (!hits.length) return reply(message, { embeds: [buildErrorEmbed(t(lang, `لا يوجد باب بهذا الاسم. اكتب \`${prefix}ادعية\` لعرض الأبواب.`, `No chapter matches. Type \`${prefix}dua\` to list them.`), lang)] });
        return reply(message, { embeds: [buildInfoEmbed(t(lang, 'نتائج البحث', 'Search results'), hits.slice(0, 40).map(({ c, n }) => `\`${n}\` ${c.icon} ${c.title}`).join('\n'), lang)] });
      }
      const lines = cats.map((c, i) => `\`${i + 1}\` ${c.icon} ${c.title}`);
      const chunks = []; let cur = '';
      for (const l of lines) { if (cur.length + l.length + 1 > 3800) { chunks.push(cur); cur = ''; } cur += `${l}\n`; }
      if (cur) chunks.push(cur);
      const head = t(lang, `**موسوعة الأدعية والأذكار** — ${cats.reduce((a, c) => a + c.items.length, 0)} نصًّا من حصن المسلم والقرآن الكريم.\nاكتب \`${prefix}ادعية <رقم>\` لفتح باب، أو \`${prefix}ادعية <كلمة>\` للبحث.\n\n`, `**Du'a & adhkar library** — ${cats.reduce((a, c) => a + c.items.length, 0)} texts from Hisn al-Muslim and the Qur'an.\nType \`${prefix}dua <number>\` to open a chapter, or \`${prefix}dua <word>\` to search (Arabic titles).\n\n`);
      for (let i = 0; i < chunks.length; i++) await reply(message, { embeds: [buildInfoEmbed(i === 0 ? t(lang, 'الأدعية والأذكار', 'Du\'a & Adhkar') : t(lang, 'تابع', 'Continued'), (i === 0 ? head : '') + chunks[i], lang)] });
      return;
    }

    case 'wird': {
      if (!isFeatureOn(ctl, 'wird')) return reply(message, { embeds: [buildInfoEmbed(t(lang, 'غير متاح', 'Not available'), t(lang, 'هذه الميزة متوقفة حالياً.', 'This feature is switched off right now.'), lang)] });
      const { WirdSubscription } = await import('../models/WirdSubscription.js');
      const { statusMessage, roomPanelMessage } = await import('../wird/ui/index.js');
      const { subscriptionState } = await import('../utils/wird.js');
      const sub = await WirdSubscription.findOne({ userId }).lean();
      const live = sub && sub.active && subscriptionState(sub.expiresAt) !== 'expired';
      // `!wird` → the daily reading itself (the reader at your wird page, with "I finished this page"); subscribers can also ask for the card with their progress.
      if (/^(?:status|حالة|تقدم|تقدمي)$/i.test(String(cmd.args ?? '').trim())) return reply(message, live ? statusMessage(sub) : roomPanelMessage(lang));
      const { readerMessage } = await import('../components/mushafHandler.js');
      return reply(message, await readerMessage(userId, null, lang));
    }

    case 'clear': {
      if (clearing.has(userId)) return;
      clearing.add(userId);
      try {
        const { clearBotDms } = await import('../commands/clear.js');
        const { found, deleted, failed, more, userBlocked } = await clearBotDms(client, message.author);
        const parts = [found ? t(lang, `تم حذف **${deleted}** رسالة.`, `Deleted **${deleted}** message(s).`) : t(lang, 'لا توجد رسائل للحذف.', 'Nothing to delete.')];
        if (userBlocked) parts.push(t(lang, 'ℹ️ ديسكورد لا يسمح للبوت بحذف **رسائلك أنت** في الخاص، فحُذفت رسائل البوت فقط. لحذف رسائلك: اضغط على الرسالة ← حذف.', 'ℹ️ Discord does not let a bot delete **your own** messages in a DM, so only the bot\'s messages were removed. To remove yours: press the message → Delete.'));
        if (failed) parts.push(t(lang, `تعذّر حذف ${failed}.`, `${failed} could not be deleted.`));
        if (more) parts.push(t(lang, `ما زالت هناك رسائل، أعد كتابة \`${prefix}مسح\`.`, `More messages remain — type \`${prefix}clear\` again.`));
        return reply(message, { embeds: [buildSuccessEmbed(t(lang, 'تم', 'Done'), parts.join('\n'), lang)] });
      } finally { clearing.delete(userId); }
    }

    case 'mark':
    case 'save':
    case 'mine':
    case 'open':
    case 'remove':
    case 'forget':
    case 'settings':
    case 'data':
    case 'export':
      return personal(message, cmd, prefix);

    default: {
      const near = suggestCommand(cmd.typed, lang);
      const hint = near ? t(lang, ` هل تقصد \`${prefix}${near}\`؟`, ` Did you mean \`${prefix}${near}\`?`) : '';
      return reply(message, { embeds: [buildErrorEmbed(t(lang, `لا أعرف الأمر \`${prefix}${cmd.typed}\`.${hint} اكتب \`${prefix}مساعدة\`.`, `I do not know \`${prefix}${cmd.typed}\`.${hint} Type \`${prefix}help\`.`), lang)] });
    }
  }
}

export default {
  name: 'messageCreate',

  async execute(message, client) {
    if (message.author?.bot || message.guildId) return;                       // private chat only
    if (message.channel?.isDMBased?.() === false) return;                     // …and really a DM channel, not a thread or any other channel
    let cmd = parseDm(message.content, config.bot.prefix);
    if (!cmd) return;
    if (!cmd.known && !cmd.typed) return;                                     // "!!!", "!?", "!👍": punctuation or emoji, not a command — no "I do not know `!`" reply
    if (!config.admin.ids.includes(message.author.id)) {
      const now = Date.now();
      if (now - (lastUse.get(message.author.id) ?? 0) < COOLDOWN_MS) {
        message.react?.('⏳').catch?.(() => {});                              // a command sent too fast is not answered — the hourglass says so instead of silence
        return;
      }
      lastUse.set(message.author.id, now);
    }
    try {
      if (cmd.known) {   // the member's own reply-language setting wins over the language of the word typed
        const own = await (await import('../models/PersonalList.js')).PersonalList.findOne({ userId: message.author.id }, { lang: 1 }).lean().catch(() => null);
        if (own?.lang) cmd = { ...cmd, lang: own.lang };
      }
      await run(message, cmd, client);
    }
    catch (err) {
      logger.error(`[dm] ${cmd.name} failed (user=${message.author.id}): ${err?.message}\n${err?.stack ?? ''}`);
      await reply(message, { embeds: [buildErrorEmbed(t(cmd.lang, 'حدث خطأ غير متوقع، حاول مرة أخرى بعد قليل.', 'Something unexpected went wrong. Please try again in a moment.'), cmd.lang)] });
    }
  }
};
