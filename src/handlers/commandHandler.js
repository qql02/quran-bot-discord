import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Collection } from 'discord.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Discord's text limits are enforced while the command is built, and the library only says "Invalid string length": find the literal that is too long. */
function overlongTexts(file) {
  const found = [];
  try {
    const src = readFileSync(join(__dirname, '..', 'commands', file), 'utf8');
    for (const m of src.matchAll(/\.set(Name|Description)\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g)) {
      const limit = m[1] === 'Name' ? 32 : 100;
      if (m[3].length > limit) found.push(`${m[1]} is ${m[3].length} characters (max ${limit}): "${m[3].slice(0, 50)}…"`);
    }
  } catch { /* best-effort hint only */ }
  return found;
}

export async function loadCommands(client) {
  client.commands   = new Collection();

  // The voice-only second bot (BOT_ROLE=secondary) has NO commands: nothing is loaded, nothing is ever registered with Discord.
  // Members talk to the main bot; it hands the request over through the shared database (services/playerJobs.js).
  if (config.bot.role === 'secondary') {
    logger.info('BOT_ROLE=secondary — voice-only bot: no slash commands are loaded or registered');
    return;
  }

  const commandsPath = join(__dirname, '..', 'commands');
  const files        = readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    try {
      const { default: command } = await import(`../commands/${file}`);
      if (!command?.data || !command?.execute) {
        logger.warn(`Skipping ${file} — missing data or execute`);
        continue;
      }
      client.commands.set(command.data.name, command);
      logger.info(`Loaded command: /${command.data.name}`);
    } catch (err) {
      const where = String(err.stack ?? '').split('\n').slice(1, 4).map(l => l.trim()).join('\n    ');
      const hints = overlongTexts(file).map(h => `\n    ↳ ${h}`).join('');
      logger.error(`Failed to load command ${file}: ${err.message}\n    ${where}${hints}`);
    }
  }

  logger.success(`${client.commands.size} commands loaded`);
}
