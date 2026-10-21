import { ChannelType, PermissionFlagsBits } from 'discord.js';

const canPost = (guild, channel) =>
  !!channel?.permissionsFor?.(guild.members.me)?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks
  ]);

/** A text channel people actually read: system channel first, else the top-most channel the bot can post in. */
export function pickAnnouncementChannel(guild) {
  if (guild.systemChannel && canPost(guild, guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache
    .filter(c => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && canPost(guild, c))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .first() ?? null;
}
