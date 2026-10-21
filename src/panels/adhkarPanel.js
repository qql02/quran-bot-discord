import {
  EmbedBuilder, ChannelType, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { expiryHoursOf, nextExpiryChoice, expiryLabel } from '../utils/adhkarExpiry.js';
import { buildErrorEmbed, buildSuccessEmbed, COLORS, THUMBNAIL } from '../utils/embeds.js';
import { sendAdhkar, sendScatter } from '../services/adhkarService.js';
import { sendAyah } from '../services/ayahService.js';
import { DEFAULT_AYAH_TIME } from '../data/ayahs.js';
import { sendHadith } from '../services/hadithService.js';
import { DEFAULT_HADITH_TIME } from '../data/hadiths.js';
import {
  parseTime, resolveTimeZone, suggestTimeZones, localClock, toMinutes, scatterSettings,
  DEFAULT_TIMEZONE, DEFAULT_MORNING, DEFAULT_EVENING,
  SCATTER_LIMIT_MIN_GAP, SCATTER_LIMIT_MAX_GAP, SCATTER_MIN_WINDOW
} from '../utils/adhkarSchedule.js';

// ═════════════════════════════════════════════════════════════════════════════
//  Adhkar + verse-of-the-day + hadith-of-the-day settings (a page of the /setup panel).
//  Stateless: every press reloads the saved settings, so the card never expires (it used to stop after 5 minutes) and
//  survives a restart. Three views in ONE message: 'main' (morning / evening / all-day adhkar), 'ayah' (verse of the day) and 'hadith' (hadith of the day).
//  Component ids start with "adhkar:" and are routed here by interactionCreate; the modals are awaited right here.
// ═════════════════════════════════════════════════════════════════════════════

const SEND_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
const KIND_AR    = { morning: 'الصباح', evening: 'المساء' };

// Post styles of the morning/evening sets, in the order the style button cycles through them.
const STYLE_LABEL = { full: 'كامل', compact: 'مختصر' };
const STYLE_NEXT  = { full: 'compact', compact: 'full' };
const STYLE_TEXT  = {
  full:    '📜 **كامل** — القرآن + جميع الأذكار',
  compact: '✨ **مختصر** — أهم الأذكار في رسالة واحدة'
};

const nowMinutes = (tz) => { try { return localClock(tz || DEFAULT_TIMEZONE).minutes; } catch { return undefined; } };
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** One line describing the all-day posts, for the panel. */
function scatterText(a) {
  if (!a.scatter?.enabled) return '⛔ متوقفة';
  const { from, to, minGap, maxGap } = scatterSettings(a.scatter);
  const gap = minGap === maxGap ? `${minGap}` : `${minGap}–${maxGap}`;
  return `✅ ذكر أو دعاء كل **${gap}** دقيقة تقريباً، بين \`${hhmm(from)}\` و\`${hhmm(to)}\``;
}

// Per-guild cooldown for the "test" subcommand so a manager can't spam the channel.
const testCooldown = new Map();
const TEST_COOLDOWN_MS = 30_000;
setInterval(() => { const cut = Date.now() - TEST_COOLDOWN_MS; for (const [k, ts] of testCooldown) if (ts < cut) testCooldown.delete(k); }, 5 * 60_000).unref?.();

/** The "did not recognise your place" message, with the closest names when there are any. */
const zoneError = (typed) => {
  const shown = String(typed).replace(/[`*_~|>\\\n]/g, '').slice(0, 40);
  const maybe = suggestTimeZones(shown, 'ar');
  return `لم أتعرف على «${shown}» — اكتب اسم بلدك أو مدينتك (مثل: الجزائر، وهران) أو \`UTC+1\`${maybe.length ? `\nهل تقصد: ${maybe.join(' · ')}؟` : ''}`;
};

const clock = (tz) => { try { const c = localClock(tz); return `${String(Math.floor(c.minutes / 60)).padStart(2, '0')}:${String(c.minutes % 60).padStart(2, '0')}`; } catch { return '—'; } };
const onOff = (v) => (v ? '✅ مفعّل' : '⛔ متوقف');

/** The panel has three pages in ONE message: 'main' (morning/evening adhkar), 'ayah' (verse of the day) and 'hadith'. */
async function loadState(guildId) {
  const doc = await GuildSettings.findOne({ guildId }, { adhkar: 1, ayah: 1, hadith: 1 }).lean();
  return { a: doc?.adhkar ?? {}, y: doc?.ayah ?? {}, h: doc?.hadith ?? {} };
}
async function saveSection(guildId, section, set) {
  const $set = Object.fromEntries(Object.entries(set).map(([k, v]) => [`${section}.${k}`, v]));
  await GuildSettings.findOneAndUpdate({ guildId }, { $set }, { upsert: true });
  return loadState(guildId);
}

function panelEmbed(a) {
  const tz = a.timezone || DEFAULT_TIMEZONE;
  return new EmbedBuilder()
    .setColor(a.enabled ? COLORS.success : COLORS.dark)
    .setTitle('🌅 لوحة أذكار الصباح والمساء')
    .setDescription('ابدأ باختيار **قناة النشر** من القائمة، ثم فعّل ما تريد. التغييرات تُحفظ فوراً.\n🎲 **أذكار خلال اليوم**: ذكر أو دعاء قصير كل ساعة تقريباً (صباح، مساء، نوم، استيقاظ، وغيرها)، غير أذكار الصباح والمساء الكاملة.\n📖 لإعداد **آية اليوم** أو 📜 **حديث اليوم** (كل واحد في روم خاص) اضغط الزر المخصص له.')
    .addFields(
      { name: '📡 الحالة',          value: onOff(a.enabled), inline: true },
      { name: '📍 القناة',          value: a.channelId ? `<#${a.channelId}>` : '`لم تُحدد`', inline: true },
      { name: '🔔 رتبة المنشن',     value: a.roleId ? `<@&${a.roleId}>` : '`بدون`', inline: true },
      { name: '🌅 الصباح',          value: `\`${a.morningTime || DEFAULT_MORNING}\``, inline: true },
      { name: '🌙 المساء',          value: `\`${a.eveningTime || DEFAULT_EVENING}\``, inline: true },
      { name: '🌍 المنطقة الزمنية', value: `\`${tz}\`\nالآن: \`${clock(tz)}\``, inline: true },
      { name: '🎨 النمط',           value: STYLE_TEXT[a.style] ?? STYLE_TEXT.full, inline: false },
      { name: '🎲 أذكار خلال اليوم', value: scatterText(a), inline: false },
      { name: '🧹 حذف المنشور السابق', value: a.deleteOld ? '✅ يُحذف منشور الأمس عند نشر الجديد' : '⛔ تبقى المنشورات في القناة', inline: false },
      { name: '⏳ حذف تلقائي', value: expiryHoursOf(a) ? `✅ أذكار الصباح والمساء تُحذف **${expiryLabel(expiryHoursOf(a))}** من نشرها` : '⛔ تبقى أذكار الصباح والمساء في القناة', inline: false }
    )
    .setThumbnail(THUMBNAIL)
    .setFooter({ text: 'الأخضر = مفعّل، اضغط عليه للتبديل · التغييرات تُحفظ فوراً' });
}

function ayahEmbed(y, a) {
  const tz = y.timezone || a.timezone || DEFAULT_TIMEZONE;
  return new EmbedBuilder()
    .setColor(y.enabled ? COLORS.gold : COLORS.dark)
    .setTitle('لوحة آية اليوم')
    .setDescription('آية مع **التفسير الميسر** تُنشر يومياً في **روم مخصص** (مستقل عن روم الأذكار).')
    .addFields(
      { name: 'الحالة',          value: onOff(y.enabled), inline: true },
      { name: 'الروم',           value: y.channelId ? `<#${y.channelId}>` : '`لم يُحدد`', inline: true },
      { name: 'رتبة المنشن',     value: y.roleId ? `<@&${y.roleId}>` : '`بدون`', inline: true },
      { name: 'وقت النشر',       value: `\`${y.time || DEFAULT_AYAH_TIME}\``, inline: true },
      { name: 'المنطقة الزمنية', value: `\`${tz}\`${y.timezone ? '' : ' (نفس أذكار الصباح)'}\nالآن: \`${clock(tz)}\``, inline: true }
    )
    .setThumbnail(THUMBNAIL)
    .setFooter({ text: 'الأخضر = مفعّل، اضغط عليه للتبديل · التغييرات تُحفظ فوراً' });
}

function hadithEmbed(h, a) {
  const tz = h.timezone || a.timezone || DEFAULT_TIMEZONE;
  return new EmbedBuilder()
    .setColor(h.enabled ? COLORS.gold : COLORS.dark)
    .setTitle('لوحة حديث اليوم')
    .setDescription('حديث من **الأربعين النووية** و**رياض الصالحين** (ما أخرجه البخاري ومسلم) يُنشر يومياً في **روم مخصص**، مع رقم الحديث ورابط المصدر.')
    .addFields(
      { name: 'الحالة',          value: onOff(h.enabled), inline: true },
      { name: 'الروم',           value: h.channelId ? `<#${h.channelId}>` : '`لم يُحدد`', inline: true },
      { name: 'رتبة المنشن',     value: h.roleId ? `<@&${h.roleId}>` : '`بدون`', inline: true },
      { name: 'وقت النشر',       value: `\`${h.time || DEFAULT_HADITH_TIME}\``, inline: true },
      { name: 'المنطقة الزمنية', value: `\`${tz}\`${h.timezone ? '' : ' (نفس أذكار الصباح)'}\nالآن: \`${clock(tz)}\``, inline: true }
    )
    .setThumbnail(THUMBNAIL)
    .setFooter({ text: 'الأخضر = مفعّل، اضغط عليه للتبديل · التغييرات تُحفظ فوراً' });
}

const pickChannel = (id, label, def) => {
  const m = new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(label)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (def) m.setDefaultChannels(def);
  return new ActionRowBuilder().addComponents(m);
};
const pickRole = (id, def) => {
  const m = new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder('🔔 رتبة المنشن (اختيارية) — امسحها للإلغاء').setMinValues(0).setMaxValues(1);
  if (def) m.setDefaultRoles(def);
  return new ActionRowBuilder().addComponents(m);
};

// A toggle shows its CURRENT state (green = on, grey = off) and flips when pressed. Turning one on needs a channel first,
// so until a channel is picked the "on" button is disabled and the placeholder tells the admin where to start.
const toggleBtn = (id, label, on, canEnable) => new ButtonBuilder().setCustomId(id)
  .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary)
  .setEmoji(on ? '✅' : '⛔')
  .setLabel(`${label}: ${on ? 'مفعّل' : 'متوقف'}`)
  .setDisabled(!on && !canEnable);

function panelRows(a, disabled = false) {
  // Top to bottom: morning/evening · all-day adhkar (+ page of the verse of the day) · test · pickers (start from the channel).
  const hasChannel = !!a.channelId;
  const row1 = new ActionRowBuilder().addComponents(
    toggleBtn('adhkar:toggle', 'الصباح والمساء', a.enabled, hasChannel),
    new ButtonBuilder().setCustomId('adhkar:times').setStyle(ButtonStyle.Primary).setEmoji('🕐').setLabel('ضبط الأوقات والمنطقة'),
    new ButtonBuilder().setCustomId('adhkar:style').setStyle(ButtonStyle.Secondary)
      .setEmoji(a.style === 'compact' ? '✨' : '📜').setLabel(`شكل المنشور: ${STYLE_LABEL[a.style] ?? STYLE_LABEL.full}`),
    new ButtonBuilder().setCustomId('adhkar:delold').setStyle(a.deleteOld ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji('🧹').setLabel(`حذف منشور الأمس: ${a.deleteOld ? 'نعم' : 'لا'}`),
    new ButtonBuilder().setCustomId('adhkar:expire').setStyle(expiryHoursOf(a) ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji('⏳').setLabel(`حذف تلقائي: ${expiryLabel(expiryHoursOf(a))}`)
  );
  const row2 = new ActionRowBuilder().addComponents(
    toggleBtn('adhkar:sc:toggle', 'أذكار اليوم', !!a.scatter?.enabled, hasChannel),
    new ButtonBuilder().setCustomId('adhkar:sc:cfg').setStyle(ButtonStyle.Primary).setEmoji('⏱️').setLabel('ضبط فترة أذكار اليوم'),
    new ButtonBuilder().setCustomId('adhkar:view:ayah').setStyle(ButtonStyle.Secondary).setEmoji('📖').setLabel('إعدادات آية اليوم'),
    new ButtonBuilder().setCustomId('adhkar:view:hadith').setStyle(ButtonStyle.Secondary).setEmoji('📜').setLabel('إعدادات حديث اليوم'),
    new ButtonBuilder().setCustomId('hub:home').setStyle(ButtonStyle.Secondary).setEmoji('🏠').setLabel('الرئيسية')
  );
  const test = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('adhkar:testpick').setDisabled(!hasChannel)
      .setPlaceholder(hasChannel ? '🧪 جرّب منشوراً الآن (يُرسل في القناة فعلاً)' : '🧪 اختر القناة أولاً لتفعيل التجربة')
      .setMinValues(1).setMaxValues(1)
      .addOptions([
        { label: 'أذكار الصباح', value: 'morning', emoji: '🌅', description: 'المنشور الكامل كما سيصل' },
        { label: 'أذكار المساء', value: 'evening', emoji: '🌙', description: 'المنشور الكامل كما سيصل' },
        { label: 'ذكر من أذكار اليوم', value: 'scatter', emoji: '🎲', description: 'رسالة قصيرة تناسب الوقت الحالي' }
      ])
  );
  const rows = [row1, row2, test, pickChannel('adhkar:channel', hasChannel ? '📍 غيّر قناة النشر' : '① ابدأ باختيار قناة النشر', a.channelId), pickRole('adhkar:role', a.roleId)];
  if (disabled) rows.forEach(r => r.components.forEach(c => c.setDisabled(true)));
  return rows;
}

function ayahRows(y, disabled = false) {
  const hasChannel = !!y.channelId;
  const row1 = new ActionRowBuilder().addComponents(
    toggleBtn('adhkar:ayah:toggle', 'آية اليوم', !!y.enabled, hasChannel),
    new ButtonBuilder().setCustomId('adhkar:ayah:times').setStyle(ButtonStyle.Primary).setEmoji('🕐').setLabel('ضبط الوقت والمنطقة'),
    new ButtonBuilder().setCustomId('adhkar:ayah:test').setStyle(ButtonStyle.Secondary).setEmoji('🧪').setLabel('جرّب الآن').setDisabled(!hasChannel),
    new ButtonBuilder().setCustomId('adhkar:view:main').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setLabel('رجوع للأذكار'),
    new ButtonBuilder().setCustomId('hub:home').setStyle(ButtonStyle.Secondary).setEmoji('🏠').setLabel('الرئيسية')
  );
  const rows = [row1, pickChannel('adhkar:ayah:channel', hasChannel ? '📍 غيّر روم آية اليوم' : '① ابدأ باختيار روم آية اليوم', y.channelId), pickRole('adhkar:ayah:role', y.roleId)];
  if (disabled) rows.forEach(r => r.components.forEach(c => c.setDisabled(true)));
  return rows;
}

function hadithRows(h, disabled = false) {
  const hasChannel = !!h.channelId;
  const row1 = new ActionRowBuilder().addComponents(
    toggleBtn('adhkar:hadith:toggle', 'حديث اليوم', !!h.enabled, hasChannel),
    new ButtonBuilder().setCustomId('adhkar:hadith:times').setStyle(ButtonStyle.Primary).setEmoji('🕐').setLabel('ضبط الوقت والمنطقة'),
    new ButtonBuilder().setCustomId('adhkar:hadith:test').setStyle(ButtonStyle.Secondary).setEmoji('🧪').setLabel('جرّب الآن').setDisabled(!hasChannel),
    new ButtonBuilder().setCustomId('adhkar:view:main').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setLabel('رجوع للأذكار'),
    new ButtonBuilder().setCustomId('hub:home').setStyle(ButtonStyle.Secondary).setEmoji('🏠').setLabel('الرئيسية')
  );
  const rows = [row1, pickChannel('adhkar:hadith:channel', hasChannel ? '📍 غيّر روم حديث اليوم' : '① ابدأ باختيار روم حديث اليوم', h.channelId), pickRole('adhkar:hadith:role', h.roleId)];
  if (disabled) rows.forEach(r => r.components.forEach(c => c.setDisabled(true)));
  return rows;
}

// A deleted channel/role must not break the panel (select-menu defaults) or show a dead mention.
function sanitize(x, guild) {
  return {
    ...x,
    channelId: x.channelId && guild.channels.cache.has(x.channelId) ? x.channelId : null,
    roleId:    x.roleId    && guild.roles.cache.has(x.roleId)       ? x.roleId    : null
  };
}
const panelPayload = ({ a, y, h }, guild, view = 'main', disabled = false) => {
  const sa = sanitize(a, guild); const sy = sanitize(y, guild); const sh = sanitize(h ?? {}, guild);
  if (view === 'ayah')   return { embeds: [ayahEmbed(sy, sa)],     components: ayahRows(sy, disabled) };
  if (view === 'hadith') return { embeds: [hadithEmbed(sh, sa)],   components: hadithRows(sh, disabled) };
  return { embeds: [panelEmbed(sa)], components: panelRows(sa, disabled) };
};

/** Role picked in a select menu → { roleId } or { error }. Never @everyone; never a role the manager couldn't ping. */
export function checkRole(i, guildId) {
  const role = i.roles.first() ?? null;
  if (!role) return { roleId: null };
  if (role.id === guildId) return { error: 'لا يمكن اختيار @everyone كرتبة للمنشن.' };
  if (!(role.mentionable || i.memberPermissions?.has(PermissionFlagsBits.MentionEveryone))) {
    return { error: `لا يمكنك جعل البوت يمنشن ${role}: الرتبة غير قابلة للمنشن وليس لديك صلاحية **mention everyone**.` };
  }
  return { roleId: role.id };
}
export const channelProblem = (channel, guild) => channel?.permissionsFor?.(guild.members.me)?.has(SEND_PERMS) ? null
  : `ليس لدي صلاحيات كافية في <#${channel?.id}>.\nأحتاج: **عرض القناة** و**إرسال الرسائل** و**تضمين الروابط**.`;


const viewOf = (i) => {
  const ids = (i.message?.components ?? []).flatMap(r => (r.components ?? []).map(c => c.customId ?? c.data?.custom_id));
  if (ids.includes('adhkar:hadith:toggle')) return 'hadith';
  return ids.includes('adhkar:ayah:toggle') ? 'ayah' : 'main';
};

/** The adhkar card for a server — what /setup shows when the admin opens this page. */
export async function adhkarPage(guild, view = 'main') {
  return panelPayload(await loadState(guild.id), guild, view);
}

/** Every component of the adhkar card (ids "adhkar:…"). Manage Server is checked on every press. */
export async function handleAdhkarComponent(i) {
  const guildId = i.guildId;
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return i.reply({ embeds: [buildErrorEmbed('تحتاج صلاحية **إدارة السيرفر** لاستخدام هذه اللوحة.\nYou need the **Manage Server** permission.', 'ar')], ephemeral: true });
  }
  let state = null;
  let view  = viewOf(i);
  const say = (x, text, ok = false) => x.followUp?.({ embeds: [ok ? buildSuccessEmbed('تم', text, 'ar') : buildErrorEmbed(text, 'ar')], ephemeral: true }).catch(() => {});
  const err = (x, text) => x.reply({ embeds: [buildErrorEmbed(text, 'ar')], ephemeral: true });
  const refresh = (x) => x.update(panelPayload(state, i.guild, view));

  try {
      const id = i.customId;
      state = await loadState(guildId);   // always act on the latest saved settings, never a stale copy

      // ── Page switch ─────────────────────────────────────────────────────
      if (id === 'adhkar:view:ayah' || id === 'adhkar:view:main' || id === 'adhkar:view:hadith') {
        view = id.endsWith('ayah') ? 'ayah' : id.endsWith('hadith') ? 'hadith' : 'main';
        return refresh(i);
      }

      // ═════════ Hadith of the day page ═════════
      if (id.startsWith('adhkar:hadith:')) {
        const { h, a } = state;

        if (id === 'adhkar:hadith:times') {
          const modal = new ModalBuilder().setCustomId('adhkar:hadith-times-modal').setTitle('وقت حديث اليوم').addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('time').setLabel('وقت النشر (HH:MM — 24 ساعة)')
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(h.time || DEFAULT_HADITH_TIME)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tz').setLabel('بلدك أو المنطقة (اتركه فارغاً = نفس الأذكار)')
              .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(64).setValue(h.timezone || ''))
          );
          await i.showModal(modal);
          const sub = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === 'adhkar:hadith-times-modal' && m.user.id === i.user.id }).catch(() => null);
          if (!sub) return;
          const time = parseTime(sub.fields.getTextInputValue('time'));
          const rawTz = sub.fields.getTextInputValue('tz').trim();
          const tz = rawTz ? resolveTimeZone(rawTz) : null;
          const errs = [];
          if (!time) errs.push('الوقت غير صالح — مثال: `13:00`');
          if (rawTz && !tz) errs.push(zoneError(rawTz));
          if (errs.length) return sub.reply({ embeds: [buildErrorEmbed(errs.join('\n'), 'ar')], ephemeral: true });
          state = await saveSection(guildId, 'hadith', { time, timezone: tz });
          return sub.update(panelPayload(state, i.guild, view));
        }

        if (id === 'adhkar:hadith:test') {
          if (!h.channelId) return err(i, 'اختر روم حديث اليوم أولاً من القائمة.');
          const key = `${guildId}:hadith`;
          const wait = (testCooldown.get(key) ?? 0) + TEST_COOLDOWN_MS - Date.now();
          if (wait > 0) return err(i, `انتظر ${Math.ceil(wait / 1000)} ثانية قبل تجربة أخرى.`);
          testCooldown.set(key, Date.now());
          await i.deferReply({ ephemeral: true });
          const tz = h.timezone || a.timezone || DEFAULT_TIMEZONE;
          const res = await sendHadith(i.client, guildId, h.channelId, localClock(tz).date, { roleId: h.roleId });
          const why = {
            unknown_channel: 'الروم المحفوظ لم يعد موجوداً — اختر رومًا آخر.',
            not_text:        'الروم المحدد ليس نصياً.',
            no_permission:   `ليس لدي صلاحيات كافية في <#${h.channelId}> (عرض القناة، إرسال الرسائل، تضمين الروابط).`
          }[res.reason] ?? 'تعذّر الإرسال — تأكد من الروم والصلاحيات.';
          return i.editReply({ embeds: [res.ok ? buildSuccessEmbed('تم الإرسال', `أُرسل حديث اليوم في <#${h.channelId}>.`, 'ar') : buildErrorEmbed(why, 'ar')] });
        }

        if (id === 'adhkar:hadith:toggle') {
          if (!h.enabled && !h.channelId) return err(i, 'اختر روم حديث اليوم من القائمة أولاً ثم فعّل.');
          state = await saveSection(guildId, 'hadith', { enabled: !h.enabled });
        } else if (id === 'adhkar:hadith:channel') {
          const channel = i.channels.first();
          const problem = channelProblem(channel, i.guild);
          if (problem) return err(i, problem);
          state = await saveSection(guildId, 'hadith', { channelId: channel.id });
        } else if (id === 'adhkar:hadith:role') {
          const r = checkRole(i, guildId);
          if (r.error) return err(i, r.error);
          state = await saveSection(guildId, 'hadith', { roleId: r.roleId });
        } else return;
        return refresh(i);
      }

      // ═════════ Verse of the day page ═════════
      if (id.startsWith('adhkar:ayah:')) {
        const { y, a } = state;

        if (id === 'adhkar:ayah:times') {
          const modal = new ModalBuilder().setCustomId('adhkar:ayah-times-modal').setTitle('وقت آية اليوم').addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('time').setLabel('وقت النشر (HH:MM — 24 ساعة)')
              .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(y.time || DEFAULT_AYAH_TIME)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tz').setLabel('بلدك أو المنطقة (اتركه فارغاً = نفس الأذكار)')
              .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(64).setValue(y.timezone || ''))
          );
          await i.showModal(modal);
          const sub = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === 'adhkar:ayah-times-modal' && m.user.id === i.user.id }).catch(() => null);
          if (!sub) return;
          const time = parseTime(sub.fields.getTextInputValue('time'));
          const rawTz = sub.fields.getTextInputValue('tz').trim();
          const tz = rawTz ? resolveTimeZone(rawTz) : null;
          const errs = [];
          if (!time) errs.push('الوقت غير صالح — مثال: `08:00`');
          if (rawTz && !tz) errs.push(zoneError(rawTz));
          if (errs.length) return sub.reply({ embeds: [buildErrorEmbed(errs.join('\n'), 'ar')], ephemeral: true });
          state = await saveSection(guildId, 'ayah', { time, timezone: tz });
          return sub.update(panelPayload(state, i.guild, view));
        }

        if (id === 'adhkar:ayah:test') {
          if (!y.channelId) return err(i, 'اختر روم آية اليوم أولاً من القائمة.');
          const key = `${guildId}:ayah`;
          const wait = (testCooldown.get(key) ?? 0) + TEST_COOLDOWN_MS - Date.now();
          if (wait > 0) return err(i, `انتظر ${Math.ceil(wait / 1000)} ثانية قبل تجربة أخرى.`);
          testCooldown.set(key, Date.now());
          await i.deferReply({ ephemeral: true });
          const tz = y.timezone || a.timezone || DEFAULT_TIMEZONE;
          const res = await sendAyah(i.client, guildId, y.channelId, localClock(tz).date, { roleId: y.roleId });
          const why = {
            api_failed:      'تعذّر جلب الآية من خدمة القرآن الآن — حاول بعد قليل.',
            unknown_channel: 'الروم المحفوظ لم يعد موجوداً — اختر رومًا آخر.',
            not_text:        'الروم المحدد ليس نصياً.',
            no_permission:   `ليس لدي صلاحيات كافية في <#${y.channelId}> (عرض القناة، إرسال الرسائل، تضمين الروابط).`
          }[res.reason] ?? 'تعذّر الإرسال — تأكد من الروم والصلاحيات.';
          return i.editReply({ embeds: [res.ok ? buildSuccessEmbed('تم الإرسال', `أُرسلت آية اليوم في <#${y.channelId}>.`, 'ar') : buildErrorEmbed(why, 'ar')] });
        }

        if (id === 'adhkar:ayah:toggle') {
          if (!y.enabled && !y.channelId) return err(i, 'اختر روم آية اليوم من القائمة أولاً ثم فعّل.');
          state = await saveSection(guildId, 'ayah', { enabled: !y.enabled });
        } else if (id === 'adhkar:ayah:channel') {
          const channel = i.channels.first();
          const problem = channelProblem(channel, i.guild);
          if (problem) return err(i, problem);
          state = await saveSection(guildId, 'ayah', { channelId: channel.id });
        } else if (id === 'adhkar:ayah:role') {
          const r = checkRole(i, guildId);
          if (r.error) return err(i, r.error);
          state = await saveSection(guildId, 'ayah', { roleId: r.roleId });
        } else return;
        return refresh(i);
      }

      // ═════════ Adhkar page ═════════
      const a = state.a;

      // ── Random-time posts (settings modal / test / toggle) ──────────────
      if (id === 'adhkar:sc:cfg') {
        const sc = scatterSettings(a.scatter);
        const field = (cid, label, value, max) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(cid).setLabel(label)
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max).setValue(value));
        const modal = new ModalBuilder().setCustomId('adhkar:sc-modal').setTitle('أذكار طوال اليوم').addComponents(
          field('from', 'من الساعة (HH:MM — 24 ساعة)', hhmm(sc.from), 5),
          field('to', 'إلى الساعة (HH:MM — 24 ساعة)', hhmm(sc.to), 5),
          field('min', `أقل مدة بين ذكرين بالدقائق (${SCATTER_LIMIT_MIN_GAP} فأكثر)`, String(sc.minGap), 3),
          field('max', `أكثر مدة بين ذكرين بالدقائق (حتى ${SCATTER_LIMIT_MAX_GAP})`, String(sc.maxGap), 3)
        );
        await i.showModal(modal);
        const sub = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === 'adhkar:sc-modal' && m.user.id === i.user.id }).catch(() => null);
        if (!sub) return;
        const num = (id) => { const d = sub.fields.getTextInputValue(id).trim().replace(/[٠-٩]/g, x => '٠١٢٣٤٥٦٧٨٩'.indexOf(x)); return /^\d{1,3}$/.test(d) ? Number(d) : NaN; };
        const from = parseTime(sub.fields.getTextInputValue('from'));
        const to   = parseTime(sub.fields.getTextInputValue('to'));
        const minGap = num('min'), maxGap = num('max');
        const errs = [];
        if (!from) errs.push('وقت البداية غير صالح — مثال: `07:00`');
        if (!to)   errs.push('وقت النهاية غير صالح — مثال: `22:00`');
        if (from && to && toMinutes(to) - toMinutes(from) < SCATTER_MIN_WINDOW) errs.push('الفترة قصيرة؛ اجعلها ساعتين على الأقل، وبداية قبل النهاية في نفس اليوم.');
        if (!(minGap >= SCATTER_LIMIT_MIN_GAP && minGap <= SCATTER_LIMIT_MAX_GAP)) errs.push(`أقل مدة بين ${SCATTER_LIMIT_MIN_GAP} و${SCATTER_LIMIT_MAX_GAP} دقيقة.`);
        if (!(maxGap >= minGap && maxGap <= SCATTER_LIMIT_MAX_GAP)) errs.push('أكثر مدة يجب ألا تقل عن أقل مدة، ولا تزيد على ' + SCATTER_LIMIT_MAX_GAP + ' دقيقة.');
        if (errs.length) return sub.reply({ embeds: [buildErrorEmbed(errs.join('\n'), 'ar')], ephemeral: true });
        // day/sent reset: today's times are recomputed from the new settings.
        state = await saveSection(guildId, 'adhkar', { 'scatter.from': from, 'scatter.to': to, 'scatter.minGap': minGap, 'scatter.maxGap': maxGap, 'scatter.day': null, 'scatter.sent': [] });
        return sub.update(panelPayload(state, i.guild, view));
      }

      // ── Times / timezone modal ──────────────────────────────────────────
      if (id === 'adhkar:times') {
        const modal = new ModalBuilder().setCustomId('adhkar:times-modal').setTitle('الأوقات والمنطقة الزمنية').addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('morning').setLabel('وقت أذكار الصباح (HH:MM — 24 ساعة)')
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(a.morningTime || DEFAULT_MORNING)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('evening').setLabel('وقت أذكار المساء (HH:MM — 24 ساعة)')
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue(a.eveningTime || DEFAULT_EVENING)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tz').setLabel('بلدك أو المنطقة الزمنية (مثل: الجزائر)')
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64).setValue(a.timezone || DEFAULT_TIMEZONE))
        );
        await i.showModal(modal);
        const sub = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === 'adhkar:times-modal' && m.user.id === i.user.id }).catch(() => null);
        if (!sub) return;
        const morning = parseTime(sub.fields.getTextInputValue('morning'));
        const evening = parseTime(sub.fields.getTextInputValue('evening'));
        const tz      = resolveTimeZone(sub.fields.getTextInputValue('tz'));
        const errs = [];
        if (!morning) errs.push('وقت الصباح غير صالح — مثال: `06:30`');
        if (!evening) errs.push('وقت المساء غير صالح — مثال: `17:00`');
        if (!tz) errs.push(zoneError(sub.fields.getTextInputValue('tz')));
        if (errs.length) return sub.reply({ embeds: [buildErrorEmbed(errs.join('\n'), 'ar')], ephemeral: true });
        state = await saveSection(guildId, 'adhkar', { morningTime: morning, eveningTime: evening, timezone: tz });
        return sub.update(panelPayload(state, i.guild, view));
      }

      // ── Test post (the "🧪 جرّب" menu): re-render the panel first so the menu resets, then send and report privately ──
      if (id === 'adhkar:testpick') {
        const kind = i.values?.[0];
        if (!['morning', 'evening', 'scatter'].includes(kind)) return;
        if (!a.channelId) return err(i, 'اختر قناة النشر أولاً من القائمة.');
        const key = kind === 'scatter' ? `${guildId}:sc` : guildId;
        const wait = (testCooldown.get(key) ?? 0) + TEST_COOLDOWN_MS - Date.now();
        if (wait > 0) return err(i, `انتظر ${Math.ceil(wait / 1000)} ثانية قبل تجربة أخرى.`);
        testCooldown.set(key, Date.now());
        await refresh(i);
        const res = kind === 'scatter'
          ? await sendScatter(i.client, guildId, a.channelId, { exclude: a.scatter?.recent, minutes: nowMinutes(a.timezone) })
          : await sendAdhkar(i.client, guildId, a.channelId, kind, { style: a.style, roleId: a.roleId });
        const what = kind === 'scatter' ? 'ذكر من أذكار اليوم' : `أذكار ${KIND_AR[kind]}`;
        return i.followUp({ ephemeral: true, embeds: [res.ok
          ? buildSuccessEmbed('تم الإرسال', `أُرسل: ${what} في <#${a.channelId}>.`, 'ar')
          : buildErrorEmbed(res.reason === 'no_permission'
              ? `ليس لدي صلاحيات كافية في <#${a.channelId}> (عرض القناة، إرسال الرسائل، تضمين الروابط).`
              : 'تعذّر الإرسال — تأكد من القناة والصلاحيات.', 'ar')] });
      }

      // ── Everything else updates the panel in place ─────────────────────
      if (id === 'adhkar:toggle') {
        if (!a.enabled && !a.channelId) return err(i, 'اختر قناة النشر من القائمة أولاً ثم فعّل.');
        state = await saveSection(guildId, 'adhkar', { enabled: !a.enabled });
      } else if (id === 'adhkar:sc:toggle') {
        if (!a.scatter?.enabled && !a.channelId) return err(i, 'اختر قناة النشر من القائمة أولاً ثم فعّل.');
        state = await saveSection(guildId, 'adhkar', { 'scatter.enabled': !a.scatter?.enabled });
      } else if (id === 'adhkar:style') {
        state = await saveSection(guildId, 'adhkar', { style: STYLE_NEXT[a.style] ?? 'compact' });   // كامل ↔ مختصر
      } else if (id === 'adhkar:expire') {
        state = await saveSection(guildId, 'adhkar', { deleteAfterHours: nextExpiryChoice(expiryHoursOf(a)) });   // ساعتين ← ساعة ← 3 ← 6 ← 12 ← متوقف
      } else if (id === 'adhkar:delold') {
        state = await saveSection(guildId, 'adhkar', { deleteOld: !a.deleteOld });
      } else if (id === 'adhkar:channel') {
        const channel = i.channels.first();
        const problem = channelProblem(channel, i.guild);
        if (problem) return err(i, problem);
        state = await saveSection(guildId, 'adhkar', { channelId: channel.id });
      } else if (id === 'adhkar:role') {
        const r = checkRole(i, guildId);
        if (r.error) return err(i, r.error);
        state = await saveSection(guildId, 'adhkar', { roleId: r.roleId });
      } else {
        return;
      }

      await refresh(i);

  } catch (e) {
    if (e?.code === 10062 || e?.code === 40060) return;   // interaction expired / already acknowledged
    say(i, 'حدث خطأ غير متوقع. افتح اللوحة من جديد بـ `/setup`.');
  }
}
