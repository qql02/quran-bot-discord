import { GuildSettings } from '../models/GuildSettings.js';
import { getGuildReciterKey, getGuildCustomReciter, setGuildReciterKey, setGuildCustomReciter } from '../data/popular.js';
import { logger } from '../utils/logger.js';

/**
 * The server's panel reciter lives in memory (data/popular.js) for speed and is mirrored to the database, so a restart
 * does not send everyone back to the default reciter. Loaded once per server per run, the first time anything needs it.
 */
const loaded = new Set();

export async function loadReciterChoice(guildId) {
  if (!guildId || loaded.has(guildId)) return;
  loaded.add(guildId);                       // first: a choice made while this loads must win over the saved one
  try {
    const p = (await GuildSettings.findOne?.({ guildId }, { panel: 1 })?.lean?.())?.panel;
    if (!p || getGuildReciterKey(guildId) || getGuildCustomReciter(guildId)) return;
    if (p.reciterName) setGuildCustomReciter(guildId, p.reciterName);
    else if (p.reciterKey) setGuildReciterKey(guildId, p.reciterKey);
  } catch (err) {
    loaded.delete(guildId);                  // try again next time
    logger.debug?.(`[${guildId}] Reciter choice not loaded: ${err.message}`);
  }
}

/** Save the current choice (fire and forget: playback never waits for the database). */
export function saveReciterChoice(guildId) {
  loaded.add(guildId);
  const $set = { 'panel.reciterKey': getGuildReciterKey(guildId), 'panel.reciterName': getGuildCustomReciter(guildId) };
  Promise.resolve(GuildSettings.findOneAndUpdate?.({ guildId }, { $set }, { upsert: true })).catch(err => logger.debug?.(`[${guildId}] Reciter choice not saved: ${err.message}`));
}
