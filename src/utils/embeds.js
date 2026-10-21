import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

// ─── Color Palette ─────────────────────────────────────────────────────────────
export const COLORS = {
  primary:   0x1A8C4E,
  secondary: 0x0D5C32,
  gold:      0xD4AF37,
  error:     0xE74C3C,
  warning:   0xF39C12,
  info:      0x3498DB,
  success:   0x2ECC71,
  dark:      0x1A1A2E,
  purple:    0x8B5CF6,
  teal:      0x14B8A6
};

// A live binding: every embed reads it when it is BUILT, so it can be switched once the bot is logged in (see below).
export let THUMBNAIL = config.bot.thumbnailUrl;

/** Switch the picture every embed shows (used once at startup by utils/botLogo.js). */
export function setThumbnail(url) { if (typeof url === 'string' && url.startsWith('https://')) THUMBNAIL = url; }

// ─── Status Helpers ────────────────────────────────────────────────────────────
export function statusLabel(session, lang) {
  if (!session) return lang === 'ar' ? '💤 خامل' : '💤 Idle';
  const map = {
    playing: lang === 'ar' ? '🟢 يُشغَّل'  : '🟢 Playing',
    paused:  lang === 'ar' ? '🟡 موقوف'    : '🟡 Paused',
    idle:    lang === 'ar' ? '⚫ خامل'     : '⚫ Idle'
  };
  return map[session.status] ?? map.idle;
}

export function modeLabel(session, lang) {
  if (!session) return lang === 'ar' ? 'عادي' : 'Normal';
  if (session.memorize)  return lang === 'ar' ? `📿 حفظ (×${session.memorize.repeatCount})` : `📿 Memorize (×${session.memorize.repeatCount})`;
  if (session.fullQuran) return lang === 'ar' ? '📖 ختمة' : '📖 Khatma';
  if (session.loop)      return lang === 'ar' ? '🔁 تكرار' : '🔁 Repeat';
  return lang === 'ar' ? 'عادي' : 'Normal';
}

export function volumeBar(vol = 100) {
  const pct   = Math.round((vol / 150) * 10);
  const filled = '█'.repeat(pct);
  const empty  = '░'.repeat(10 - pct);
  return `${filled}${empty} ${vol}%`;
}

function elapsedBar(startedAt) {
  if (!startedAt) return '⬛'.repeat(12);
  const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
  const pos = Math.floor(elapsedSec / 10) % 12;
  return Array.from({ length: 12 }, (_, i) => i === pos ? '🟢' : '⬛').join('');
}

