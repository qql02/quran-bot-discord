/**
 * logger.js — Real file + console logger
 *
 * Features:
 *  - Writes to logs/combined.log (all levels) and logs/error.log (ERROR only)
 *  - Daily rotation: renames current log to combined-YYYY-MM-DD.log at midnight
 *  - Console output with ANSI colors (suppressed when NO_COLOR=1)
 *  - Structured JSON lines in files for easy grep/parsing
 *  - Drop-in compatible: same API as before (logger.info / warn / error / debug / success / bot)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { redact } from './redact.js';

// ─── Paths ────────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR   = path.resolve(__dirname, '../../logs');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const COMBINED_PATH = path.join(LOG_DIR, 'combined.log');
const ERROR_PATH    = path.join(LOG_DIR, 'error.log');

// ─── File streams ─────────────────────────────────────────────────────────────
let combinedStream = fs.createWriteStream(COMBINED_PATH, { flags: 'a' });
let errorStream    = fs.createWriteStream(ERROR_PATH,    { flags: 'a' });

// ─── Daily rotation ───────────────────────────────────────────────────────────
let _rotateDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function rotateLogs() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === _rotateDate) return;
  _rotateDate = today;

  // Close current streams
  combinedStream.end();
  errorStream.end();

  // Archive yesterday's file
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  for (const [src, suffix] of [[COMBINED_PATH, 'combined'], [ERROR_PATH, 'error']]) {
    if (fs.existsSync(src)) {
      try { fs.renameSync(src, path.join(LOG_DIR, `${suffix}-${yesterday}.log`)); } catch {}
    }
  }

  // Open fresh streams
  combinedStream = fs.createWriteStream(COMBINED_PATH, { flags: 'a' });
  errorStream    = fs.createWriteStream(ERROR_PATH,    { flags: 'a' });
  pruneOldLogs();
}

// Archived daily logs were never deleted → the host disk slowly fills up. Keep LOG_RETENTION_DAYS of them.
function pruneOldLogs() {
  const cutoff = Date.now() - config.log.retentionDays * 86_400_000;
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^(combined|error)-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const p = path.join(LOG_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch { /* best-effort */ }
}
pruneOldLogs();

// Run rotation check every hour
setInterval(rotateLogs, 60 * 60 * 1000).unref();

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const NO_COLOR = config.log.noColor;

const C = NO_COLOR ? {} : {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  gray:    '\x1b[90m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  white:   '\x1b[97m',
};

const LEVEL_COLOR = {
  INFO:    C.cyan    ?? '',
  SUCCESS: C.green   ?? '',
  WARN:    C.yellow  ?? '',
  ERROR:   C.red     ?? '',
  DEBUG:   C.magenta ?? '',
  BOT:     C.blue    ?? '',
  AUDIO:   C.white   ?? '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23); // ms precision
}

function stringify(...args) {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error)   return `${a.message}\n${a.stack ?? ''}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

function writeLine(level, message) {
  rotateLogs();
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message }) + '\n';
  combinedStream.write(line);
  if (level === 'ERROR') errorStream.write(line);
}

function printConsole(level, ...args) {
  const reset  = C.reset  ?? '';
  const bold   = C.bold   ?? '';
  const gray   = C.gray   ?? '';
  const lColor = LEVEL_COLOR[level] ?? '';
  const msg    = redact(stringify(...args));   // never print a token / password, even inside an error message
  const line   = `${gray}[${ts()}]${reset} ${lColor}${bold}[${level.padEnd(7)}]${reset} ${msg}`;
  if (level === 'ERROR') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
  return msg;
}

// LOG_TAG (set by the main bot for its second-bot process) marks every line, so one shared console stays readable.
const TAG = process.env.LOG_TAG ? `[${process.env.LOG_TAG}] ` : '';

function log(level, ...args) {
  const message = printConsole(level, ...(TAG ? [TAG.trimEnd(), ...args] : args));
  writeLine(level, message);
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const logger = {
  info:    (...a) => log('INFO',    ...a),
  success: (...a) => log('SUCCESS', ...a),
  warn:    (...a) => log('WARN',    ...a),
  error:   (...a) => log('ERROR',   ...a),
  debug:   (...a) => log('DEBUG',   ...a),
  bot:     (...a) => log('BOT',     ...a),
  audio:   (...a) => log('AUDIO',   ...a),

  /** Log dir path (useful for diagnostics reporting the log location) */
  logDir: LOG_DIR,
};
