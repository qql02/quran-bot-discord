import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags
} from 'discord.js';
import { COLORS, statusLabel, modeLabel, volumeBar, formatTime } from './embeds.js';
import { buildBigPanelButtons, buildPanelSelects } from './buttons.js';

// ─── Control panel as ONE card (Components V2) ─────────────────────────────────
// Discord cannot put buttons inside an embed. A V2 Container is the closest thing: text AND buttons live in the same
// card with one accent colour. V2 messages cannot carry `content` or `embeds`, so everything is a TextDisplay.
// Limits (Discord): ≤ 40 components in total, ≤ 4000 characters of text across the message — this layout uses ~20 / ~900.

const text = (md) => new TextDisplayBuilder().setContent(md);
const sep  = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/** What the buttons of an idle panel are for (the panel replaces the old slash commands, so this is all there is to learn). */
const GUIDE = (isAr) => isAr
  ? ['**🎛 كل شيء بالأزرار والقوائم**',
     '📖 **ابدأ ختمة** القرآن كاملاً بالترتيب · 📻 **إذاعة** مباشرة · قائمة **السور** لأي سورة تريد',
     '⚙️ **أدوات**: وضع الحفظ، مؤقت النوم، قارئ آخر أو رواية، مفضلتي، مسح القائمة',
     '`/recite` قارئ بالاسم · `/hold` `/next` `/volume` `/leave` · `/pull` سحب التلاوة لرومك · `/guide` دليل المستخدم',
     'الأذكار والفعاليات واللغة (للمشرفين): `/setup` · وكل ما سواه: `/help`'].join('\n')
  : ['**🎛 Everything is buttons and menus**',
     '📖 **Start a Khatma** the whole Quran in order · 📻 **Radio** live · the **surah** menu for any surah',
     '⚙️ **Tools**: memorize, sleep timer, another reciter or narration, favourites, clear the queue',
     '`/recite` a reciter by name · `/hold` `/next` `/volume` `/leave` · `/pull` bring it to your room · `/guide` the user guide',
     'Adhkar, events and language (admins): `/setup` · everything else: `/help`'].join('\n');

/** Flag every V2 message must carry — also when it is EDITED. */
export const PANEL_FLAGS = MessageFlags.IsComponentsV2;

/** True when a message was sent as a V2 card (older embed panels are edited the old way). */
export const isPanelCard = (message) => !!message?.flags?.has?.(MessageFlags.IsComponentsV2);

/** The page of the surah menu shown on a panel message (its id is `panel:pick_surah:<page>`): redrawing must not send it back to page 1. */
export function surahPageOf(message) {
  const walk = (list) => {
    for (const c of list ?? []) {
      const id = c?.customId ?? c?.data?.custom_id;
      const m = typeof id === 'string' ? id.match(/^panel:pick_surah:(\d+)$/) : null;
      if (m) return Number(m[1]);
      const inner = walk(c?.components);
      if (inner !== null) return inner;
    }
    return null;
  };
  return walk(message?.components) ?? 0;
}

/**
 * @returns {{ components: ContainerBuilder[], flags: number }}  spread straight into reply / editReply / update / edit
 */
