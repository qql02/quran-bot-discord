# Console diagnostics, /pull fix, second bot from the same project, secret redaction

- Fix: `/pull` failed to load ("Invalid string length"): its description was 105 characters, Discord's limit is 100.
- Start-up console report (`src/utils/startupCheck.js`): every environment variable ✅ / ⚠️ / ❌ with the reason; secrets masked.
- Command loading errors show the failing line and the exact name/description that is too long.
- Console shows Discord client errors/warnings, shard disconnect/reconnect/resume, session invalidation and Node warnings.
- Second bot from this same project: put its token in `SECOND_BOT_TOKEN` (`src/services/secondBotLauncher.js`); lines tagged `[2nd-bot]`; restarts on crash with backoff; stops with the main bot, and exits by itself if the main bot is killed (`src/utils/parentWatch.js`). `ALT_BOT_ID` is optional.
- `src/utils/redact.js`: bot tokens, SESSION_SECRET, client secret and the database password are replaced before anything is printed or written to `logs/`.
- 25 seconds after start the console says whether a second bot is registered.
