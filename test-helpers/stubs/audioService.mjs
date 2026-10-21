import { EventEmitter } from 'node:events';

/** Fake voice player. Tests control connect() through globalThis.__player. */
export class GuildPlayer extends EventEmitter {
  constructor(guild, channel) {
    super();
    this.guild = guild; this.channel = channel;
    (globalThis.__players ??= []).push(this);
    this.stopped = 0; this.destroyed = false; this.volume = null;
  }
  async connect()  { await globalThis.__player?.connect?.(this); }
  setVolume(v)     { this.volume = v; }
  stop()           { this.stopped++; }
  async destroy()  { this.destroyed = true; }
  async play(url, opts) { return globalThis.__player?.play?.(url, opts, this); }
  positionMs()     { return this.pos ?? 0; }     // tests set player.pos to simulate how far playback has got
  pause()          {}
  resume()         {}
}
