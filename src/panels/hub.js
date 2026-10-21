import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ChannelType, PermissionFlagsBits
} from 'discord.js';
import { config } from '../config.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { ReligiousEvent } from '../models/ReligiousEvent.js';
import { CustomStation } from '../models/CustomStation.js';
import { COLORS, THUMBNAIL, buildErrorEmbed } from '../utils/embeds.js';
import { setSessionLanguage } from '../managers/sessionManager.js';
import { getControlSync } from '../services/controlService.js';
import { isFeatureOn } from '../utils/botControl.js';
import { DEFAULT_AYAH_TIME } from '../data/ayahs.js';
import { DEFAULT_HADITH_TIME } from '../data/hadiths.js';
import { DEFAULT_MORNING, DEFAULT_EVENING } from '../utils/adhkarSchedule.js';
import { resolveChannel } from '../services/adhkarService.js';
import { roomPanelMessage, wirdText, normWirdLang } from '../utils/wirdUi.js';
import { adhkarPage } from './adhkarPanel.js';
import { eventsPage } from './eventsPanel.js';
import { stationsPage } from './stationsPanel.js';
import { runRoomsFlow } from './roomsFlow.js';

// ═════════════════════════════════════════════════════════════════════════════
//  /setup — ONE panel for everything a server admin used to do with /adhkar, /events, /stations, /language,
//  /wird setup and the old /setup. A home screen shows what is on and what is off, and a menu opens each page; every page
//  has a 🏠 button back. Nothing is kept in memory (state lives in the database and in the custom ids), so it never expires.
//  Ids: "hub:…" here, "adhkar:…", "events:…", "stations:…" on their own pages.
// ═════════════════════════════════════════════════════════════════════════════

/** Page → the owner's feature switch that can turn it off everywhere (see FEATURES in utils/botControl.js). */
export const SECTION_FEATURE = { adhkar: 'adhkar', ayah: 'ayah', hadith: 'hadith', events: 'events', wird: 'wird', stations: 'voice', rooms: 'setup' };

const row = (...c) => new ActionRowBuilder().addComponents(...c);
const homeBtn = (lang) => new ButtonBuilder().setCustomId('hub:home').setStyle(ButtonStyle.Secondary).setEmoji('🏠').setLabel(lang === 'ar' ? 'الرئيسية' : 'Home');
const on = (lang, yes) => (yes ? (lang === 'ar' ? '✅ مفعّل' : '✅ On') : (lang === 'ar' ? '⛔ متوقف' : '⛔ Off'));

