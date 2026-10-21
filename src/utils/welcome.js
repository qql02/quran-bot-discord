import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { COLORS, THUMBNAIL } from './embeds.js';

/** Bilingual first-contact message (the server's language isn't known yet) with a one-tap language choice. */
export function buildWelcomeMessage() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🕌 السلام عليكم ورحمة الله — Assalamu Alaikum')
    .setDescription(
      '**شكراً لإضافتي!** ادخل قناة صوتية ثم اكتب `/start` وابدأ الاستماع.\n' +
      '**Thanks for adding me!** Join a voice channel and type `/start` to start listening.'
    )
    .addFields(
      { name: '/recite',    value: 'سورة أو قارئ بالاسم · A surah or a reciter by name', inline: true },
      { name: '/start',    value: 'لوحة التشغيل · Player panel',                          inline: true },
      { name: '/hold · /next', value: 'إيقاف وتخطي · Pause and skip',                      inline: true },
      { name: '/guide',    value: 'دليل المستخدم · User guide',                           inline: true },
      { name: '/help',     value: 'المصحف والورد · Mushaf and wird',                      inline: true },
      { name: '/setup',    value: 'إعدادات السيرفر · Server settings (admins)',           inline: true }
    )
    .setThumbnail(THUMBNAIL)
    .setFooter({ text: 'اختر لغة البوت (تتطلب صلاحية إدارة السيرفر) · Choose the bot language (needs Manage Server)' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lang:set:ar').setLabel('العربية').setEmoji('🇸🇦').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('lang:set:en').setLabel('English').setEmoji('🇬🇧').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}
