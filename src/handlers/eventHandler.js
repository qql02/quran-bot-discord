import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The voice-only second bot has no private-chat commands: it does not even listen for messages.
const SECONDARY_SKIPS = new Set(['messageCreate']);
/** True when this event file (named after its event) must not be loaded for the given BOT_ROLE. */
export const skipsEvent = (file, role = config.bot.role) => role === 'secondary' && SECONDARY_SKIPS.has(file.replace(/\.js$/, ''));

export async function loadEvents(client) {
  const eventsPath = join(__dirname, '..', 'events');
  const files      = readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    if (skipsEvent(file)) { logger.info(`Skipped event ${file} (voice-only bot)`); continue; }
    try {
      const { default: event } = await import(`../events/${file}`);
      if (!event?.name || !event?.execute) {
        logger.warn(`Skipping event ${file} — missing name or execute`);
        continue;
      }
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
      logger.info(`Registered event: ${event.name}`);
    } catch (err) {
      logger.error(`Failed to load event ${file}:`, err.message);
    }
  }

  logger.success(`${files.length} event files processed`);
}
