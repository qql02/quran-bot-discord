import { planAlertNotifications } from '../utils/ownerInsights.js';
import { logger } from '../utils/logger.js';

/**
 * Owner DM alerts: every minute the dashboard's alert list is evaluated; when a CRITICAL alert is confirmed (seen on
 * two consecutive checks) every id in ADMIN_IDS gets one direct message, a reminder after 6 h if it is still critical,
 * and a "recovered" message when it clears. See planAlertNotifications() for the rules.
 *
 * Never throws: a closed DM or a failing check must not affect the bot. State is in memory — after a restart, an alert
 * that is still critical is announced again (that is also what tells you the bot just restarted while something is wrong).
 * discord.js is not imported here, so the whole module is unit-tested with a fake client.
 */

const COLOR = { fire: 0xed4245, resolved: 0x3ec88a };
const MAX_LISTED = 10;

/** Pure: the DM payload (plain embed object). */
export function buildAlertMessage({ fire = [], resolved = [], dashboardUrl = '' }) {
  const lines = [];
  for (const a of fire.slice(0, MAX_LISTED)) lines.push(`🔴 **${a.title}**\n${a.detail}`);
  if (fire.length > MAX_LISTED) lines.push(`… و${fire.length - MAX_LISTED} تنبيهات أخرى`);
  for (const r of resolved.slice(0, MAX_LISTED)) lines.push(`✅ عاد للعمل: **${r.title}**`);
  if (dashboardUrl) lines.push(`\n[فتح الداشبورد](${dashboardUrl})`);
  return {
    embeds: [{
      title: fire.length ? '🚨 تنبيه حرج في البوت' : '✅ تعافى البوت',
      description: lines.join('\n\n').slice(0, 4000),
      color: fire.length ? COLOR.fire : COLOR.resolved,
      timestamp: new Date().toISOString()
    }]
  };
}

/**
 * @param {object}   o
 * @param {object}   o.client        discord.js client (only client.users.fetch(id).send is used)
 * @param {() => Promise<object[]>} o.getAlerts   returns the current alert list (evaluateAlerts output)
 * @param {string[]} o.ownerIds
 * @param {string}   [o.dashboardUrl]
 * @param {number}   [o.graceMs=90000]   no DMs this soon after start (a fresh process always looks busy for a moment)
 * @param {() => number} [o.now]
 * @returns {{ tick: () => Promise<{fire:number, resolved:number, sentTo:number}>, state: Map }}
 */
export function createAlertNotifier({ client, getAlerts, ownerIds, dashboardUrl = '', graceMs = 90_000, now = Date.now }) {
  const state = new Map();
  const startedAt = now();
  let running = false;

  async function tick() {
    const none = { fire: 0, resolved: 0, sentTo: 0 };
    if (running || !ownerIds.length) return none;
    running = true;
    try {
      const alerts = await getAlerts();
      if (now() - startedAt < graceMs) return none;           // no DM during the grace period (and nothing is counted yet)
      const { fire, resolved } = planAlertNotifications(alerts, state, now());
      if (!fire.length && !resolved.length) return none;
      const payload = buildAlertMessage({ fire, resolved, dashboardUrl });
      let sentTo = 0;
      for (const id of ownerIds) {
        try { const user = await client.users.fetch(id); await user.send(payload); sentTo++; }
        catch (err) { logger.warn(`[alerts] could not DM ${id}: ${err?.message}`); }
      }
      if (fire.length) logger.info(`[alerts] notified ${sentTo}/${ownerIds.length} owner(s): ${fire.map(a => a.id).join(', ')}`);
      return { fire: fire.length, resolved: resolved.length, sentTo };
    } catch (err) {
      logger.warn(`[alerts] check failed: ${err?.message}`);
      return none;
    } finally { running = false; }
  }

  return { tick, state };
}
