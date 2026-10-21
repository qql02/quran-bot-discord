import { EventEmitter }     from 'node:events';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType
} from '@discordjs/voice';
import { Status } from 'discord.js';
import { logger } from '../utils/logger.js';
import { findFfmpeg, openFfmpeg, ffmpegChildrenRss } from './sources/ffmpegSource.js';
import { wasmAvailable, openWasm } from './sources/wasmSource.js';
import { assertSafeUrl } from './urlSafety.js';
import { skipPcm } from './sources/seek.js';
import { config } from '../config.js';

// ─── Config ────────────────────────────────────────────────────────────────────
const LOAD_TIMEOUT_MS  = config.audio.loadTimeoutMs;    // time to get first audio bytes
const STUCK_TIMEOUT_MS = config.audio.stuckTimeoutMs;   // no data while playing
const JOIN_TIMEOUT_MS  = 20_000;

// ─── Decoding backend ──────────────────────────────────────────────────────────
// AUDIO_BACKEND = auto (default) | ffmpeg | wasm
//   ffmpeg → external ffmpeg binary (FFMPEG_PATH → system → ffmpeg-static). Fastest, plays every format.
//   wasm   → pure JS/WebAssembly MP3 decoder. No binaries — for hosts that block ffmpeg. MP3 only.
//   auto   → ffmpeg when available, otherwise wasm.
let backend = null;   // { name, detail, open(url, opts) }

async function selectBackend() {
  const want = config.audio.backend;
  const tryFfmpeg = async () => {
    const bin = await findFfmpeg();
    return bin ? { name: 'ffmpeg', detail: bin, open: (url, o) => openFfmpeg(url, { ...o, bin }) } : null;
  };
  const tryWasm = async () =>
    (await wasmAvailable()) ? { name: 'wasm', detail: 'mpg123-decoder (WASM, MP3 only)', open: openWasm } : null;

  let chosen = null;
  if (want === 'ffmpeg')    chosen = await tryFfmpeg();
  else if (want === 'wasm') chosen = await tryWasm();
  else                      chosen = (await tryFfmpeg()) ?? (await tryWasm());

  if (!chosen) {
    throw new Error(want === 'ffmpeg'
      ? 'ffmpeg not found — install ffmpeg, run `npm i ffmpeg-static`, or set FFMPEG_PATH (or use AUDIO_BACKEND=wasm)'
      : want === 'wasm'
        ? 'mpg123-decoder not installed — run `npm i mpg123-decoder`'
        : 'no audio backend available — install ffmpeg (or `npm i ffmpeg-static`), or `npm i mpg123-decoder`');
  }
  return chosen;
}

// ─── Engine-wide state (used by the admin panel) ───────────────────────────────
const players = new Map(); // guildId → GuildPlayer
const engineHealth = {
  ready:           false,
  startedAt:       null,
  lastError:       null,
  lastReadyAt:     null,
  reconnectCount:  0
};

export function getEngineHealth() {
  return { ...engineHealth, backend: backend?.name ?? null, backendDetail: backend?.detail ?? null };
}

export function getEngineStats() {
  let playing = 0;
  let pingSum = 0;
  let pingN   = 0;
  for (const p of players.values()) {
    if (p.isPlaying()) playing++;
    const ping = p.ping();
    if (ping > 0) { pingSum += ping; pingN++; }
  }
  const mem      = process.memoryUsage();
  const children = ffmpegChildrenRss();      // ffmpeg processes live outside the Node process but count against the host limit
  return {
    connected:     engineHealth.ready,
    activePlayers: playing,
    totalPlayers:  players.size,
    ping:          pingN ? Math.round(pingSum / pingN) : 0,
    uptime:        Math.floor(process.uptime()),
    memUsed:       mem.rss + children,   // total footprint: Node + ffmpeg children
    memNode:       mem.rss,
    memChildren:   children,
    cpuLoad:       cpuLoad()
  };
}

// Process CPU usage between two calls, as a 0..1 fraction of one core.
let _lastCpu  = process.cpuUsage();
let _lastTime = Date.now();
function cpuLoad() {
  const now  = Date.now();
  const diff = process.cpuUsage(_lastCpu);
  const dt   = Math.max(now - _lastTime, 1);
  _lastCpu   = process.cpuUsage();
  _lastTime  = now;
  return Math.min(((diff.user + diff.system) / 1000) / dt, 1);
}

/**
 * Initialise the audio engine. Must be called once, after the client is ready.
 * Picks the decoding backend (ffmpeg or WASM) and then restores saved sessions.
 * @param {import('discord.js').Client} client
 */
