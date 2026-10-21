/**
 * The real models and services behind the phase-5 owner routes (see ownerPhase5.js, which takes them as `deps` so it can be tested
 * without a database). Only wiring lives here — no logic.
 */
import mongoose from 'mongoose';
import { config } from '../config.js';
import { BotInstance } from '../models/BotInstance.js';
import { PlayerJob } from '../models/PlayerJob.js';
import { PullLog } from '../models/PullLog.js';
import { CustomStation } from '../models/CustomStation.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { WirdSubscription } from '../models/WirdSubscription.js';
import { ReligiousEvent } from '../models/ReligiousEvent.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { Blacklist } from '../models/Blacklist.js';
import { BotControl } from '../models/BotControl.js';
import { OwnerNote } from '../models/OwnerNote.js';
import { Broadcast } from '../models/Broadcast.js';
import { addStation, removeStation, probeStream } from '../services/stationService.js';
import { listAllReciters, getPlayableUrls } from '../services/quranService.js';
import { sendEvent } from '../services/eventService.js';
import { getControlSync, saveControl } from '../services/controlService.js';
import { getAllSessions } from '../managers/sessionManager.js';
import { nextExpiry } from '../utils/wird.js';
import { MOD_CAPS, MOD_CAP_KEYS, modCan } from '../utils/botControl.js';
import { ABSOLUTE_SESSION_MS } from './hardening.js';

/**
 * @param {{ adminIds: string[], modIds: string[], roleOf: (id:string)=>string|null, apiBase: string, sessionSecret: string }} o
 */
export function buildPhase5Deps({ adminIds, modIds, roleOf, apiBase, sessionSecret }) {
  return {
    models: { BotInstance, PlayerJob, PullLog, CustomStation, GuildSettings, WirdSubscription, ReligiousEvent, ActivityLog },
    exportModels: { settings: GuildSettings, stations: CustomStation, blacklist: Blacklist, control: BotControl, notes: OwnerNote, events: ReligiousEvent, broadcasts: Broadcast },
    svc: {
      addStation, removeStation, probeStream, listAllReciters, getPlayableUrls, sendEvent, nextExpiry, getControl: getControlSync, saveControl,
      botRole: config.bot.role,
      // This process's own sessions in the shape the bot registry uses (what other bots publish about themselves)
      ownSessions: () => getAllSessions().filter(s => s?.guildId && s?.voiceChannelId).map(s => ({
        guildId: s.guildId, channelId: s.voiceChannelId, channelName: s.channelName ?? '', status: s.status ?? 'idle',
        surah: s.current?.surah?.english ?? null, surahAr: s.current?.surah?.arabic ?? null, reciter: s.current?.reciter ?? null, queueSize: s.queue?.length ?? 0
      }))
    },
    security: {
      adminIds: () => [...adminIds], modIds: () => [...modIds], roleOf,
      sessionsCollection: () => mongoose.connection.collection('sessions'),
      info: () => ({
        apiBaseHttps: String(apiBase).startsWith('https://'), trustProxy: config.api.trustProxy, host: config.api.host,
        sessionDays: config.api.sessionDays, absoluteDays: Math.round(ABSOLUTE_SESSION_MS / 86_400_000),
        adminCount: adminIds.length, modCount: modIds.length, secretLength: String(sessionSecret ?? '').length,
        modCapsOn: MOD_CAP_KEYS.filter(k => modCan(getControlSync(), k)).length, modCapsTotal: MOD_CAP_KEYS.length, modCaps: MOD_CAPS
      })
    }
  };
}
