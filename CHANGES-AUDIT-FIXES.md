# Audit fixes (items 1, 2, 3, 4, 6, 7, 8, 9)

Each item was confirmed in the code before it was changed.

1. **Dashboard sessions** — `/auth/discord` no longer writes to the session store. The OAuth state is an HMAC-signed,
   10-minute, `__Host-` cookie (`signOauthState` / `verifyOauthState` in `src/api/hardening.js`). `readSessions`
   (`ownerPhase5.js`) now asks the store only for signed-in sessions, newest first, so anonymous documents cannot push a real
   session out of the list or out of "revoke" / "revoke all". Anonymous documents already in the store expire by TTL (≤ `SESSION_DAYS`).
2. **Disabled commands vs panel buttons** — `restrictionRules.js` maps each `panel:<action>` button / tool-menu choice to its
   slash command (`khatma`, `volume`, `leave`, `next`, `hold`, `continue`, `clearqueue`, `memorize`, `sleep`, `live`, `recite`);
   `blockedBy` refuses it when that command is disabled. `interactionCreate.js` passes `interaction.values` for the select menu.
   Note: the dashboard's "block voice commands" preset therefore now also blocks the panel's Stop / Skip / Pause buttons, as it does the commands.
3. **Reciter change** — `requireReciterChangeRight` (`utils/permissions.js`): with a session, only the bot's voice room; without
   one, a member in a voice channel or someone with Manage Server. Used by `pick_reciter` and `rec_pick`.
4. **SVG rendering** — ordinary pages use `renderAsync` (thread pool). Pages 1–2 keep the synchronous path because the crop
   (`cropByBBox`) exists only on a `Resvg` instance; they are two pages and cached.
6. **playNext lock** — the lock is now a `Map` guildId → owner token. A call releases only a lock it still owns; the memorize
   delay re-takes it under the same owner; a non-owner no longer consumes `skipPending`.

7. **Snapshot race** — `SessionSnapshot.save` / `remove` of one server now run through a per-server queue
   (`snapEnqueue` in `sessionManager.js`), and a queued save is skipped when its session is no longer the live one.
8. **Uptime statistic** — `pauseSession` records `pausedAt`; `resumeSession` moves `startedAt` forward by the pause; play time is
   computed by `playedSeconds()` (a track ended while paused counts up to the pause).
9. **Wird tick** — subscribers are loaded 500 at a time ordered by `_id` instead of all at once. No projection was added:
   `processSub` and its helpers read many fields of the document.

Not changed (still open): 5 (custom stations), 10 (deployment setting `TRUST_PROXY`), 11 (optional SVG hardening).