export function buildPanelMessage(session, lang, guildId = session?.guildId, surahPage = 0) {
  const isAr = lang === 'ar';
  const title = isAr ? '## 🕌 لوحة تحكم القرآن الكريم' : '## 🕌 Quran Control Panel';

  const accent = !session ? COLORS.secondary
    : session.status === 'playing' ? COLORS.primary
    : session.status === 'paused'  ? COLORS.gold
    : COLORS.dark;

  const card = new ContainerBuilder().setAccentColor(accent);

  if (!session) {
    card.addTextDisplayComponents(text(
      `${title}\n` + (isAr
        ? '**لا توجد تلاوة الآن**\n١. ادخل روماً صوتياً\n٢. اضغط **ابدأ ختمة** أو **إذاعة مباشرة** أو اختر سورة من القائمة (كل السور الـ114)'
        : '**Nothing playing**\n1. Join a voice channel\n2. Press **Start a Khatma** or **Live radio**, or pick any of the 114 surahs from the menu')
    ));
    card.addSeparatorComponents(sep());
    card.addTextDisplayComponents(text(GUIDE(isAr)));
  } else {
    const cur     = session.current;
    const isRadio = !!cur?.isRadio;
    const none    = isAr ? 'لا يوجد' : 'None';

    const name = cur
      ? (isRadio ? `📻 ${isAr ? cur.surah.arabic : cur.surah.english}`
                 : (isAr ? `📖 سورة ${cur.surah.arabic}` : `📖 Surah ${cur.surah.english}`))
      : none;
    const reciter = cur?.riwaya ? `${cur.reciter} · ${cur.riwaya}` : (cur?.reciter ?? none);

    card.addTextDisplayComponents(text(`${title}\n### ${name}\n🎙️ ${reciter}`));
    card.addSeparatorComponents(sep());

    const lines = [
      `📡 **${isAr ? 'الحالة' : 'Status'}:** ${statusLabel(session, lang)}   ⚙️ **${isAr ? 'الوضع' : 'Mode'}:** ${modeLabel(session, lang)}`,
      `🔊 **${isAr ? 'الروم' : 'Channel'}:** ${session.channelName ?? '—'}`
    ];
    if (cur && !isRadio) {
      lines.push(`📖 **${isAr ? 'السورة' : 'Surah'}:** #${cur.surah.number}/114 · ${cur.surah.ayahs} ${isAr ? 'آية' : 'ayahs'}   ⏱ \`${formatTime(cur.startedAt, cur.offsetMs)}\``);
    } else if (cur && isRadio) {
      lines.push(`🔴 ${isAr ? 'بث مباشر' : 'Live stream'}   ⏱ \`${formatTime(cur.startedAt)}\``);
    }
    lines.push(`🔉 \`${volumeBar(session.volume ?? 100)}\``);

    const modes = [];
    if (session.loop)       modes.push(isAr ? '🔁 تكرار' : '🔁 Repeat');
    if (session.fullQuran)  modes.push(isAr ? '📖 ختمة' : '📖 Khatma');
    if (session.memorize)   modes.push(isAr ? `📿 حفظ ×${session.memorize.repeatCount}` : `📿 Memorize ×${session.memorize.repeatCount}`);
    if (session.sleepTimer) modes.push(isAr ? '😴 مؤقت نوم' : '😴 Sleep timer');
    if (modes.length) lines.push(`✨ ${modes.join('  ·  ')}`);

    card.addTextDisplayComponents(text(lines.join('\n')));

    if (session.queue.length) {
      const next = session.queue.slice(0, 5).map((item, i) =>
        `\`${i + 1}.\` ${isAr ? item.surah.arabic : item.surah.english} — ${item.reciter}`);
      if (session.queue.length > 5) next.push(isAr ? `… و${session.queue.length - 5} أخرى` : `… and ${session.queue.length - 5} more`);
      card.addSeparatorComponents(sep());
      card.addTextDisplayComponents(text(`**📋 ${isAr ? `التالي (${session.queue.length})` : `Up next (${session.queue.length})`}**\n${next.join('\n')}`));
    }
  }

  // The buttons live INSIDE the card, under the text.
  card.addSeparatorComponents(sep());
  card.addActionRowComponents(...buildBigPanelButtons(session, lang), ...buildPanelSelects(lang, guildId, surahPage));
  card.addTextDisplayComponents(text(`-# ${isAr ? 'بوت القرآن الكريم • آخر تحديث' : 'Quran Bot • updated'} <t:${Math.floor(Date.now() / 1000)}:R>`));

  return { components: [card], flags: PANEL_FLAGS };
}
