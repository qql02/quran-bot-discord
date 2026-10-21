import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setThumbnail } from './embeds.js';
import { logger } from './logger.js';

const LOGO_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'logo.png');

/**
 * The embed picture without any domain: assets/logo.png is uploaded ONCE as an application emoji of the bot, and its Discord
 * address (cdn.discordapp.com/emojis/<id>.png, permanent) becomes the picture of every embed. Nothing depends on where the bot is
 * hosted, and a new logo is picked up by itself (the emoji name carries a short hash of the file).
 * BOT_THUMBNAIL_URL in .env always wins. Any failure keeps the configured address; it never stops the bot.
 */
export async function useLogoAsThumbnail(client) {
  if (process.env.BOT_THUMBNAIL_URL?.trim()) {
    logger.info('Embed image: BOT_THUMBNAIL_URL from .env is in use, so assets/logo.png is NOT used. Delete that line from .env to use the bot logo.');
    return false;
  }
  try {
    const file = await readFile(LOGO_FILE);
    const name = `logo_${createHash('sha1').update(file).digest('hex').slice(0, 10)}`;
    const emojis = await client.application.emojis.fetch();
    let emoji = emojis.find(e => e.name === name);
    if (!emoji) {
      emoji = await client.application.emojis.create({ attachment: file, name });
      logger.info(`Embed image: uploaded assets/logo.png as the application emoji "${name}"`);
    }
    setThumbnail(`https://cdn.discordapp.com/emojis/${emoji.id}.png?size=256`);
    logger.info('Embed image: the bot logo (no domain needed; set BOT_THUMBNAIL_URL to use another picture)');
    return true;
  } catch (err) {
    logger.warn(`Embed image: could not use assets/logo.png as an application emoji (${err.message}) - keeping the configured address`);
    return false;
  }
}
