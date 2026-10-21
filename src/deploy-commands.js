import 'dotenv/config';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { syncCommands, inspectCommands } from './utils/commandDeploy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The voice-only second bot has no slash commands: registering anything on its application would show dead commands to members.
if (config.bot.role === 'secondary') {
  console.error('❌ BOT_ROLE=secondary is a voice-only bot — it registers no slash commands. Run the deploy from the MAIN bot only.');
  process.exit(1);
}

const TOKEN     = config.discord.token;
const CLIENT_ID = config.discord.clientId;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN and CLIENT_ID must be set in .env');
  process.exit(1);
}

async function deploy() {
  console.log('📡 Loading commands...');

  const commandsPath = join(__dirname, 'commands');
  const files        = readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  const commands     = [];

  for (const file of files) {
    try {
      const { default: command } = await import(`./commands/${file}`);
      if (command?.data) {
        commands.push(command.data.toJSON());
        console.log(`  ✓ ${command.data.name}`);
      }
    } catch (err) {
      console.error(`  ✗ ${file}:`, err.message);
    }
  }

  const GUILD_ID = config.discord.guildId;
  const args     = process.argv.slice(2);
  // npm run deploy         → DEPLOY_SCOPE from .env (default: global)
  // npm run deploy:mother  → force the mother server only (GUILD_ID); global list emptied
  // npm run deploy:global  → force every server; the GUILD_ID copy is removed
  const scope = args.includes('--mother') ? 'guild' : args.includes('--global') ? 'global' : config.discord.deployScope;

  // npm run deploy:check → read-only report: how many commands are registered where, and any shown twice
  if (args.includes('--check')) {
    const r = await inspectCommands({ token: TOKEN, appId: CLIENT_ID, guildId: GUILD_ID });
    console.log(`Global: ${r.global.length} commands · Mother server (${GUILD_ID ?? 'GUILD_ID not set'}): ${r.guild.length} commands`);
    console.log(r.duplicates.length ? `❌ Shown TWICE: ${r.duplicates.map(n => '/' + n).join(' ')}\n   Fix: npm run deploy (it removes the extra copy)` : '✅ No duplicates.');
    return;
  }

  try {
    await syncCommands({ token: TOKEN, appId: CLIENT_ID, scope, guildId: GUILD_ID, commands, log: m => console.log(m) });
  } catch (err) {
    console.error('❌ Deployment failed:', err.message);
    if (err.rawError) console.error(JSON.stringify(err.rawError, null, 2));
    process.exit(1);
  }
}

deploy();
