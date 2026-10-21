import mongoose from 'mongoose';

// An owner-dashboard action on a session of the voice-only bot (pause, skip, volume, stop…), written by the main bot's API and
// executed by the voice-only bot (services/playerJobs.js). Very short-lived: a command nobody ran within 20 seconds is dropped.
const SNOWFLAKE = /^\d{17,20}$/;

const workerCommandSchema = new mongoose.Schema({
  targetBotId: { type: String, required: true, match: SNOWFLAKE },
  guildId:     { type: String, required: true, match: SNOWFLAKE },
  action:      { type: String, required: true, enum: ['pause', 'resume', 'skip', 'loop', 'volume', 'stop', 'export'] },
  value:       { type: Number, min: 0, max: 150, default: null },
  by:          { type: String, maxlength: 40, default: '' },          // the dashboard user (for the log)
  status:      { type: String, enum: ['pending', 'claimed', 'done', 'failed', 'cancelled'], default: 'pending' },
  error:       { type: String, maxlength: 60, default: null },        // short reason code
  loop:        { type: Boolean, default: null },                       // result of 'loop'
  result:      { type: mongoose.Schema.Types.Mixed, default: null },   // result of 'export': the session's state (services/transferState.js)
  createdAt:   { type: Date, default: Date.now },
  finishedAt:  { type: Date, default: null }
}, { versionKey: false, strict: true });

workerCommandSchema.index({ targetBotId: 1, status: 1, createdAt: 1 });
workerCommandSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

export const WorkerCommand = mongoose.model('WorkerCommand', workerCommandSchema);
