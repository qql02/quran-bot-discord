/**
 * Deletes the BOT'S OWN messages from members' DMs (wird reminders, notices…).
 * Discord does not let a bot delete a member's messages in a DM — only the bot's own — so that is all this can do.
 *
 *   npm run clear-dms              → every member who has a wird subscription
 *   npm run clear-dms -- <userId>  → one member only
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { REST, Routes } from 'discord.js';
import { WirdSubscription } from '../models/WirdSubscription.js';

const only = process.argv[2];
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const botId = process.env.CLIENT_ID;

async function clearDm(userId) {
  const ch = await rest.post(Routes.userChannels(), { body: { recipient_id: userId } });
  let deleted = 0, before;
  for (;;) {
    const query = new URLSearchParams({ limit: '100', ...(before ? { before } : {}) });
    const msgs = await rest.get(Routes.channelMessages(ch.id), { query });
    if (!msgs.length) break;
    for (const m of msgs) {
      if (m.author.id !== botId) continue;
      await rest.delete(Routes.channelMessage(ch.id, m.id)).then(() => deleted++).catch(() => {});
    }
    before = msgs[msgs.length - 1].id;
  }
  return deleted;
}

await mongoose.connect(process.env.MONGODB_URI);
const ids = only ? [only] : (await WirdSubscription.find({}, { userId: 1 }).lean()).map(s => s.userId);
console.log(`Cleaning DMs of ${ids.length} member(s)…`);
let total = 0, failed = 0;
for (const id of ids) {
  try { const n = await clearDm(id); total += n; if (n) console.log(`  ${id}: ${n} deleted`); }
  catch (e) { failed++; console.log(`  ${id}: skipped (${e.message})`); }
}
console.log(`✅ Done — ${total} message(s) deleted, ${failed} member(s) skipped.`);
await mongoose.disconnect();
process.exit(0);
