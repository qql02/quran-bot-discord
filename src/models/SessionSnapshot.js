import mongoose from 'mongoose';
import { config } from '../config.js';
import { getPositionMs } from '../services/transferState.js';

// Several bots (different tokens) can share ONE database: every snapshot belongs to the bot that saved it.
const BOT_ID = config.discord.clientId;

const sessionSnapshotSchema = new mongoose.Schema({
  botId: {
    type: String,
    required: true,
    default: () => BOT_ID
  },
  guildId: {
    type: String,
    required: true
  },
  voiceChannelId: {
    type: String,
    required: true
  },
  channelName: {
    type: String,
    default: 'Unknown'
  },
  ownerId: {
    type: String,
    default: null
  },
  reciterName: {
    type: String,
    default: null
  },
  reciterObjId: {
    type: Number,
    default: null
  },
  surahNumber: {
    type: Number,
    default: 1
  },
  fullQuran: {
    type: Boolean,
    default: false
  },
  loop: {
    type: Boolean,
    default: false
  },
  language: {
    type: String,
    default: 'en'
  },
  riwaya: {
    type: String,
    default: null
  },
  // Where in the recording playback had got, and which recording — so a restart continues from the same second instead of the start.
  positionMs: { type: Number, default: 0 },
  url:        { type: String, default: null },
  // The control panel's message, so a restart keeps the panel alive (and deletable) instead of orphaning it.
  panelChannelId: { type: String, default: null },
  panelMessageId: { type: String, default: null },
  savedAt: {
    type: Date,
    default: Date.now
  }
});

// ── Save a snapshot of an active session ──────────────────────────────────────
sessionSnapshotSchema.index({ botId: 1, guildId: 1 }, { unique: true });

sessionSnapshotSchema.statics.save = async function (session) {
  if (!session?.current) return;
  return this.findOneAndUpdate(
    { botId: BOT_ID, guildId: session.guildId },
    {
      voiceChannelId: session.voiceChannelId,
      channelName:    session.channelName,
      ownerId:        session.ownerId,
      reciterName:    session.current.reciter,
      reciterObjId:   session.current.reciterObj?.id ?? null,
      surahNumber:    session.current.surah.number,
      fullQuran:      session.fullQuran,
      loop:           session.loop,
      language:       session.language,
      riwaya:         session.current.riwaya ?? null,
      positionMs:     getPositionMs(session),
      url:            session.current.url ?? null,
      panelChannelId: session.panelMessage?.channelId ?? null,
      panelMessageId: session.panelMessage?.messageId ?? null,
      savedAt:        new Date()
    },
    { upsert: true, new: true }
  );
};

// ── Delete snapshot after recovery or stop ────────────────────────────────────
sessionSnapshotSchema.statics.remove = async function (guildId) {
  return this.deleteOne({ botId: BOT_ID, guildId });
};

// ── Fetch all snapshots for recovery on startup ───────────────────────────────
sessionSnapshotSchema.statics.getAll = async function () {
  return this.find({ botId: BOT_ID }).lean();
};

export const SessionSnapshot = mongoose.model('SessionSnapshot', sessionSnapshotSchema);
