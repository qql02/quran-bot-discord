import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { COLORS, THUMBNAIL, buildInfoEmbed } from '../utils/embeds.js';
import { t } from '../utils/i18n.js';
import { buildInviteUrl } from '../utils/invite.js';
import { buildDonationMessage } from '../utils/donation.js';
import { buildStatsMessage } from '../utils/statsCard.js';
import { startPlayerPanel } from '../utils/startPanel.js';
import { openMushaf } from '../components/mushafHandler.js';
import { startSubscription } from '../components/wirdHandler.js';
import { hubHome } from './hub.js';
import { guideHome } from './guide.js';
import { getControlSync } from '../services/controlService.js';
import { isFeatureOn, globalBlockedBy } from '../utils/botControl.js';
import { getRestrictions } from '../utils/guildRestrictions.js';
import { secondBotComponents } from './secondBot.js';
import { blockedBy } from '../utils/restrictionRules.js';

// ═════════════════════════════════════════════════════════════════════════════
//  /help — the member's menu: one card with a button for everything that used to be its own command
//  (/mushaf, /wird, /stats, /invite, /donation). Ids start with "menu:". The card stays on screen: what a button opens
//  is a NEW private message, so people can open several things one after another.
// ═════════════════════════════════════════════════════════════════════════════

const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`menu:${id}`).setLabel(label).setStyle(style);

export function menuHome(lang, isAdmin) {
  const ar = lang === 'ar';
  const embed = new EmbedBuilder().setColor(COLORS.primary).setThumbnail(THUMBNAIL)
    .setTitle(t(lang, 'commands.help.title'))
    .setDescription([
      ar ? 'كل شيء بالأزرار — لا حاجة لحفظ أوامر.' : 'Everything is buttons — no commands to remember.',
      '',
      ar ? '🎧 **التلاوة:** ادخل روماً صوتياً واكتب `/recite` — اسم السورة، و/أو **اسم قارئ** تبحث عنه (قارئ بلا سورة = القرآن كاملاً). أو `/start` للوحة التشغيل.'
         : '🎧 **Listening:** join a voice room and type `/recite` — a surah and/or a **reciter you search by name** (reciter only = the whole Quran). Or `/start` for the player panel.',
      ar ? '**التحكم:** `/hold` `/continue` `/next` `/volume` `/leave` · `/pull` تنقل التلاوة إلى رومك' : '**Controls:** `/hold` `/continue` `/next` `/volume` `/leave` · `/pull` brings the recitation to your room',
      ar ? `**في الخاص:** راسل البوت واكتب \`${config.bot.prefix}مساعدة\` لقراءة القرآن دون العودة للسيرفر.` : `**In DMs:** message the bot and type \`${config.bot.prefix}help\` to read the Quran without going back to the server.`,
      ar ? '📖 **المصحف والورد:** أزرار أدناه.  **لا تعرف من أين تبدأ؟** اضغط «دليل المستخدم».' : '📖 **Mushaf & wird:** the buttons below.  **New here?** Press “User guide”.',
      isAdmin ? (ar ? '⚙️ **للمشرفين:** `/setup` — الأذكار، آية اليوم، الفعاليات، المحطات، اللغة، الرومات.' : '⚙️ **Admins:** `/setup` — adhkar, verse of the day, events, stations, language, rooms.') : null,
      '',
      ar ? '-# **Panel** = أزرار داخل ديسكورد · **الداشبورد** = صفحة ويب لمالك البوت فقط.' : '-# **Panel** = buttons inside Discord · **Dashboard** = a web page for the bot owner only.'
    ].filter(x => x !== null).join('\n'));
  const rows = [
    new ActionRowBuilder().addComponents(
      btn('player', ar ? '🎧 لوحة التشغيل' : '🎧 Player panel', ButtonStyle.Success),
      btn('mushaf', ar ? '📖 المصحف' : '📖 Mushaf', ButtonStyle.Primary),
      btn('wird', ar ? '📿 وردي اليومي' : '📿 My daily wird', ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      btn('stats', ar ? '📊 إحصائيات السيرفر' : '📊 Server stats'),
      btn('invite', ar ? '➕ أضف البوت' : '➕ Add the bot'),
      btn('donate', ar ? '💝 دعم' : '💝 Support')
    ),
    new ActionRowBuilder().addComponents(btn('guide', ar ? 'دليل المستخدم' : 'User guide', ButtonStyle.Success))
  ];
  if (isAdmin) rows.push(new ActionRowBuilder().addComponents(btn('settings', ar ? '⚙️ إعدادات السيرفر' : '⚙️ Server settings')));
  return { embeds: [embed], components: rows };
}

/** The same interaction, but "the message it came from" is hidden, so helpers that edit an ephemeral card in place send a new one instead. */
const detached = (i) => Object.create(i, {
  message: { value: null }, isMessageComponent: { value: () => false }, isFromMessage: { value: () => false }
});

export async function handleMenu(i) {
  const lang = await GuildSettings.getLanguage(i.guildId);
  const what = i.customId.split(':')[1];
  // These buttons open features that have their own switches: the bot owner's global ones and a server's lock must hold here too.
  const feature = { player: 'voice', mushaf: 'mushaf', wird: 'wird' }[what];
  if (feature && !config.admin.ids.includes(i.user.id)) {
    const ctl = getControlSync();
    let off = !isFeatureOn(ctl, feature);
    if (!off && what === 'player') {
      off = !!globalBlockedBy(ctl, { kind: 'command', name: 'start' })
        || !!blockedBy(await getRestrictions(i.guildId), { kind: 'command', name: 'start' });   // a locked server / a disabled /start
    }
    if (off) return i.reply({ embeds: [buildInfoEmbed(lang === 'ar' ? '⛔ غير متاح' : '⛔ Not available', lang === 'ar' ? 'هذه الميزة متوقفة حالياً.' : 'This feature is switched off right now.', lang)], ephemeral: true });
  }
  switch (what) {
    case 'guide':  return i.reply({ ...guideHome(lang), ephemeral: true });
    case 'guide_topic': return i.update(guideHome(lang, i.values?.[0]));
    case 'player': return startPlayerPanel(i);
    case 'mushaf': return openMushaf(i, null);
    case 'wird':   return startSubscription(detached(i));
    case 'stats':  return i.reply({ ...(await buildStatsMessage(i.guildId)), ephemeral: true });
    case 'donate': return i.reply({ ...buildDonationMessage(lang, config.bot.donationUrl), ephemeral: true });
    case 'invite': {
      const url = buildInviteUrl(i.client.user?.id ?? config.discord.clientId);
      return i.reply({ embeds: [buildInfoEmbed(t(lang, 'commands.invite.title'), [t(lang, 'commands.invite.body'), '', t(lang, 'commands.invite.features'), '', `➡️ **[${t(lang, 'commands.invite.click')}](${url})** — ${t(lang, 'commands.invite.cta')}`].join('\n'), lang)], components: await secondBotComponents(lang, i.guildId), ephemeral: true });
    }
    case 'settings': {
      if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return i.deferUpdate().catch(() => {});
      return i.reply({ ...(await hubHome(i.guild, lang)), ephemeral: true });
    }
  }
}
