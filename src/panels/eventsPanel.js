import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits
} from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { ReligiousEvent } from '../models/ReligiousEvent.js';
import { buildErrorEmbed, COLORS } from '../utils/embeds.js';
import { parseTime, resolveTimeZone, suggestTimeZones, localClock, DEFAULT_TIMEZONE } from '../utils/adhkarSchedule.js';
import {
  parseDate, validateRange, eventState, shortId, dayOfEvent, MAX_EVENTS_PER_GUILD, MAX_TITLE, MAX_DESCRIPTION
} from '../utils/events.js';
import { resolveChannel } from '../services/adhkarService.js';
import { sendEvent } from '../services/eventService.js';
import { checkRole, channelProblem } from './adhkarPanel.js';

// ═════════════════════════════════════════════════════════════════════════════
//  Religious events (a page of the /setup panel). Replaces /events add · list · test · remove.
//  List → pick one → its card (test, pause, delete, change room or role). "Add" is a short form; the room it is posted in is
//  the room /setup was opened from, and the card right after lets the admin change it. Ids start with "events:".
// ═════════════════════════════════════════════════════════════════════════════

export const EVENTS_MODAL_ID = 'events:add_modal';
const STATE_AR = { upcoming: 'قادمة', running: 'جارية', finished: 'منتهية', paused: 'متوقفة' };
const STATE_ICON = { upcoming: '🕐', running: '🟢', finished: '✔️', paused: '⏸' };
const trunc = (s, n) => { const x = String(s ?? ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const homeBtn = () => new ButtonBuilder().setCustomId('hub:home').setStyle(ButtonStyle.Secondary).setEmoji('🏠').setLabel('الرئيسية');

const stateOf = (ev) => eventState(ev, localClock(ev.timezone).date);

export async function eventsPage(guild, note = null) {
  const evs = await ReligiousEvent.find({ guildId: guild.id }).sort({ startDate: 1 }).limit(MAX_EVENTS_PER_GUILD).lean();
  const lines = evs.map(ev => {
    const span = ev.startDate === ev.endDate ? `\`${ev.startDate}\`` : `\`${ev.startDate}\` ← \`${ev.endDate}\``;
    return `${STATE_ICON[stateOf(ev)]} **${trunc(ev.title, 60)}** · ${span} · \`${ev.time}\` · <#${ev.channelId}>`;
  });
  const embed = new EmbedBuilder().setColor(COLORS.gold).setTitle('📅 الفعاليات الدينية')
    .setDescription([
      note,
      'فعالية تُنشر في روم محدد بوقت ثابت، مرة واحدة أو يومياً بين تاريخين (مثل أنشطة رمضان).',
      '',
      lines.length ? lines.join('\n') : '_لا توجد فعاليات بعد. اضغط «إضافة فعالية»._'
    ].filter(x => x !== null).join('\n').slice(0, 4000))
    .setFooter({ text: `${evs.length} / ${MAX_EVENTS_PER_GUILD}` });
  const components = [row(
    new ButtonBuilder().setCustomId('events:add').setStyle(ButtonStyle.Success).setEmoji('➕').setLabel('إضافة فعالية').setDisabled(evs.length >= MAX_EVENTS_PER_GUILD),
    homeBtn()
  )];
  if (evs.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId('events:pick').setPlaceholder('اختر فعالية لتجربتها أو تعديلها أو حذفها…')
      .addOptions(evs.slice(0, 25).map(ev => ({
        label: trunc(ev.title, 100), value: String(ev._id), emoji: STATE_ICON[stateOf(ev)],
        description: trunc(`${STATE_AR[stateOf(ev)]} · ${ev.startDate} · ${ev.time}`, 100)
      })))));
  }
  return { embeds: [embed], components };
}

