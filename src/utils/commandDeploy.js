import { REST, Routes } from 'discord.js';
import { sortCommands } from '../data/commandOrder.js';

/**
 * Slash commands live in exactly ONE place, chosen by DEPLOY_SCOPE:
 *   global (default) → every server; the copy registered in GUILD_ID is removed (it is what showed every command twice)
 *   guild            → only the mother server GUILD_ID (instant); the global list is emptied so nothing is duplicated
 * The other scope is always emptied, so running it twice changes nothing.
 */

// Discord hands commands back with extra fields (id, version, null localizations, contexts…), so a plain JSON compare
// never matched and every restart re-deployed. Only what the commands actually define is compared.
const normOpt = (o) => ({
  t: o.type, n: o.name, d: o.description, r: !!o.required, a: !!o.autocomplete,
  c: (o.choices ?? []).map(x => [x.name, x.value]),
  lo: o.min_value ?? null, hi: o.max_value ?? null, ml: o.min_length ?? null, xl: o.max_length ?? null,
  ch: o.channel_types ?? [], o: (o.options ?? []).map(normOpt)
});
const normCmd = (c) => ({ n: c.name, d: c.description, p: String(c.default_member_permissions ?? ''), o: (c.options ?? []).map(normOpt) });
export const commandSig = (cmds) => JSON.stringify(cmds.map(normCmd).sort((a, b) => a.n.localeCompare(b.n)));

const routes = (appId, guildId) => ({ global: Routes.applicationCommands(appId), guild: guildId ? Routes.applicationGuildCommands(appId, guildId) : null });

/** Read-only: what is registered where, and which names exist in BOTH places (= shown twice). */
export async function inspectCommands({ token, appId, guildId, rest = new REST({ version: '10' }).setToken(token) }) {
  const r = routes(appId, guildId);
  const global = (await rest.get(r.global)).map(c => c.name);
  const guild  = r.guild ? (await rest.get(r.guild)).map(c => c.name) : [];
  return { global, guild, duplicates: global.filter(n => guild.includes(n)) };
}

export async function syncCommands({ token, appId, scope, guildId, commands, onlyIfChanged = false, log = () => {}, rest = new REST({ version: '10' }).setToken(token) }) {
  if (scope === 'guild' && !guildId) throw new Error('DEPLOY_SCOPE=guild needs GUILD_ID (the mother server)');
  const body = sortCommands(commands);
  const r    = routes(appId, guildId);
  const keep = scope === 'guild' ? 'guild' : 'global';
  const drop = keep === 'guild' ? 'global' : 'guild';
  const where = keep === 'guild' ? `the mother server ${guildId} only (instant)` : 'ALL servers (global, may take up to 1h)';

  // 1) the one place that keeps the commands
  const current = onlyIfChanged ? await rest.get(r[keep]) : null;
  if (current && commandSig(current) === commandSig(body)) {
    log(`✓ Commands already up to date in ${keep === 'guild' ? `guild ${guildId}` : 'global'} (${body.length}) — nothing sent`);
  } else {
    const data = await rest.put(r[keep], { body });
    log(`✅ Deployed ${data.length} commands to ${where}`);
  }

  // 2) the other place is emptied, only if it still holds something
  if (r[drop]) {
    const left = await rest.get(r[drop]).catch(() => []);
    if (left.length) {
      await rest.put(r[drop], { body: [] });
      log(`🧹 Removed ${left.length} duplicate ${drop === 'guild' ? `server-only commands from guild ${guildId}` : 'global commands'}`);
    }
  }
}