export function formatTime(startedAt, offsetMs = 0) {
  if (!startedAt) return '0:00';
  const s = Math.max(0, Math.floor((Date.now() - startedAt + (offsetMs || 0)) / 1000));   // offsetMs: a recitation resumed mid-way (after /pull) shows where it really is
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Big Panel Embed ───────────────────────────────────────────────────────────
export function buildBigPanelEmbed(session, lang) {
  const isAr = lang === 'ar';

  // ── No session state ───────────────────────────────────────────────────────
  if (!session) {
    return new EmbedBuilder()
      .setColor(COLORS.secondary)
      .setTitle(isAr ? '🕌 لوحة التحكم الرئيسية — بوت القرآن الكريم' : '🕌 Main Control Panel — Quran Bot')
      .setDescription(
        isAr
          ? '> **لا توجد تلاوة الآن**\n> ادخل روماً صوتياً ثم اكتب `/recite` واختر السورة أو القارئ.'
          : '> **Nothing playing**\n> Join a voice channel, then type `/recite` and pick a surah or a reciter.'
      )
      .addFields(
        {
          name:   isAr ? '📌 الأوامر المتاحة' : '📌 Available Commands',
          value:  isAr
            ? '`/recite` `/start` `/hold` `/continue` `/next` `/volume` `/leave` · `/guide` `/help` `/setup`'
            : '`/recite` `/start` `/hold` `/continue` `/next` `/volume` `/leave` · `/guide` `/help` `/setup`',
          inline: false
        }
      )
      .setThumbnail(THUMBNAIL)
      .setTimestamp()
      .setFooter({ text: isAr ? 'بوت القرآن الكريم' : 'Quran Bot', iconURL: THUMBNAIL });
  }

  const cur     = session.current;
  const isRadio = cur?.isRadio ?? false;
  const surahName = cur
    ? (isRadio
        ? (isAr ? `📻 ${cur.surah.arabic}` : `📻 ${cur.surah.english}`)
        : (isAr ? `سورة ${cur.surah.arabic}` : `Surah ${cur.surah.english}`))
    : (isAr ? 'لا يوجد' : 'None');
  const reciterDisplay = cur?.riwaya
    ? `${cur.reciter} · ${cur.riwaya}`
    : (cur?.reciter ?? (isAr ? 'لا يوجد' : 'None'));

  // ── Queue preview (up to 5 next) ───────────────────────────────────────────
  let queuePreview = isAr ? 'قائمة الانتظار فارغة' : 'Queue is empty';
  if (session.queue.length > 0) {
    const lines = session.queue.slice(0, 5).map((item, i) => {
      const name = isAr ? item.surah.arabic : item.surah.english;
      return `\`${i + 1}.\` ${name} — ${item.reciter}`;
    });
    if (session.queue.length > 5) {
      lines.push(isAr ? `… و${session.queue.length - 5} سورة أخرى` : `… and ${session.queue.length - 5} more`);
    }
    queuePreview = lines.join('\n');
  }

  // ── Active modes ───────────────────────────────────────────────────────────
  const activeModes = [];
  if (session.loop)      activeModes.push(isAr ? '🔁 تكرار' : '🔁 Repeat');
  if (session.fullQuran) activeModes.push(isAr ? '📖 ختمة' : '📖 Khatma');
  if (session.memorize)  activeModes.push(isAr ? `📿 حفظ ×${session.memorize.repeatCount}` : `📿 Memorize ×${session.memorize.repeatCount}`);
  if (session.sleepTimer)activeModes.push(isAr ? '😴 مؤقت نوم' : '😴 Sleep Timer');
  const modesStr = activeModes.length > 0 ? activeModes.join('  ·  ') : (isAr ? 'لا يوجد' : 'None');

  return new EmbedBuilder()
    .setColor(session.status === 'playing' ? COLORS.primary : session.status === 'paused' ? COLORS.gold : COLORS.dark)
    .setTitle(isAr ? '🕌 لوحة التحكم الرئيسية — بوت القرآن الكريم' : '🕌 Main Control Panel — Quran Bot')
    .setDescription(
      isAr
        ? `> 📖 **${surahName}**\n> 🎙️ ${reciterDisplay}`
        : `> 📖 **${surahName}**\n> 🎙️ ${reciterDisplay}`
    )
    .addFields(
      // Row 1: Status + Mode
      {
        name:   isAr ? '📡 الحالة' : '📡 Status',
        value:  statusLabel(session, lang),
        inline: true
      },
      {
        name:   isAr ? '⚙️ الوضع' : '⚙️ Mode',
        value:  modeLabel(session, lang),
        inline: true
      },
      {
        name:   isAr ? '🔊 القناة' : '🔊 Channel',
        value:  session.channelName ?? 'Unknown',
        inline: true
      },
      // Row 2: Surah info + queue size
      {
        name:   isAr ? '📖 رقم السورة' : '📖 Surah No.',
        value:  cur ? `#${cur.surah.number} / 114` : (isAr ? 'لا يوجد' : 'None'),
        inline: true
      },
      {
        name:   isAr ? '📊 الآيات' : '📊 Ayahs',
        value:  cur ? `${cur.surah.ayahs} ${isAr ? 'آية' : 'ayahs'}` : '—',
        inline: true
      },
      {
        name:   isAr ? '📋 في القائمة' : '📋 In Queue',
        value:  session.queue.length > 0
          ? (isAr ? `${session.queue.length} سورة` : `${session.queue.length} surah(s)`)
          : (isAr ? 'فارغة' : 'Empty'),
        inline: true
      },
      // Row 3: Volume bar + elapsed time
      {
        name:   isAr ? '🔊 الصوت' : '🔊 Volume',
        value:  `\`${volumeBar(session.volume ?? 100)}\``,
        inline: false
      },
      {
        name:   isAr ? '⏱ التقدم' : '⏱ Progress',
        value:  `${elapsedBar(cur?.startedAt)}  \`${formatTime(cur?.startedAt, cur?.offsetMs)}\``,
        inline: false
      },
      // Row 4: Active modes
      {
        name:   isAr ? '✨ الأوضاع النشطة' : '✨ Active Modes',
        value:  modesStr,
        inline: false
      },
      // Row 5: Queue preview
      {
        name:   isAr ? '📋 التالي في القائمة' : '📋 Up Next',
        value:  queuePreview,
        inline: false
      }
    )
    .setThumbnail(THUMBNAIL)
    .setTimestamp()
    .setFooter({
      text:    isAr ? 'بوت القرآن الكريم • آخر تحديث' : 'Quran Bot • Last updated',
      iconURL: THUMBNAIL
    });
}

// ─── Original Panel Embed (kept for /quran command compatibility) ──────────────
export function buildPanelEmbed(session, lang) {
  return buildBigPanelEmbed(session, lang);
}

// ─── Now Playing Embed ─────────────────────────────────────────────────────────

// ─── Error / Success / Info Embeds ────────────────────────────────────────────
export function buildErrorEmbed(message, lang = 'en') {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(lang === 'ar' ? '❌ خطأ' : '❌ Error')
    .setDescription(message)
    .setTimestamp();
}

export function buildSuccessEmbed(title, description, lang = 'en') {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`✅  ${title}`)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: lang === 'ar' ? 'بوت القرآن الكريم' : 'Quran Bot', iconURL: THUMBNAIL });
}