export async function initAudio(client) {
  engineHealth.startedAt = new Date().toISOString();
  try {
    backend = await selectBackend();
    engineHealth.ready       = true;
    engineHealth.lastReadyAt = new Date().toISOString();
    logger.success(`[Audio] Local engine ready (backend: ${backend.name} — ${backend.detail})`);
    client._pushActivity?.('info', 'محرك الصوت المحلي جاهز', `${backend.name} + @discordjs/voice`);
  } catch (err) {
    engineHealth.ready     = false;
    engineHealth.lastError = err.message;
    logger.error(`[Audio] ${err.message}`);
    client._pushActivity?.('error', 'محرك الصوت غير جاهز', err.message);
    return;
  }

  try {
    const { recoverSessions } = await import('./recoveryService.js');
    await recoverSessions(client);
  } catch (err) {
    logger.warn('[Audio] Session recovery error:', err.message);
    client._pushActivity?.('error', 'فشل استعادة الجلسات', err.message);
  }

  // After recovery: anything still shown in a voice channel without a live player is a ghost.
  try { cleanGhostVoice(client); } catch (err) { logger.warn('[Audio] Ghost cleanup error:', err.message); }
}

/**
 * Disconnect the bot from voice channels it is still shown in but has no player for
 * (left over from a crash, a hard kill, a PC sleep or a dropped network).
 * Sends the same "leave" gateway payload a normal disconnect would.
 * @returns {number} how many ghost connections were cleared
 */
export function cleanGhostVoice(client) {
  let cleaned = 0;
  for (const guild of client.guilds.cache.values()) {
    const vs = guild.voiceStates?.cache?.get(client.user.id);
    if (!vs?.channelId || players.has(guild.id)) continue;
    try {
      if (guild.shard?.status !== Status.Ready) continue;
      guild.shard.send({ op: 4, d: { guild_id: guild.id, channel_id: null, self_mute: false, self_deaf: false } });
      cleaned++;
      logger.warn(`[Audio][${guild.id}] Cleared ghost voice connection (#${vs.channelId})`);
    } catch (err) {
      logger.warn(`[Audio][${guild.id}] Ghost cleanup failed: ${err.message}`);
    }
  }
  if (cleaned) client._pushActivity?.('info', `تنظيف اتصالات صوتية عالقة`, `${cleaned} سيرفر`);
  return cleaned;
}

/**
 * If the bot is shown in a different voice channel of `guild` while this process has no player for it,
 * send the "leave" payload and give Discord a moment to apply it.
 * @returns {Promise<boolean>} true when a stale connection was released
 */
async function releaseStaleVoice(guild, wantedChannelId) {
  const shown = guild.members?.me?.voice?.channelId;
  if (!shown || shown === wantedChannelId || players.has(guild.id)) return false;
  try {
    if (guild.shard?.status !== Status.Ready) return false;
    guild.shard.send({ op: 4, d: { guild_id: guild.id, channel_id: null, self_mute: false, self_deaf: false } });
    logger.warn(`[Audio][${guild.id}] Released stale voice connection (#${shown}) before joining #${wantedChannelId}`);
    await new Promise(r => setTimeout(r, 1200));
    return true;
  } catch (err) {
    logger.warn(`[Audio][${guild.id}] Could not release stale voice connection: ${err.message}`);
    return false;
  }
}

/**
 * Re-join every voice connection that is not in the Ready state.
 * Healthy connections are left alone so active playback is not interrupted.
 * @returns {number} how many connections were asked to rejoin
 */
export function reconnectAll() {
  let n = 0;
  for (const p of players.values()) {
    if (p.rejoinIfNeeded()) n++;
  }
  engineHealth.reconnectCount += n;
  return n;
}

// ─── GuildPlayer ───────────────────────────────────────────────────────────────
/**
 * One voice connection + one audio player for a guild.
 *
 * Events:
 *   'end'        { reason: 'finished' }          — track ended on its own
 *   'exception'  { exception: { message } }      — playback error mid-track
 *   'stuck'      { thresholdMs }                 — no audio data for too long
 *   'closed'     { code, reason }                — voice connection is gone
 */
export class GuildPlayer extends EventEmitter {
  constructor(guild, voiceChannel) {
    super();
    this.guildId      = guild.id;
    this.guild        = guild;
    this.channelId    = voiceChannel.id;
    this.volume       = 100;       // 0–150 (%)
    this.connection   = null;
    this.audio        = null;
    this._current     = null;      // { id, proc, resource, lastData, live }
    this._seq         = 0;
    this._watchdog    = null;
    this._destroyed   = false;
    this._notReadySince = null;   // when the voice connection last left the Ready state
    this._rejoinTried   = false;
    this.rejoinAfterMs  = 20_000; // try one rejoin after this long not-Ready
    this.giveUpAfterMs  = 60_000; // then report 'closed' (session is destroyed) after this long
  }

