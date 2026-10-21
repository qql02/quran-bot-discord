export const PermissionFlagsBits = { Connect: 1n, Speak: 2n, ManageGuild: 4n, ViewChannel: 8n, MoveMembers: 16n, Administrator: 32n, ManageChannels: 64n, SendMessages: 128n, EmbedLinks: 256n, ReadMessageHistory: 512n, CreatePublicThreads: 1024n, CreatePrivateThreads: 2048n, SendMessagesInThreads: 4096n, Stream: 8192n, UseSoundboard: 16384n, SendVoiceMessages: 32768n, AddReactions: 65536n, UseExternalSounds: 131072n, SendPolls: 262144n, UseApplicationCommands: 524288n, UseExternalApps: 1048576n, UseEmbeddedActivities: 2097152n, ManageWebhooks: 4194304n };
export const ChannelType = { GuildText: 0, GuildVoice: 2, GuildCategory: 4, GuildStageVoice: 13 };

export class EmbedBuilder {
  constructor() { this.data = {}; }
}
for (const m of ['setColor', 'setTitle', 'setDescription', 'setTimestamp', 'setFooter', 'setThumbnail', 'addFields']) {
  EmbedBuilder.prototype[m] = function (v) { this.data[m] = v; return this; };
}

// Chainable builders for the few tests that build buttons / commands (toJSON returns what was set).
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 };
class Chain { constructor() { this.data = {}; } toJSON() { return this.data; } }
export class ButtonBuilder extends Chain {}
for (const [m, k] of [['setCustomId', 'custom_id'], ['setLabel', 'label'], ['setStyle', 'style'], ['setURL', 'url'], ['setEmoji', 'emoji'], ['setDisabled', 'disabled']]) {
  ButtonBuilder.prototype[m] = function (v) { this.data[k] = v; return this; };
}
export class ActionRowBuilder extends Chain {
  addComponents(...c) { (this.data.components ??= []).push(...c.flat()); return this; }
  toJSON() { return { ...this.data, components: (this.data.components ?? []).map(c => c.toJSON?.() ?? c) }; }
}
export class SlashCommandBuilder extends Chain {}
for (const m of ['setName', 'setDescription', 'setDMPermission', 'setDefaultMemberPermissions', 'addStringOption', 'addIntegerOption', 'addChannelOption']) {
  SlashCommandBuilder.prototype[m] = function () { return this; };
}

// Modal / select builders (wirdUi imports them); chainable no-ops, enough for tests that only inspect embeds and buttons.
export const TextInputStyle = { Short: 1, Paragraph: 2 };
export class ModalBuilder extends Chain {}
export class TextInputBuilder extends Chain {}
export class StringSelectMenuBuilder extends Chain {}
for (const C of [ModalBuilder, TextInputBuilder, StringSelectMenuBuilder]) {
  for (const m of ['setCustomId', 'setTitle', 'setLabel', 'setStyle', 'setRequired', 'setMaxLength', 'setMinLength', 'setValue', 'setPlaceholder', 'setMinValues', 'setMaxValues']) {
    C.prototype[m] = function () { return this; };
  }
  C.prototype.addComponents = function () { return this; };
  C.prototype.addOptions = function () { return this; };
}
// The select menu keeps its options, custom id and placeholder so tests can inspect what the panel really offers.
StringSelectMenuBuilder.prototype.setCustomId = function (id) { this.data.custom_id = id; return this; };
StringSelectMenuBuilder.prototype.setPlaceholder = function (t) { this.data.placeholder = t; return this; };
StringSelectMenuBuilder.prototype.addOptions = function (...o) { (this.data.options ??= []).push(...o.flat()); return this; };
export const MessageFlags = { Ephemeral: 64, IsComponentsV2: 32768 };

// Components V2 (the panel card): chainable builders that remember their text, so tests can read what the card says.
export class TextDisplayBuilder { constructor() { this.data = {}; } setContent(c) { this.data.content = c; return this; } toJSON() { return this.data; } }
export class SeparatorBuilder { constructor() { this.data = {}; } setDivider() { return this; } setSpacing() { return this; } toJSON() { return this.data; } }
export const SeparatorSpacingSize = { Small: 1, Large: 2 };
export class ContainerBuilder {
  constructor() { this.data = { components: [] }; }
  setAccentColor(c) { this.data.accent_color = c; return this; }
  addTextDisplayComponents(...c) { this.data.components.push(...c.flat()); return this; }
  addSeparatorComponents(...c) { this.data.components.push(...c.flat()); return this; }
  addActionRowComponents(...c) { this.data.components.push(...c.flat()); return this; }
  toJSON() { return { ...this.data, components: this.data.components.map(c => c.toJSON?.() ?? c) }; }
}

// Channel / role pickers used by the /setup pages (chainable, remember nothing).
export class ChannelSelectMenuBuilder extends Chain {}
export class RoleSelectMenuBuilder extends Chain {}
for (const C of [ChannelSelectMenuBuilder, RoleSelectMenuBuilder]) {
  for (const m of ['setCustomId', 'setPlaceholder', 'setMinValues', 'setMaxValues', 'setChannelTypes', 'setDefaultChannels', 'setDefaultRoles']) {
    C.prototype[m] = function () { return this; };
  }
}
export class AttachmentBuilder { constructor(file, o = {}) { this.attachment = file; this.name = o.name; } }
export class Collection extends Map {}
