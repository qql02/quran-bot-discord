# Security fixes (v2.3.1)

| # | Issue | Fix |
|---|-------|-----|
| 1 | SSRF: ffmpeg re-resolved DNS / followed redirects / fetched HLS segments itself (UA cloaking, DNS rebinding, probe-failure bypass) | Node downloads via `safeFetch`; ffmpeg reads `pipe:0` only. Private IPs are refused **at connect time** (`safeLookup` + undici Agent). Probe errors now fail closed. HLS is off unless `AUDIO_ALLOW_HLS=1`. |
| 2 | `trust proxy` hard-coded + forged `x-forwarded-proto` | `TRUST_PROXY` (default 1; 0 = ignore X-Forwarded-*), `API_HOST` to bind 127.0.0.1; https forcing only when a proxy is trusted and `API_BASE_URL` is https. |
| 3 | CSP `'unsafe-inline'` for scripts | Dashboard has no inline scripts/handlers (`app.js` + event delegation); CSP is `script-src 'self' cdn.jsdelivr.net` + `script-src-attr 'none'`. |
| 4 | `/api/admin/settings` accepted objects | Only string / number / boolean / null. |
| 5 | `onerror` string-injection pattern for guild icons | Replaced by a capture-phase listener using `textContent`. |
| 6 | `/api/admin/bot/deploy` returned script stdout | Returns `{ ok: true }` only. |
| 7 | Role pings only validated when chosen | `pingableRoleId()` re-checks (exists, not @everyone, still mentionable) at every send (adhkar, ayah, events). |
| + | API responses cacheable | `Cache-Control: no-store` on `/api` and `/auth`. |

Behaviour changes: legacy Shoutcast "ICY 200 OK" servers and HLS stations no longer play by default.

## Follow-up (v2.3.2)

| # | Issue | Fix |
|---|-------|-----|
| 8 | Weak/placeholder `SESSION_SECRET` was accepted when `NODE_ENV` was unset (default "development") | Fatal unless `NODE_ENV` is explicitly `development` or `test`. |
| 9 | Malformed JSON body (parsed before auth) returned Express' stack trace when `NODE_ENV` ≠ production | Global JSON error handler: generic message, details only in the log. |
| 10 | `isPrivateIp` missed `::7f00:1`, Teredo `2001::/32`, `100::/64` | IPv6 is now allow-listed to global unicast `2000::/3` (minus Teredo/6to4/documentation); unparsable → refused. |

## Follow-up (review items 1, 2, 4)
- **#1** Startup warning when `TRUST_PROXY>0` and the API listens on a non-loopback host; `.env.example` documents `TRUST_PROXY=0` for directly exposed ports.
- **#2** Chart.js 4.4.0 is now self-hosted (`dashboard/admin/vendor/chart.umd.js`); CSP is `script-src 'self'` (no CDN).
- **#4** `openFfmpeg()` rejects any non-http(s) URL scheme itself (defence in depth next to `assertSafeUrl`).
- **#6** Activity log is now persisted in MongoDB (`ActivityLog`, 30-day TTL) so restart/reset/deploy history survives restarts. Dashboard session shortened from 7 days to `SESSION_DAYS` (default 2).
- **#7** Discord OAuth requests now time out after 10s.
- Not changed: #3 (HLS stays off by default), #5 (live radio streams are endless by design; `MAX_SESSIONS` limits impact), re-authentication for sensitive actions (needs dashboard UI work).

