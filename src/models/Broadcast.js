import mongoose from 'mongoose';

// Every announcement sent from the dashboard (immediately or scheduled). Survives restarts; the dashboard's history
// and the scheduler both read from here. Entries expire after a year.
const schema = new mongoose.Schema({
  title:   { type: String, default: '', maxlength: 256 },
  message: { type: String, required: true, maxlength: 4000 },
  type:    { type: String, enum: ['info', 'success', 'warning', 'maintenance'], default: 'info' },
  target:  { type: String, enum: ['all', 'ids'], default: 'all' },
  guildIds: { type: [String], default: [] },                      // only when target === 'ids'
  runAt:   { type: Date, default: null, index: true },            // null = sent immediately
  status:  { type: String, enum: ['scheduled', 'running', 'done', 'cancelled', 'missed', 'failed'], default: 'done', index: true },
  result:  { sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 }, skipped: { type: Number, default: 0 } },
  createdBy: { type: String, default: '', maxlength: 100 },
  createdAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: null },
});
schema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

export const Broadcast = mongoose.models.Broadcast || mongoose.model('Broadcast', schema);
