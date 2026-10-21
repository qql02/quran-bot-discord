import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, PermissionFlagsBits
} from 'discord.js';
import { config } from '../config.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { t } from '../utils/i18n.js';
import { UserError } from '../utils/errors.js';
import { buildErrorEmbed, COLORS } from '../utils/embeds.js';
import { canManage, parseValue, LIMITS } from '../services/stationRules.js';
import { addStation, removeStation, listGuildStations, listGlobalStations } from '../services/stationService.js';

// ═════════════════════════════════════════════════════════════════════════════
//  Custom radio stations (a page of the /setup panel). Replaces /stations add · list · remove.
//  Stations added here appear in the player panel's radio list. Ids start with "stations:".
// ═════════════════════════════════════════════════════════════════════════════

export const STATIONS_MODAL = 'stations:add_modal';   // + ":guild" | ":global"
const isOwner = (i) => config.admin.ids.includes(i.user.id);
const trunc = (s, n) => { const x = String(s ?? ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const row = (...c) => new ActionRowBuilder().addComponents(...c);

export async function stationsPage(guild, lang, owner, note = null) {
  const ar = lang === 'ar';
  const [own, glob] = await Promise.all([listGuildStations(guild.id), listGlobalStations()]);
  const none = ar ? '_لا يوجد_' : '_none_';
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(ar ? '📻 محطات الراديو' : '📻 Radio stations')
    .setDescription([
      note,
      ar ? 'أضف رابط بث مباشر (http/https) ليظهر لأعضاء السيرفر في قائمة «إذاعة» داخل لوحة التشغيل.'
         : 'Add a direct stream link (http/https) so members see it in the “Radio” list of the player panel.',
      '',
      `**🏠 ${ar ? 'محطات هذا السيرفر' : 'This server\'s stations'} (${own.length}/${LIMITS.guild})**`,
      own.length ? trunc(own.map(s => `• ${s.name}`).join('\n'), 1500) : none,
      '',
      `**⭐ ${ar ? 'محطات عامة (من مالك البوت)' : 'Public stations (from the bot owner)'} (${glob.length})**`,
      glob.length ? trunc(glob.slice(0, 15).map(s => `• ${s.name}`).join('\n') + (glob.length > 15 ? '\n…' : ''), 1000) : none
    ].filter(x => x !== null).join('\n').slice(0, 4000));

  const buttons = [
    new ButtonBuilder().setCustomId('stations:add').setStyle(ButtonStyle.Success).setEmoji('➕').setLabel(ar ? 'إضافة محطة' : 'Add a station').setDisabled(own.length >= LIMITS.guild)
  ];
  if (owner) buttons.push(new ButtonBuilder().setCustomId('stations:add_global').setStyle(ButtonStyle.Primary).setEmoji('⭐').setLabel(ar ? 'محطة عامة (المالك)' : 'Public station (owner)'));
  buttons.push(new ButtonBuilder().setCustomId('hub:home').setStyle(ButtonStyle.Secondary).setEmoji('🏠').setLabel(ar ? 'الرئيسية' : 'Home'));
  const components = [row(...buttons)];

  const deletable = [
    ...own.map(s => ({ label: trunc(`🏠 ${s.name}`, 100), value: `s:${s._id}` })),
    ...(owner ? glob.map(s => ({ label: trunc(`⭐ ${s.name}`, 100), value: `g:${s._id}` })) : [])
  ].slice(0, 25);
  if (deletable.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId('stations:del').setPlaceholder(ar ? '🗑 احذف محطة…' : '🗑 Delete a station…').addOptions(deletable)));
  }
  return { embeds: [embed], components };
}

export function addStationModal(lang, scope) {
  const ar = lang === 'ar';
  return new ModalBuilder().setCustomId(`${STATIONS_MODAL}:${scope}`).setTitle(scope === 'global' ? (ar ? 'محطة عامة' : 'Public station') : (ar ? 'إضافة محطة' : 'Add a station')).addComponents(
    row(new TextInputBuilder().setCustomId('name').setLabel(ar ? 'اسم المحطة' : 'Station name').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(LIMITS.nameMin).setMaxLength(LIMITS.nameMax)),
    row(new TextInputBuilder().setCustomId('url').setLabel(ar ? 'رابط البث المباشر (http/https)' : 'Direct stream link (http/https)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(LIMITS.urlMax))
  );
}

/** A UserError (a mistake the admin can fix) becomes a note on the page; anything else is left to the central error handler. */
const noteFor = (err, lang) => (err instanceof UserError ? t(lang, `errors.${err.key}`, err.vars) : null);

export async function handleStationsComponent(i) {
  const lang = await GuildSettings.getLanguage(i.guildId);
  const ar = lang === 'ar';
  const hasManage = !!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  if (!hasManage) return i.reply({ embeds: [buildErrorEmbed(t(lang, 'errors.station_need_manage'), lang)], ephemeral: true });
  const owner = isOwner(i);
  const [, action, scopeArg] = i.customId.split(':');

  if (i.isModalSubmit()) {
    if (action !== 'add_modal') return;
    const scope = scopeArg === 'global' ? 'global' : 'guild';
    if (!canManage({ scope, isOwner: owner, hasManageGuild: hasManage })) {
      return i.reply({ embeds: [buildErrorEmbed(t(lang, scope === 'global' ? 'errors.station_need_owner' : 'errors.station_need_manage'), lang)], ephemeral: true });
    }
    await i.deferUpdate();                       // checking the stream can take several seconds
    let note;
    try {
      const st = await addStation({ scope, guildId: i.guildId, name: i.fields.getTextInputValue('name'), url: i.fields.getTextInputValue('url'), userId: i.user.id });
      note = ar ? `✅ أُضيفت المحطة **${st.name}**.` : `✅ Station **${st.name}** added.`;
    } catch (err) {
      note = noteFor(err, lang);
      if (!note) throw err;
    }
    return i.editReply(await stationsPage(i.guild, lang, owner, note));
  }

  if (action === 'list') return i.update(await stationsPage(i.guild, lang, owner));
  if (action === 'add')        return i.showModal(addStationModal(lang, 'guild'));
  if (action === 'add_global') {
    if (!owner) return i.reply({ embeds: [buildErrorEmbed(t(lang, 'errors.station_need_owner'), lang)], ephemeral: true });
    return i.showModal(addStationModal(lang, 'global'));
  }
  if (action === 'del') {
    const p = parseValue(i.values?.[0]);
    if (p.kind === 'api') return i.update(await stationsPage(i.guild, lang, owner, t(lang, 'errors.station_not_found')));
    if (!canManage({ scope: p.kind, isOwner: owner, hasManageGuild: hasManage })) {
      return i.reply({ embeds: [buildErrorEmbed(t(lang, p.kind === 'global' ? 'errors.station_need_owner' : 'errors.station_need_manage'), lang)], ephemeral: true });
    }
    let note;
    try {
      const doc = await removeStation({ scope: p.kind, guildId: i.guildId, id: p.id });
      note = ar ? `🗑 حُذفت المحطة **${doc.name}**.` : `🗑 Station **${doc.name}** removed.`;
    } catch (err) {
      note = noteFor(err, lang);
      if (!note) throw err;
    }
    return i.update(await stationsPage(i.guild, lang, owner, note));
  }
}