## Owner panel upgrade — phase 1
- **Voice control:** `POST /api/admin/sessions/:id/control` (pause / resume / skip / loop / volume 0–150) + buttons on every session card.
- **Server management:** `POST /api/admin/guilds/:id/leave` (needs `confirm` = server id; UI asks to type the server name) and `POST /api/admin/guilds/:id/message` (embed to the server's announcement channel). Both in the server detail modal.
- **Safer sensitive actions:** stop-all, reset-all stats, restart and deploy now require a server-side `confirm` token; restart also asks to type a word in the UI.
- **Clearer audit trail:** every admin action in the activity log records who did it (Discord name + id), shown in the Activity page.

## Owner panel upgrade — phase 2
New file `src/api/ownerRoutes.js` (registered from `server.js`), new `dashboard/admin/owner.js`.
- **مراقبة النظام:** CPU / RAM / event-loop lag / Discord ping / MongoDB ping, 1-hour charts, daily join/leave growth chart.
- **سجلات البوت:** view `logs/*.log` in the dashboard (level + text filter, auto-refresh, download). File names are matched against a fixed pattern (no paths); tokens, Mongo credentials and secrets are redacted server-side.
- **تفاصيل السيرفر:** owner, channels, roles, boosts, the bot's permissions, voice channels (can the bot join?), enabled features, current session; button to switch off a server's adhkar/verse posting.
- **إجراءات جماعية:** tick servers → message / leave / blacklist (max 100, 5 at a time, one run at a time, server-side confirm tokens `BULK_MESSAGE|BULK_LEAVE|BULK_BLACKLIST`, UI asks to type the count).
- **تنظيف السيرفرات:** finds abandoned servers (no activity for N days, optional member limit; never ones with a live session or that joined recently) and leaves the selected ones.
- **حالة الظهور:** online / idle / dnd / invisible without changing the activity text.

## Owner panel upgrade — phase 3
- **Roles:** `ADMIN_IDS` = owners (everything). New optional `MOD_IDS` = moderators: dashboard login allowed, limited to view, voice control, remote join/play, per-server settings, message a server (and stop a session). Everything else (leave, blacklist, bulk, broadcast, restart, deploy, logs, system, cleanup, restrictions, stats reset) stays owner-only: those routes still use `requireAdmin`. The role is re-read from the env lists on every request, so removing an id takes effect immediately. The activity log tags moderator actions `[مشرف]`.
- **Message to a chosen channel:** `GET /api/admin/guilds/:id/channels` + `channelId` on `/message` (must belong to that server, be a text channel, and the bot must be able to post there).
- **Remote voice:** `POST /api/admin/guilds/:id/join` and `/play` (surah + optional reciter/riwaya). Never hijacks: if the bot already sits in a channel, the surah is queued there (to move it, stop the session first). Respects `MAX_SESSIONS` and the per-server queue limit.
- **Per-server settings:** language, adhkar channel + on/off, verse-of-the-day channel + on/off (`POST /api/admin/guilds/:id/config`; channels are validated, "on" needs a channel).
- **Per-server restrictions (owner only):** *locked* (read-only server: commands and panel buttons refused, `/help /invite /donation`, `/wird` and `/mushaf` buttons and scheduled posts still work), disabled commands, shorter queue limit, optional note shown to users. Enforced in `interactionCreate` (owners exempt, fails open if the database hiccups); cached for 60 s and cleared at once on save.

## Owner panel upgrade — phase 3b: remote play page
- New dashboard page **تشغيل عن بعد** (owner and moderators): pick any server the bot is in → any of its voice channels (channels the bot can't join/speak in are greyed out) → any surah (+ optional reciter) → "enter only" or "enter and play".
- `join` / `play` accept `replace: true` to **move** the bot out of another channel of the same server (the old session is stopped first). Without it the old behaviour stays: the surah is queued in the existing session.

## Owner panel upgrade — phase 4
New file `src/api/ownerPhase4.js` (registered from `server.js`), pure rules in `src/utils/ownerInsights.js` (unit-tested in `test/ownerInsights.test.js`), models `Broadcast` and `OwnerNote`. No new environment variables.
- **🔔 مركز التنبيهات** (overview, owner only): one live list — database down / slow, Discord not ready or high ping, event-loop lag, heap / host memory / CPU, errors in the last hour (from `logs/combined.log`), servers with critical problems, scheduled announcements that were missed or are overdue, maintenance mode, fresh restart. Each alert links to the page that fixes it; a badge on the sidebar shows the count (refreshes every 60 s).
- **🩺 صحة السيرفرات** (new page, owner only): checks every server — adhkar / verse-of-the-day switched on but the channel was deleted or the bot cannot write there (critical), no channel the bot can post in, no voice channel it can join, locked server (warnings). Filter by level, open the server, or switch off the broken auto-posting with one click. Result cached 60 s; "فحص الآن" forces a fresh scan.
- **📝 وسوم وملاحظات خاصة** (server modal, owner only): up to 8 tags (20 chars) + a 1000-char note per server. Tags show as chips in the servers table and are searchable there and in Ctrl+K. Stored in MongoDB (`OwnerNote`); never sent to Discord.
- **⏰ إعلانات مجدولة + سجل دائم** (broadcast page, owner only): schedule an announcement for 1 minute – 90 days ahead, to all servers or to the ones ticked on the Servers page (max 100, max 20 pending). A 30-second scheduler sends what is due; if the bot was off for more than 30 minutes the announcement is marked "فات موعده" and is **never sent late**; a run interrupted by a crash is marked failed. Cancel any pending one. Every announcement (immediate or scheduled) is now stored in `Broadcast` (kept 1 year) with sent / failed / skipped counts and who sent it — the history and success-rate panel survive restarts. Immediate and scheduled sends share one lock, so they never overlap.
- **🔎 سجل التدقيق المتقدم** (activity page, owner + moderators): filter by type, actor, text and date range, page through results ("عرض المزيد"), export up to 2000 rows to CSV (spreadsheet formulas neutralised). User text is escaped before it reaches a Mongo `$regex`.
- **⌨️ بحث سريع Ctrl+K / ⌘K**: jump to any page or open any server (by name, id or tag) from the keyboard.


## Owner panel upgrade — phase 4b
- **🚨 تنبيهات Discord تلقائية:** every 60 s the alert list is evaluated (`src/services/alertNotifier.js`, rules in `planAlertNotifications()` in `ownerInsights.js`). A **critical** alert seen on two consecutive checks is sent as a DM to every id in `ADMIN_IDS`; if it is still critical after 6 h you get one reminder; when it clears you get a "recovered" message. No DM in the first 90 s after start, none for warnings/info, and none for `guild-critical` (a single server's lost channel — that server's own owner is already told weekly). In memory only: after a restart something still critical is announced again. Optional `OWNER_ALERT_DM=0` turns it off (documented in `.env.example`).
- **Fixes after review:** the scheduler now takes the shared announcement lock *synchronously* at the start of each tick, so a manual announcement can no longer start in the gap and the scheduler can no longer release a lock it does not own; the server-health scan yields to the event loop every 50 servers and skips a server whose check throws instead of failing the whole scan; a note left behind by a server the bot has left can now be cleared (saving a new one still needs the bot to be in the server); server ids are validated on the notes routes; the CSV-limit toast is now a warning that says how to export the rest.
- Tests: `test/alertNotifier.test.js` (8 new — confirmation, no repeat, reminder, recovery, exclusions, grace period, a closed DM does not block other owners, the notifier never throws).

## Owner panel upgrade — phase 5: server control
- **Servers page:** summary tiles, filter chips with live counts (active now · locked · restricted · tagged · never played · no auto-posting · language), size filter, 6 sorts + reverse, **saved views** (stored in the browser), the last filters/sort are remembered, rows load 50 at a time ("show more / show all"). `/` focuses the search. Shift+click selects a range; "select all" now selects every server matching the filters (bulk actions send them in batches of 100).
- **Server drawer** (replaces the long modal): side panel with tabs — overview (with an "needs attention" box: missing permissions, deleted adhkar/verse channel, no announcement channel …), voice (pause / resume / skip / loop / volume for the live session + join & play), settings + message, restrictions, notes & tags, actions (+ danger zone). ← / → step through the servers of the current list and keep the tab; Esc closes the top dialog first.
- **Timed lock:** lock a server for 1 h … 30 days or until you unlock it. `restrictions.lockedUntil` (new, optional); the lock stops applying by itself at that time — nothing has to run to release it, so a restart can't leave a server locked. `POST /api/admin/guilds/:id/lock { locked, minutes? }` (owner only). Saving the other restrictions no longer touches the lock.
- **New bulk actions** (owner only, server-side confirm tokens, inputs validated before anything runs): lock / unlock `BULK_LOCK` `BULK_UNLOCK`, stop sessions `BULK_STOP`, language `BULK_LANGUAGE`, stop auto-posting `BULK_SCHEDULES`, add a private tag `BULK_TAG`. Plus "export selection to CSV" in the browser.
- `GET /api/admin/guilds` now also returns `locked`, `lockedUntil`, `restricted`, `adhkar`, `ayah`, `lastActivity`; `/details` returns the live session's surah, reciter and volume.
- Tests: `test/restrictionRules.test.js` (+3: timed lock, Date/number handling, `buildLockPatch`). Lint: fixed the existing `eqeqeq` / `prefer-const` errors in `ownerRoutes.js`, `server.js` and `data/adhkar.js`.

## Owner panel upgrade — phase 6: look, usability, speed (dashboard only, no API changes)
- **Look:** new warm palette (ink background, one emerald accent, muted gold/red/teal) with text contrast ≥ 5:1; flat surfaces, hairline borders, squarer tags and buttons, no gradients / glow / background grid. Font: IBM Plex Sans Arabic (+ Amiri for the "ق" mark).
- **No emoji, no stock icons:** every pictogram in `index.html`, `app.js` and `owner.js` was removed. Sidebar uses 15 hand-drawn line icons (an inline SVG sprite at the top of `<body>`), status uses small coloured squares, buttons use words (قفل / فتح / إيقاف / تكرار …). Kept: ✓ ✕ ✗ ← → and the ▲ ● status glyphs.
- **Usability:** `?` opens a keyboard-shortcuts dialog (also a sidebar item); sidebar items have tooltips (phone layout shows icons only) and `aria-current`; on phones touch-sized controls, 16px fields (no iOS zoom) and server summary tiles in 2 rows.
- **Speed:** text-field filters are debounced (160 ms); fonts load with `display=swap` + `preconnect`.
- The last CSS block ("Design layer") holds the overrides; the tokens are at the top of the stylesheet.
- Files: `dashboard/admin/index.html`, `app.js`, `owner.js`.

## Full security review (v2.4.x, October 2026)
Reviewed: Express API + sessions + OAuth2, owner routes, dashboard (XSS / CSV), interaction authorisation, SSRF guard, secrets, logging, dependencies, private-chat commands.
- **No exploitable issue found** in the API, dashboard, OAuth flow, SSRF guard (18 bypass forms tried: decimal / hex / octal IPs, `127.1`, IPv4-mapped IPv6, userinfo tricks, trailing dot, `.localhost`…) or dependencies (`npm audit`: 0).
- **Fixed:** prototype-name lookups in `!settings` (`constructor` / `__proto__` were accepted as a value), the typed command word echoed back with markdown, partial deletion reported as success, stale Mushaf-view cache after deletion.
- **Added:** two-step consent (`!export`, `!forget`), single-use and 2 minutes; private-chat channel-type check; export cooldown.
- **Clarified:** the `TRUST_PROXY` start-up warning no longer fires when `API_BASE_URL` is https (a TLS proxy must exist there, and `TRUST_PROXY=0` would stop the Secure session cookie from being set).
- **Accepted / documented:** Mushaf SVG files are checked by structure only when the CDN publishes no manifest (no SHA-256 check); a compromised CDN could serve a hostile SVG to the renderer (resvg does not run scripts or fetch network resources). Logs are written unredacted to `logs/` (redacted when shown in the dashboard) — keep that folder private.

## Stronger API protection (`src/api/hardening.js`, wired in `server.js`)
| # | Layer | What it does |
|---|-------|--------------|
| 1 | **CSRF header** | Every POST / DELETE must carry `X-Requested-With: quran-bot-dashboard` (sent by `apiFetch` and logout in the dashboard). A cross-site page cannot add it without a CORS preflight, which is refused for foreign origins. Works next to the Origin/Referer check. |
| 2 | **`__Host-` session cookie** | Cookie is `__Host-qb.sid` (Secure, Path=/, no Domain): a sibling sub-domain on the same panel domain can't plant or overwrite it. **Everyone signs in once more after this update.** |
| 3 | **Absolute session lifetime** | The cookie slides, so a stolen one used daily never expired. A session now ends 7 days after sign-in, whatever happens. |
| 4 | **Per-account write limit** | 60 changes/min for the owner, 30 for a moderator (POST/DELETE under `/api/admin`), `429` + `Retry-After`. |
| 5 | **Flat query strings** | `query parser = simple`: `?a[$ne]=x` is a string, never an object (kills the NoSQL-operator trick for every route at once). |
| 6 | **Method allow-list** | Only GET / HEAD / POST / DELETE / OPTIONS; anything else is `405`. |
| 7 | **Slow-client limits** | Headers within 20 s, whole request within 30 s, checked every 5 s (slowloris gets `408` and is closed); `keepAliveTimeout` 61 s (no random 502 behind a proxy); at most 100 headers — the rest are dropped, which makes an oversized request fail the CSRF header check. |
| 8 | **OAuth state expires** | The state issued at `/auth/discord` is valid for 10 minutes and once. |
| 9 | **Headers** | Added `Cross-Origin-Resource-Policy: same-origin` (the public logo route is `cross-origin` so Discord can embed it), `X-Permitted-Cross-Domain-Policies`, `Origin-Agent-Cluster`, a longer `Permissions-Policy`, and CSP `frame-src / worker-src / manifest-src / media-src 'none'` (+ `upgrade-insecure-requests` on https). |
| 10 | **Sign-in audit** | Every dashboard sign-in and every refused attempt (account id + IP) goes into the activity log. |
| 11 | **Smaller things** | Dashboard files are served with `dotfiles: deny`; client-controlled text is stripped of control characters before it reaches a log line. |

## Stability pass
- **Database down → fast 503.** Sessions live in MongoDB; while it was unreachable every `/api` and `/auth` request hung ~30 s in the session store. `dbGuard` (src/api/hardening.js) now answers `503 + Retry-After` immediately, before the session layer. The dashboard's static files still load.
- **Clean shutdown.** On SIGINT/SIGTERM the API server stops accepting requests (idle sockets dropped) and Mongoose disconnects after voice channels are left, so restarts don't leave half-open connections.
- Endpoint audit: 76 routes / 147 unauthenticated probes → 0 findings (see above).
