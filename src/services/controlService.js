/**
 * Global controls (owner dashboard) — cached so checking them costs nothing per interaction / queue add / scheduler tick.
 * getControlSync() never waits and never throws: before the first load, or if the database is down, the last known value
 * (initially "nothing restricted, moderators keep their old rights") applies — a database hiccup never blocks anyone.
 */
import { BotControl } from '../models/BotControl.js';
import { normalizeControl } from '../utils/botControl.js';
import { logger } from '../utils/logger.js';

const KEY = 'global';
const REFRESH_MS = 30_000;       // also picks up a change made by a second bot process sharing the database
let current = normalizeControl(null);
let timer = null;

export const getControlSync = () => current;

export async function refreshControl() {
  try {
    const doc = await BotControl.findOne({ key: KEY }).lean();
    current = normalizeControl(doc ? { ...doc, modCaps: doc.modCaps instanceof Map ? Object.fromEntries(doc.modCaps) : doc.modCaps } : null);
  } catch (err) { logger.warn(`[control] refresh failed: ${err.message}`); }
  return current;
}

export async function saveControl(patch, by = '') {
  const $set = { updatedBy: String(by).slice(0, 100), updatedAt: new Date() };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'modCaps') for (const [c, on] of Object.entries(v)) $set[`modCaps.${c}`] = on;
    else $set[k] = v;
  }
  await BotControl.findOneAndUpdate({ key: KEY }, { $set }, { upsert: true });
  return refreshControl();
}

export function startControl() {
  if (timer) return;
  refreshControl();
  timer = setInterval(refreshControl, REFRESH_MS);
  timer.unref?.();
}