export function buildInfoEmbed(title, description, lang = 'en') {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(title)
    .setDescription(description)
    .setThumbnail(THUMBNAIL)
    .setTimestamp()
    .setFooter({ text: lang === 'ar' ? 'بوت القرآن الكريم' : 'Quran Bot', iconURL: THUMBNAIL });
}

// ─── Queue Embed ───────────────────────────────────────────────────────────────
export function buildQueueEmbed(session, page, lang) {
  const pageSize   = 10;
  const queue      = session.queue;
  const totalPages = Math.max(1, Math.ceil(queue.length / pageSize));
  const safePage   = Math.min(Math.max(1, page), totalPages);
  const start      = (safePage - 1) * pageSize;
  const slice      = queue.slice(start, start + pageSize);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(lang === 'ar' ? '📋 قائمة انتظار التلاوة' : '📋 Recitation Queue')
    .setThumbnail(THUMBNAIL)
    .setTimestamp()
    .setFooter({
      text: lang === 'ar'
        ? `الصفحة ${safePage} من ${totalPages} • إجمالي ${queue.length} سورة`
        : `Page ${safePage} of ${totalPages} • ${queue.length} surah(s) total`
    });

  if (session.current) {
    const cur  = session.current;
    const name = lang === 'ar' ? cur.surah.arabic : cur.surah.english;
    embed.addFields({ name: lang === 'ar' ? '▶ يُشغَّل الآن' : '▶ Now Playing', value: `**${name}** · ${cur.reciter}`, inline: false });
  }

  if (slice.length === 0) {
    embed.setDescription(lang === 'ar' ? 'قائمة الانتظار فارغة.' : 'The queue is empty.');
  } else {
    const lines = slice.map((item, i) => {
      const n = lang === 'ar' ? item.surah.arabic : item.surah.english;
      return `\`${start + i + 1}.\` **${n}** · ${item.reciter}`;
    });
    embed.setDescription(lines.join('\n'));
  }

  return { embed, totalPages, currentPage: safePage };
}
