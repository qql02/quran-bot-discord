import mongoose from 'mongoose';

// A request from the PRIMARY bot (which owns the slash commands) to the voice-only SECONDARY bot: "join this room and recite".
// The secondary has no commands of its own; it polls this collection (services/playerJobs.js) and answers by updating `status`.
// Short-lived on purpose: a job nobody picked up within a minute is useless (the member has moved on) and is never run late.
const SNOWFLAKE = /^\d{17,20}$/;
const id = { type: String, match: SNOWFLAKE };

const intentSchema = new mongoose.Schema({
  kind:      { type: String, enum: ['join', 'recite', 'live', 'move', 'resume'], default: 'join' },
  surah:     { type: Number, min: 1, max: 114, default: null },   // recite: null = the whole Quran
  reciter:   { type: String, maxlength: 120, default: null },     // recite: reciter name
  reciterId: { type: String, maxlength: 20, default: null },      // recite: API id, preferred over the name
  station:   { type: String, maxlength: 300, default: null },     // live: the /live option value
  requireEmpty: { type: Boolean, default: false },                // move: refuse if somebody else is in the old room by the time it runs
  state:     { type: mongoose.Schema.Types.Mixed, default: null }  // resume: what to continue (surah, position, queue, modes — see services/transferState.js)
}, { _id: false });

const errorSchema = new mongoose.Schema({
  key:  { type: String, maxlength: 60 },          // a locale key under errors.*
  vars: { type: Map, of: String },
  code: { type: String, maxlength: 20 }           // E-XXXXXX for an unexpected error (the details are in the secondary's log)
}, { _id: false });

const playerJobSchema = new mongoose.Schema({
  targetBotId:    { ...id, required: true },     // which bot must execute it
  fromBotId:      { ...id },
  guildId:        { ...id, required: true },
  voiceChannelId: { ...id, required: true },     // the room the member is in
  textChannelId:  { ...id, default: null },      // where the panel goes when the voice channel has no chat the bot may write in
  userId:         { ...id, required: true },     // the member who asked — must really be in that room when the job runs
  lang:           { type: String, enum: ['ar', 'en'], default: 'ar' },
  intent:         { type: intentSchema, default: () => ({ kind: 'join' }) },
  status:         { type: String, enum: ['pending', 'claimed', 'done', 'failed', 'cancelled'], default: 'pending' },
  error:          { type: errorSchema, default: null },
  panel:          { type: Boolean, default: true },   // false = the bot joined but could not post its control panel
  createdAt:      { type: Date, default: Date.now },
  claimedAt:      { type: Date, default: null },
  finishedAt:     { type: Date, default: null }
}, { versionKey: false, strict: true });

playerJobSchema.index({ targetBotId: 1, status: 1, createdAt: 1 });
playerJobSchema.index({ targetBotId: 1, guildId: 1, status: 1 });
playerJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });   // housekeeping

export const PlayerJob = mongoose.model('PlayerJob', playerJobSchema);
