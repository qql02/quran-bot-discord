/**
 * One-time repair: makes the rooms of servers that ran /setup BEFORE the rooms were locked read-only for members
 * (nobody but the bot writes there). Run by hand only, the bot never does this on its own.
 *
 *   npm run fix-locks             → every server not repaired yet (each server is repaired once, then marked done)
 *   npm run fix-locks -- --force  → every server again, even those already marked done
 *   npm run fix-locks -- --strict → also removes the explicit "allow" that a ROLE or MEMBER has in these rooms (otherwise they are only listed)
 *
 * Nothing is deleted or renamed; only the @everyone and the bot's own permission overwrites of the saved rooms change.
 * Stop the bot first or leave it running, both are fine (this logs in with the Guilds intent only).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Client, GatewayIntentBits } from 'discord.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { migrateSetupLocks } from '../services/setupService.js';

const force = process.argv.includes('--force');
const strict = process.argv.includes('--strict');
await mongoose.connect(process.env.MONGODB_URI);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(process.env.DISCORD_TOKEN);
await new Promise(res => (client.isReady() ? res() : client.once('clientReady', res)));

console.log(`Repairing servers${force ? ' (force: all of them)' : ''}…`);
const r = await migrateSetupLocks(client, GuildSettings, m => console.log('  ' + m), { force, strict });
for (const l of r.leaks) console.log(`  ${strict ? 'REMOVED' : 'LEAK'} server ${l.guildId} room ${l.channelId}: ${l.mention} may ${l.names.join(', ')}`);
console.log(`✅ Done — ${r.servers} server(s) checked, ${r.rooms} room(s) locked, ${r.failed} failed, ${r.leaks.length} role/member exception(s) ${strict ? 'removed' : 'found (use --strict to remove them)'}.`);
await client.destroy();
await mongoose.disconnect();
process.exit(0);
