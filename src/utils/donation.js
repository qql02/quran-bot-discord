import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { buildInfoEmbed } from './embeds.js';

/** The support card. Pure so it can be tested; `url` comes only from DONATION_URL (validated https in config.js). */
export function buildDonationMessage(lang, url) {
  const ar = lang === 'ar';
  if (!url) {
    return { embeds: [buildInfoEmbed(ar ? 'دعم البوت' : 'Support the bot',
      ar ? 'الدعم المادي غير مفعّل حالياً. شكراً لاهتمامك، والبوت مجاني للجميع.' : 'Donations are not enabled right now. Thank you for caring — the bot is free for everyone.', lang)] };
  }
  const embed = buildInfoEmbed(
    ar ? 'دعم البوت' : 'Support the bot',
    ar
      ? ['البوت **مجاني بالكامل** وسيبقى كذلك، ولا توجد ميزات مدفوعة ولا يتغير شيء بالدعم.',
         'إن أحببت المساهمة في تكاليف الاستضافة والتطوير فدعمك **اختياري تماماً**، وجزاك الله خيراً وبارك فيك.', '',
         'الدفع يتم في صفحة الدعم الخارجية فقط؛ البوت لا يطلب منك أي معلومات دفع داخل ديسكورد.'].join('\n')
      : ['The bot is **completely free** and will stay that way — no paid features, and nothing changes if you donate.',
         'If you would like to help with hosting and development costs, support is **entirely optional**. May Allah reward you.', '',
         'Payment happens only on the external support page; the bot never asks for payment details inside Discord.'].join('\n'),
    lang
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(ar ? 'ادعم البوت' : 'Support the bot').setURL(url)
  );
  return { embeds: [embed], components: [row] };
}
