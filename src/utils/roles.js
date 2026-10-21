import { PermissionFlagsBits } from 'discord.js';

/**
 * The role id a scheduled post may ping, or null. Checked at SEND time (not only when the role was chosen):
 * the role must still exist, must not be @everyone, and must still be mentionable (or the bot may mention any role).
 * A manager who later turns "allow anyone to @mention this role" off therefore really stops the pings.
 */
export function pingableRoleId(guild, roleId) {
  if (!guild || !roleId) return null;
  const role = guild.roles.cache.get(roleId);
  if (!role || role.id === guild.id) return null;
  const botCanMentionAny = guild.members.me?.permissions?.has(PermissionFlagsBits.MentionEveryone) ?? false;
  return role.mentionable || botCanMentionAny ? role.id : null;
}