// ─── Home ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function hubHome(guild, lang, note = null) {
  const ar = lang === 'ar';
  const [doc, events, stations] = await Promise.all([
    GuildSettings.findOne({ guildId: guild.id }, { adhkar: 1, ayah: 1, hadith: 1, wird: 1 }).lean(),
    ReligiousEvent.countDocuments({ guildId: guild.id }),
    CustomStation.countDocuments({ scope: 'guild', guildId: guild.id })
  ]);
  const a = doc?.adhkar ?? {}, y = doc?.ayah ?? {}, hd = doc?.hadith ?? {}, w = doc?.wird ?? {};
  const ch = (id) => (id && guild.channels.cache.has(id) ? `<#${id}>` : (ar ? '— لم يُحدد' : '— not set'));
  const lines = [
    `🌅 **${ar ? 'الأذكار' : 'Adhkar'}:** ${on(lang, a.enabled)}${a.enabled ? ` · ${ch(a.channelId)} · \`${a.morningTime || DEFAULT_MORNING}\` / \`${a.eveningTime || DEFAULT_EVENING}\`` : ''}`,
    `🎲 **${ar ? 'أذكار طوال اليوم' : 'All-day dhikr'}:** ${on(lang, a.scatter?.enabled)}`,
    `📖 **${ar ? 'آية اليوم' : 'Verse of the day'}:** ${on(lang, y.enabled)}${y.enabled ? ` · ${ch(y.channelId)} · \`${y.time || DEFAULT_AYAH_TIME}\`` : ''}`,
    `📜 **${ar ? 'حديث اليوم' : 'Hadith of the day'}:** ${on(lang, hd.enabled)}${hd.enabled ? ` · ${ch(hd.channelId)} · \`${hd.time || DEFAULT_HADITH_TIME}\`` : ''}`,
    `📅 **${ar ? 'الفعاليات' : 'Events'}:** ${events}`,
    `📿 **${ar ? 'غرفة الورد' : 'Wird room'}:** ${w.channelId ? `${ch(w.channelId)}` : (ar ? '— لم تُحدد' : '— not set')}`,
    `📻 **${ar ? 'محطات السيرفر' : 'Server stations'}:** ${stations}`,
    `🌐 **${ar ? 'اللغة' : 'Language'}:** ${ar ? 'العربية' : 'English'}`
  ];
  const embed = new EmbedBuilder().setColor(COLORS.primary).setThumbnail(THUMBNAIL)
    .setTitle(ar ? '⚙️ لوحة إعدادات السيرفر' : '⚙️ Server settings')
    .setDescription([
      note,
      ar ? 'كل إعدادات البوت في مكان واحد. اختر صفحة من القائمة، وكل صفحة فيها زر 🏠 للعودة.'
         : 'Everything about the bot in one place. Pick a page from the menu; each page has a 🏠 button to come back.',
      '',
      ...lines,
      '',
      ar ? '🎧 لوحة التشغيل الصوتية: اكتب `/start` وأنت في روم صوتي · دليل الأعضاء: `/guide`.' : '🎧 The player panel: type `/start` while in a voice room · members\' guide: `/guide`.'
    ].filter(x => x !== null).join('\n'));
  const menu = new StringSelectMenuBuilder().setCustomId('hub:go').setPlaceholder(ar ? '📂 اختر صفحة…' : '📂 Choose a page…').addOptions([
    { label: ar ? 'الأذكار' : 'Adhkar', value: 'adhkar', emoji: '🌅', description: ar ? 'الصباح والمساء وأذكار اليوم' : 'Morning, evening and all-day posts' },
    { label: ar ? 'آية اليوم' : 'Verse of the day', value: 'ayah', emoji: '📖', description: ar ? 'آية مع التفسير يومياً' : 'A verse with tafsir daily' },
    { label: ar ? 'حديث اليوم' : 'Hadith of the day', value: 'hadith', emoji: '📜', description: ar ? 'حديث من مصادر معروفة يومياً' : 'A hadith from well-known sources daily' },
    { label: ar ? 'الفعاليات' : 'Events', value: 'events', emoji: '📅', description: ar ? 'جدولة منشورات دينية' : 'Schedule religious posts' },
    { label: ar ? 'غرفة الورد' : 'Wird room', value: 'wird', emoji: '📿', description: ar ? 'روم الاشتراك وإعلان الختمة' : 'Subscribe room & khatma announcements' },
    { label: ar ? 'محطات الراديو' : 'Radio stations', value: 'stations', emoji: '📻', description: ar ? 'أضف محطاتك الخاصة' : 'Add your own stations' },
    { label: ar ? 'اللغة' : 'Language', value: 'lang', emoji: '🌐', description: ar ? 'العربية أو English' : 'Arabic or English' },
    { label: ar ? 'إنشاء الرومات تلقائياً' : 'Create the rooms', value: 'rooms', emoji: '🏗️', description: ar ? 'قسم القرآن ورومّاته' : 'The Quran category and its rooms' }
  ]);
  return { embeds: [embed], components: [row(menu)] };
}

// ─── Wird room ────────────────────────────────────────────────────────────────────────────────────────────────
export async function wirdPage(guild, lang, note = null) {
  const ar = lang === 'ar';
  const doc = await GuildSettings.findOne({ guildId: guild.id }, { wird: 1, language: 1 }).lean();
  const w = doc?.wird ?? {};
  const wl = normWirdLang(w.lang ?? doc?.language ?? lang);
  const hasRoom = !!(w.channelId && guild.channels.cache.has(w.channelId));
  const embed = new EmbedBuilder().setColor(COLORS.gold).setTitle(ar ? '📿 غرفة الورد اليومي' : '📿 Daily wird room')
    .setDescription([
      note,
      ar ? 'الورد اليومي مجاني للأعضاء: يشتركون بزر في الغرفة ويصلهم التذكير في الخاص. اختر الروم لينشر البوت فيه لوحة الاشتراك.'
         : 'The daily wird is free: members subscribe with a button in the room and get reminders in their DMs. Pick the room where the bot posts the subscribe panel.',
      '',
      `**${ar ? 'الروم' : 'Room'}:** ${hasRoom ? `<#${w.channelId}>` : (ar ? '— لم يُحدد' : '— not set')}`,
      `**${ar ? 'إعلان من يختم القرآن' : 'Announce finished khatmas'}:** ${on(lang, w.announceKhatma !== false)}`,
      `**${ar ? 'لغة اللوحة والمشتركين الجدد' : 'Panel & new-subscriber language'}:** ${wl === 'ar' ? 'العربية' : 'English'}`
    ].filter(x => x !== null).join('\n'));
  const chMenu = new ChannelSelectMenuBuilder().setCustomId('hub:wird:ch').setPlaceholder(ar ? '📍 اختر روم الورد' : '📍 Choose the wird room')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (hasRoom) chMenu.setDefaultChannels(w.channelId);
  const langMenu = new StringSelectMenuBuilder().setCustomId('hub:wird:lang').setPlaceholder(ar ? '🌐 لغة اللوحة' : '🌐 Panel language')
    .addOptions([{ label: 'العربية', value: 'ar', default: wl === 'ar' }, { label: 'English', value: 'en', default: wl === 'en' }]);
  return {
    embeds: [embed],
    components: [
      row(
        new ButtonBuilder().setCustomId('hub:wird:ann').setStyle(w.announceKhatma !== false ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setEmoji(w.announceKhatma !== false ? '✅' : '⛔').setLabel(ar ? 'إعلان الختمة' : 'Khatma announcements'),
        new ButtonBuilder().setCustomId('hub:wird:repost').setStyle(ButtonStyle.Primary).setEmoji('📨').setLabel(ar ? 'أعد نشر لوحة الاشتراك' : 'Re-post the panel').setDisabled(!hasRoom),
        homeBtn(lang)
      ),
      row(chMenu),
      row(langMenu)
    ]
  };
}

/** Post the subscribe panel in `channel` (the previous one is deleted so the room never has two) and remember it. */
async function postWirdPanel(i, channelId, { announce, lang }) {
  const guildId = i.guildId;
  const r = await resolveChannel(i.client, guildId, channelId).catch(() => ({ error: 'send_failed' }));
  if (r.error) return { error: wirdText(lang).setupNoAccess(channelId) };
  const prev = (await GuildSettings.findOne({ guildId }, { wird: 1 }).lean())?.wird;
  if (prev?.channelId && prev.panelMessageId) {
    const old = i.guild.channels.cache.get(prev.channelId);
    await old?.messages?.delete(prev.panelMessageId).catch(() => {});
  }
  const msg = await r.channel.send({ ...roomPanelMessage(lang), allowedMentions: { parse: [] } });
  await GuildSettings.findOneAndUpdate(
    { guildId },
    { $set: { 'wird.channelId': channelId, 'wird.panelMessageId': msg.id, 'wird.announceKhatma': announce, 'wird.lang': lang } },
    { upsert: true }
  );
  return { ok: true };
}

// ─── Language ─────────────────────────────────────────────────────────────────────────────────────────────────
export function languagePage(lang, note = null) {
  const ar = lang === 'ar';
  return {
    embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(ar ? '🌐 لغة البوت' : '🌐 Bot language')
      .setDescription([note, ar ? 'لغة لوحة التشغيل والرسائل في هذا السيرفر.' : 'The language of the player panel and messages in this server.'].filter(x => x !== null).join('\n\n'))],
    components: [row(
      new ButtonBuilder().setCustomId('hub:lang:ar').setStyle(ar ? ButtonStyle.Success : ButtonStyle.Secondary).setLabel('العربية'),
      new ButtonBuilder().setCustomId('hub:lang:en').setStyle(!ar ? ButtonStyle.Success : ButtonStyle.Secondary).setLabel('English'),
      homeBtn(lang)
    )]
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────────────────────────────────────
const isOwner = (i) => config.admin.ids.includes(i.user.id);

export async function handleHub(i) {
  const lang = await GuildSettings.getLanguage(i.guildId);
  const ar = lang === 'ar';
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return i.reply({ embeds: [buildErrorEmbed(ar ? 'تحتاج صلاحية **إدارة السيرفر** لاستخدام هذه اللوحة.' : 'You need the **Manage Server** permission to use this panel.', lang)], ephemeral: true });
  }
  const [, action, sub] = i.customId.split(':');

  if (action === 'home') return i.update(await hubHome(i.guild, lang));

  if (action === 'go') {
    const v = i.values?.[0];
    const feature = SECTION_FEATURE[v];
    if (feature && !isOwner(i) && !isFeatureOn(getControlSync(), feature)) {
      return i.reply({ embeds: [buildErrorEmbed(ar ? '⛔ هذه الميزة متوقفة مؤقتاً من قِبل إدارة البوت.' : '⛔ This feature is temporarily switched off by the bot team.', lang)], ephemeral: true });
    }
    switch (v) {
      case 'adhkar':   return i.update(await adhkarPage(i.guild, 'main'));
      case 'ayah':     return i.update(await adhkarPage(i.guild, 'ayah'));
      case 'hadith':   return i.update(await adhkarPage(i.guild, 'hadith'));
      case 'events':   return i.update(await eventsPage(i.guild));
      case 'stations': return i.update(await stationsPage(i.guild, lang, isOwner(i)));
      case 'wird':     return i.update(await wirdPage(i.guild, lang));
      case 'lang':     return i.update(languagePage(lang));
      case 'rooms':    return runRoomsFlow(i, { lang });
      default:         return i.deferUpdate().catch(() => {});
    }
  }

  if (action === 'lang') {
    const chosen = sub === 'ar' ? 'ar' : 'en';
    await GuildSettings.findOneAndUpdate({ guildId: i.guildId }, { $set: { language: chosen, updatedAt: new Date() } }, { upsert: true });
    GuildSettings.invalidateLangCache(i.guildId);
    setSessionLanguage(i.guildId, chosen);
    return i.update(languagePage(chosen, chosen === 'ar' ? '✅ تم تغيير اللغة إلى العربية.' : '✅ Language changed to English.'));
  }

  if (action === 'wird') {
    const doc = (await GuildSettings.findOne({ guildId: i.guildId }, { wird: 1, language: 1 }).lean()) ?? {};
    const w = doc.wird ?? {};
    const wl = normWirdLang(w.lang ?? doc.language ?? lang);
    const announce = w.announceKhatma !== false;

    if (sub === 'ch') {
      const channel = i.channels?.first();
      if (!channel) return i.deferUpdate().catch(() => {});
      await i.deferUpdate();
      const r = await postWirdPanel(i, channel.id, { announce, lang: wl });
      return i.editReply(await wirdPage(i.guild, lang, r.error ?? (ar ? `✅ نُشرت لوحة الاشتراك في <#${channel.id}>.` : `✅ The subscribe panel was posted in <#${channel.id}>.`)));
    }
    if (sub === 'ann') {
      await GuildSettings.findOneAndUpdate({ guildId: i.guildId }, { $set: { 'wird.announceKhatma': !announce } }, { upsert: true });
      return i.update(await wirdPage(i.guild, lang));
    }
    if (sub === 'lang' || sub === 'repost') {
      const nextLang = sub === 'lang' ? normWirdLang(i.values?.[0]) : wl;
      if (!w.channelId) {
        await GuildSettings.findOneAndUpdate({ guildId: i.guildId }, { $set: { 'wird.lang': nextLang } }, { upsert: true });
        return i.update(await wirdPage(i.guild, lang));
      }
      await i.deferUpdate();
      const r = await postWirdPanel(i, w.channelId, { announce, lang: nextLang });
      return i.editReply(await wirdPage(i.guild, lang, r.error ?? (ar ? '✅ تم تحديث لوحة الاشتراك.' : '✅ The subscribe panel was updated.')));
    }
  }
}