function eventCard(guild, ev, note = null) {
  const st = stateOf(ev);
  const days = dayOfEvent(ev, ev.startDate).total;
  const when = days > 1 ? `يومياً الساعة \`${ev.time}\` من \`${ev.startDate}\` إلى \`${ev.endDate}\` (${days} يوماً)` : `مرة واحدة يوم \`${ev.startDate}\` الساعة \`${ev.time}\``;
  const embed = new EmbedBuilder().setColor(COLORS.gold).setTitle(`${STATE_ICON[st]} ${trunc(ev.title, 200)}`)
    .setDescription([
      note,
      ev.description ? trunc(ev.description, 800) : null,
      '',
      `**الحالة:** ${STATE_AR[st]}`,
      `**الموعد:** ${when}`,
      `**الروم:** <#${ev.channelId}>${ev.roleId ? ` · **المنشن:** <@&${ev.roleId}>` : ''}`,
      `**المنطقة الزمنية:** \`${ev.timezone}\``
    ].filter(x => x !== null).join('\n'))
    .setFooter({ text: `رقم الفعالية ${shortId(ev._id)}` });

  const id = String(ev._id);
  const chMenu = new ChannelSelectMenuBuilder().setCustomId(`events:ch:${id}`).setPlaceholder('📍 غيّر روم النشر')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (guild.channels.cache.has(ev.channelId)) chMenu.setDefaultChannels(ev.channelId);
  const roleMenu = new RoleSelectMenuBuilder().setCustomId(`events:role:${id}`).setPlaceholder('🔔 رتبة المنشن (اختيارية) — امسحها للإلغاء')
    .setMinValues(0).setMaxValues(1);
  if (ev.roleId && guild.roles.cache.has(ev.roleId)) roleMenu.setDefaultRoles(ev.roleId);
  return {
    embeds: [embed],
    components: [
      row(
        new ButtonBuilder().setCustomId(`events:test:${id}`).setStyle(ButtonStyle.Primary).setEmoji('🧪').setLabel('جرّب الآن'),
        new ButtonBuilder().setCustomId(`events:tog:${id}`).setStyle(ev.enabled ? ButtonStyle.Secondary : ButtonStyle.Success).setEmoji(ev.enabled ? '⏸' : '▶️').setLabel(ev.enabled ? 'إيقاف مؤقت' : 'استئناف'),
        new ButtonBuilder().setCustomId(`events:del:${id}`).setStyle(ButtonStyle.Danger).setEmoji('🗑').setLabel('حذف'),
        new ButtonBuilder().setCustomId('events:list').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setLabel('الفعاليات')
      ),
      row(chMenu),
      row(roleMenu)
    ]
  };
}

export function addEventModal() {
  const field = (id, label, style, required, max, placeholder) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (placeholder) t.setPlaceholder(placeholder);
    return row(t);
  };
  return new ModalBuilder().setCustomId(EVENTS_MODAL_ID).setTitle('إضافة فعالية').addComponents(
    field('title', 'عنوان الفعالية', TextInputStyle.Short, true, MAX_TITLE),
    field('time', 'وقت النشر (HH:MM — 24 ساعة)', TextInputStyle.Short, true, 5, '21:00'),
    field('start', 'تاريخ البداية YYYY-MM-DD (فارغ = اليوم)', TextInputStyle.Short, false, 10, '2027-02-08'),
    field('end', 'آخر يوم YYYY-MM-DD (فارغ = مرة واحدة)', TextInputStyle.Short, false, 10, '2027-03-09'),
    field('description', 'نص الفعالية (اختياري)', TextInputStyle.Paragraph, false, MAX_DESCRIPTION)
  );
}

const fail = (i, text) => i.reply({ embeds: [buildErrorEmbed(text, 'ar')], ephemeral: true });

async function guildTimezone(guildId) {
  const doc = await GuildSettings.findOne({ guildId }, { 'adhkar.timezone': 1 }).lean();
  return doc?.adhkar?.timezone || DEFAULT_TIMEZONE;
}

/** The event of THIS server with that id (never another server's), or null. */
const loadEvent = (guildId, id) => (/^[0-9a-f]{24}$/i.test(String(id)) ? ReligiousEvent.findOne({ _id: id, guildId }).lean() : null);

async function createFromModal(i) {
  const { guildId, fields } = i;
  await i.deferUpdate();                                          // checking the room is a network call
  const fail = (_i, text) => i.followUp({ embeds: [buildErrorEmbed(text, 'ar')], ephemeral: true });
  const timezone = await guildTimezone(guildId);
  const tz = resolveTimeZone(timezone);
  if (!tz) {
    const maybe = suggestTimeZones(timezone, 'ar');
    return fail(i, `المنطقة الزمنية المحفوظة غير صالحة. اضبطها من صفحة «الأذكار» أولاً.${maybe.length ? `\nهل تقصد: ${maybe.join(' · ')}؟` : ''}`);
  }
  const today = localClock(tz).date;
  const time  = parseTime(fields.getTextInputValue('time'));
  const startRaw = fields.getTextInputValue('start').trim();
  const endRaw   = fields.getTextInputValue('end').trim();
  const start = parseDate(startRaw || 'اليوم', today);
  const end   = endRaw ? parseDate(endRaw, today) : start;
  if (!time)  return fail(i, 'وقت النشر غير صالح — مثال: `21:00`');
  if (!start) return fail(i, 'تاريخ البداية غير صالح — اكتب `YYYY-MM-DD` مثل `2027-02-08` أو اتركه فارغاً لليوم.');
  if (!end)   return fail(i, 'تاريخ النهاية غير صالح — اكتب `YYYY-MM-DD` مثل `2027-03-09`.');
  const rangeError = validateRange(start, end, today);
  if (rangeError) return fail(i, rangeError);

  const channel = i.channel;
  const room = channel ? await resolveChannel(i.client, guildId, channel.id).catch(() => ({ error: 'send_failed' })) : { error: 'no_channel' };
  if (room.error) return fail(i, 'ليس لدي صلاحية النشر في هذا الروم (عرض القناة، إرسال الرسائل، تضمين الروابط). افتح `/setup` من روم أستطيع الكتابة فيه، أو أعطني الصلاحية.');
  if (await ReligiousEvent.countDocuments({ guildId }) >= MAX_EVENTS_PER_GUILD) {
    return fail(i, `وصلت للحد الأقصى (${MAX_EVENTS_PER_GUILD} فعالية). احذف فعالية منتهية أولاً.`);
  }
  const ev = await ReligiousEvent.create({
    guildId, title: fields.getTextInputValue('title').trim(), description: fields.getTextInputValue('description').trim(),
    channelId: channel.id, roleId: null, time, timezone: tz, startDate: start, endDate: end, createdBy: i.user.id
  });
  return i.editReply(eventCard(i.guild, ev.toObject?.() ?? ev, `✅ تمت الجدولة في <#${channel.id}>. يمكنك تغيير الروم أو إضافة منشن من القوائم أدناه.`));
}

