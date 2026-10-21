import mongoose from 'mongoose';

// Persistent dashboard activity log (admin actions, joins/leaves, bans…). Survives restarts.
// Entries expire automatically after 30 days (TTL index).
const schema = new mongoose.Schema({
  type:   { type: String, required: true, maxlength: 16 },
  action: { type: String, required: true, maxlength: 300 },
  meta:   { type: String, default: '', maxlength: 500 },
  actor:  { type: String, default: '', maxlength: 100 },
  ts:     { type: Date, default: Date.now },   // indexed once, below, as the 30-day TTL index
});
schema.index({ ts: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const ActivityLog = mongoose.models.ActivityLog || mongoose.model('ActivityLog', schema);