  // ── Connection ─────────────────────────────────────────────────────────────
  async connect() {
    if (!engineHealth.ready) throw new Error('Audio engine not ready (no decoding backend)');

    // The bot is still shown in some OTHER voice channel of this server although it has no session here
    // (leftover from a crash / restart / old deployment). Discord then refuses or stalls the new join, which used to
    // surface as a vague "failed to connect". Release the leftover connection first, then join normally.
    await releaseStaleVoice(this.guild, this.channelId);

    this.connection = joinVoiceChannel({
      channelId:      this.channelId,
      guildId:        this.guildId,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf:       true,
      selfMute:       false
    });

    this._initAudio();

    this.connection.on('error', err => {
      logger.warn(`[${this.guildId}] Voice connection error: ${err.message}`);
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this._destroyed) return;
      try {
        // Moved to another channel or Discord is re-negotiating → give it a moment.
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling,  5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch {
        // Real disconnect (kicked / channel deleted) → tell the session manager.
        this._emitClosed(4014, 'disconnected from voice');
      }
    });

    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (this._destroyed) return;
      this._emitClosed(4014, 'connection destroyed');
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, JOIN_TIMEOUT_MS);
    } catch {
      this._destroyed = true;
      const state = this.connection?.state?.status;
      const shown = this.guild.members?.me?.voice?.channelId ?? 'none';
      try { this.connection.destroy(); } catch {}
      // Not a user-fixable cause (permissions, full channel and stage channels are checked BEFORE joining) →
      // reported as an unexpected error with a code; the diagnostics below end up in the log next to it.
      throw Object.assign(
        new Error(`Could not join voice channel within ${JOIN_TIMEOUT_MS / 1000}s (state=${state}, bot-shown-in=${shown})`),
        { code: 'VOICE_JOIN_TIMEOUT' }
      );
    }

    this.connection.subscribe(this.audio);
    players.set(this.guildId, this);
    this._startWatchdog();
  }

  // Audio player + its listeners. Separate from connect() so it is testable offline.
  _initAudio(noSubscriber = NoSubscriberBehavior.Pause) {
    this.audio = createAudioPlayer({ behaviors: { noSubscriber } });

    this.audio.on('error', err => {
      const cur = this._current;
      if (!cur || this._destroyed) return;
      logger.error(`[${this.guildId}] Audio player error: ${err.message}`);
      this._cleanupCurrent();
      this.emit('exception', { exception: { message: err.message } });
    });

    this.audio.on('stateChange', (oldState, newState) => {
      const cur = this._current;
      if (!cur || this._destroyed) return;
      // Natural end of the resource.
      if (newState.status === AudioPlayerStatus.Idle &&
          oldState.status !== AudioPlayerStatus.Idle &&
          oldState.resource === cur.resource) {
        this._cleanupCurrent();
        this.emit('end', { reason: 'finished' });
      }
    });
  }

  isConnected() {
    return !this._destroyed &&
      this.connection?.state?.status === VoiceConnectionStatus.Ready;
  }

  isPlaying() {
    return this.audio?.state?.status === AudioPlayerStatus.Playing;
  }

  ping() {
    const net = this.connection?.state?.networking?.state;
    return net?.ws?.ping ?? net?.udp?.ping ?? 0;
  }

  rejoinIfNeeded() {
    if (this._destroyed || !this.connection) return false;
    const status = this.connection.state.status;
    if (status === VoiceConnectionStatus.Ready) return false;
    try { return this.connection.rejoin(); } catch { return false; }
  }

  // ── Playback ───────────────────────────────────────────────────────────────
  /**
   * Start playing a URL. Resolves once the first audio bytes arrive,
   * rejects if the URL cannot be loaded (so the caller can try the next one).
   * @param {string} url
   * @param {{ live?: boolean, allowLocal?: boolean, startMs?: number }} [opts]  allowLocal: tests only (skips URL safety checks);
   *        startMs: begin this far into the recording (rejects with 'seek-past-end' when the recording is shorter)
   */
  async play(url, { live = false, allowLocal = false, startMs = 0 } = {}) {
    if (this._destroyed) throw new Error('Player destroyed');
    if (!backend) throw new Error('Audio engine not initialised');
    // Both backends download through safeFetch() (every redirect hop re-validated, private IPs refused at
    // connect time) — ffmpeg is fed from a pipe and never opens the network itself. Early cheap rejection here.
    if (!allowLocal) await assertSafeUrl(url);
    if (this._destroyed) throw new Error('Player destroyed');

    this._cleanupCurrent();               // replace silently — no 'end' event
    const id = ++this._seq;

    const state = { id, src: null, resource: null, lastData: Date.now(), live };

    // Resolves once the first audio is decoded; rejects if the URL can't be loaded.
    const src = await backend.open(url, {
      live,
      loadTimeoutMs: LOAD_TIMEOUT_MS,
      onData: () => { state.lastData = Date.now(); }
    });

    // A newer play()/stop() happened while we were loading → drop this one.
    if (this._destroyed || id !== this._seq) {
      src.close();
      throw new Error('superseded');
    }

    // Start in the middle: drop the first `startMs` of decoded audio (see sources/seek.js). A live stream has no position.
    let stream = src.stream;
    const offset = live ? 0 : Math.max(0, Math.floor(Number(startMs) || 0));
    if (offset > 0) {
      // Decoding the skipped part is far faster than real time, but not free: allow time in proportion to the offset.
      const budget = Math.max(LOAD_TIMEOUT_MS, 30_000) + offset / 25;
      let timer;
      try {
        stream = await Promise.race([
          skipPcm(src.stream, offset),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`seek timeout after ${Math.round(budget / 1000)}s`)), budget); })
        ]);
      } catch (err) {
        src.close();
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (this._destroyed || id !== this._seq) { src.close(); throw new Error('superseded'); }
    }

    state.src = src;
    state.startMs = offset;
    const resource = createAudioResource(stream, {
      inputType:    StreamType.Raw,
      inlineVolume: true
    });
    resource.volume?.setVolume(this.volume / 100);
    state.resource = resource;
    this._current  = state;

    this.audio.play(resource);
  }

  /**
   * How far into the current recording playback is, in ms (counts the part the track was started at, and does not move while paused
   * or while the connection is being re-established). 0 when nothing is loaded or for a live stream.
   */
  positionMs() {
    const cur = this._current;
    if (!cur || cur.live) return 0;
    return (cur.startMs ?? 0) + (cur.resource?.playbackDuration ?? 0);
  }

  pause() {
    return this.audio?.pause(true) ?? false;
  }

  resume() {
    return this.audio?.unpause() ?? false;
  }

  /** Stop the current track without emitting 'end'. */
  stop() {
    this._cleanupCurrent();
    try { this.audio?.stop(true); } catch {}
  }

  /** @param {number} percent 0–150 */
  setVolume(percent) {
    this.volume = percent;
    this._current?.resource?.volume?.setVolume(percent / 100);
  }

  async destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    clearInterval(this._watchdog);
    this._cleanupCurrent();
    try { this.audio?.stop(true); } catch {}
    try { this.connection?.destroy(); } catch {}
    players.delete(this.guildId);
    this.removeAllListeners();
  }

  // ── Internals ──────────────────────────────────────────────────────────────
  _cleanupCurrent() {
    const cur = this._current;
    this._current = null;
    if (!cur) return;
    try { cur.src?.close(); } catch {}
    try { cur.src?.stream?.destroy(); } catch {}
  }

  _startWatchdog() {
    this._watchdog = setInterval(() => {
      if (this._destroyed) return;
      this._checkConnection();
      const cur = this._current;
      if (!cur) return;
      if (this.audio?.state?.status !== AudioPlayerStatus.Playing) return; // paused / buffering
      if (Date.now() - cur.lastData < STUCK_TIMEOUT_MS) return;
      logger.warn(`[${this.guildId}] No audio data for ${STUCK_TIMEOUT_MS}ms — treating as stuck`);
      this._cleanupCurrent();
      try { this.audio.stop(true); } catch {}
      this.emit('stuck', { thresholdMs: STUCK_TIMEOUT_MS });
    }, 5_000);
    this._watchdog.unref?.();
  }

  // Voice connection stuck in Signalling/Connecting/Disconnected (PC woke from sleep, network blip…):
  // rejoin once, and if it still isn't Ready, close the session instead of leaving a silent ghost.
  _checkConnection() {
    const status = this.connection?.state?.status;
    if (!status || status === VoiceConnectionStatus.Ready) {
      this._notReadySince = null; this._rejoinTried = false;
      return;
    }
    this._notReadySince ??= Date.now();
    const down = Date.now() - this._notReadySince;
    if (down >= this.giveUpAfterMs) {
      this._emitClosed(4000, `voice connection not ready for ${Math.round(down / 1000)}s`);
    } else if (down >= this.rejoinAfterMs && !this._rejoinTried) {
      this._rejoinTried = true;
      logger.warn(`[${this.guildId}] Voice connection ${status} for ${Math.round(down / 1000)}s — rejoining`);
      this.rejoinIfNeeded();
    }
  }

  _emitClosed(code, reason) {
    if (this._destroyed) return;
    this.emit('closed', { code, reason });
  }
}