export async function handleEventsComponent(i) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return fail(i, 'تحتاج صلاحية **إدارة السيرفر** لاستخدام هذه اللوحة.');
  }
  const [, action, id] = i.customId.split(':');
  const guild = i.guild;

  if (i.isModalSubmit()) return action === 'add_modal' ? createFromModal(i) : undefined;
  if (action === 'list') return i.update(await eventsPage(guild));
  if (action === 'add')  return i.showModal(addEventModal());

  const evId = action === 'pick' ? i.values?.[0] : id;
  const ev = await loadEvent(guild.id, evId);
  if (!ev) return i.update(await eventsPage(guild, '⚠️ لم أجد هذه الفعالية (ربما حُذفت).'));

  switch (action) {
    case 'pick':
      return i.update(eventCard(guild, ev));
    case 'test': {
      await i.deferUpdate();
      const res = await sendEvent(i.client, ev);
      const note = res.ok ? `✅ نُشرت نسخة تجريبية في <#${ev.channelId}>.` : `⚠️ تعذّر النشر في <#${ev.channelId}> (${res.reason}). تأكد من صلاحيات البوت في الروم.`;
      return i.editReply(eventCard(guild, ev, note));
    }
    case 'tog': {
      const next = await ReligiousEvent.findOneAndUpdate({ _id: ev._id, guildId: guild.id }, { $set: { enabled: !ev.enabled } }, { new: true }).lean();
      return i.update(eventCard(guild, next ?? ev, next?.enabled ? '▶️ استُؤنفت الفعالية.' : '⏸ أُوقفت الفعالية مؤقتاً.'));
    }
    case 'del':
      return i.update({
        embeds: [buildErrorEmbed(`حذف الفعالية **${trunc(ev.title, 100)}** نهائياً؟`, 'ar')],
        components: [row(
          new ButtonBuilder().setCustomId(`events:delyes:${ev._id}`).setStyle(ButtonStyle.Danger).setLabel('نعم، احذف'),
          new ButtonBuilder().setCustomId(`events:pickback:${ev._id}`).setStyle(ButtonStyle.Secondary).setLabel('تراجع')
        )]
      });
    case 'pickback':
      return i.update(eventCard(guild, ev));
    case 'delyes': {
      await ReligiousEvent.deleteOne({ _id: ev._id, guildId: guild.id });
      return i.update(await eventsPage(guild, `🗑 حُذفت الفعالية **${trunc(ev.title, 60)}**.`));
    }
    case 'ch': {
      const channel = i.channels?.first();
      const problem = channelProblem(channel, guild);
      if (problem) return fail(i, problem);
      const next = await ReligiousEvent.findOneAndUpdate({ _id: ev._id, guildId: guild.id }, { $set: { channelId: channel.id } }, { new: true }).lean();
      return i.update(eventCard(guild, next ?? ev, `📍 ستُنشر في <#${channel.id}>.`));
    }
    case 'role': {
      const r = checkRole(i, guild.id);
      if (r.error) return fail(i, r.error);
      if (r.roleId && guild.roles.cache.get(r.roleId)?.managed) return fail(i, 'اختر رتبة عادية للمنشن (ليس رتبة بوت).');
      const next = await ReligiousEvent.findOneAndUpdate({ _id: ev._id, guildId: guild.id }, { $set: { roleId: r.roleId } }, { new: true }).lean();
      return i.update(eventCard(guild, next ?? ev, r.roleId ? `🔔 سيُمنشن <@&${r.roleId}>.` : '🔕 أُلغي المنشن.'));
    }
  }
}
