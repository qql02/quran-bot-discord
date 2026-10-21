import mongoose from 'mongoose';

// One document per running bot (each token = one process). Bots sharing a database use it to know about each other:
// which servers a sibling is in, and which voice channel it is reciting in right now. Written by services/siblingService.js.
const botInstanceSchema = new mongoose.Schema({
  _id:      { type: String },                 // the bot's user ID
  tag:      { type: String, default: '' },
  role:     { type: String, default: 'primary' },
  guildIds: { type: [String], default: [] },
  sessions: {
    type: [new mongoose.Schema({
      guildId:     { type: String, required: true },
      channelId:   { type: String, required: true },
      channelName: { type: String, default: '' },
      // What the owner dashboard shows for a session of ANOTHER process (the voice-only bot): refreshed with every heartbeat
      status:      { type: String, default: 'idle' },
      surah:       { type: String, default: null },
      surahAr:     { type: String, default: null },
      reciter:     { type: String, default: null },
      queueSize:   { type: Number, default: 0 },
      loop:        { type: Boolean, default: false },
      fullQuran:   { type: Boolean, default: false },
      volume:      { type: Number, default: 100 }
    }, { _id: false })],
    default: []
  },
  lastSeen: { type: Date, default: Date.now }
}, { versionKey: false });

// Housekeeping only: a bot that has been silent for a day is gone (liveness itself is judged by lastSeen in the service).
botInstanceSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 24 * 3600 });

export const BotInstance = mongoose.model('BotInstance', botInstanceSchema);
