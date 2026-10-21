import { config } from '../config.js';

/** The OAuth link that adds the bot to a server (with the permissions it needs). */
export function buildInviteUrl(clientId, permissions = config.bot.invitePermissions) {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}` +
         `&integration_type=0&scope=bot+applications.commands`;
}
