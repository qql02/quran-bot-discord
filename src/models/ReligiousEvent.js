import mongoose from 'mongoose';

/**
 * A religious event a server admin schedules by hand (e.g. a Ramadan activity): posted to a channel at a fixed
 * local time, once or every day between startDate and endDate (inclusive).
 * `lastDate` is the guild-local date of the last post — the scheduler claims a date atomically by setting it.
 */
const eventSchema = new mongoose.Schema({
  guildId:     { type: String, required: true, index: true },
  title:       { type: String, required: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 1000 },
  channelId:   { type: String, required: true },
  roleId:      { type: String, default: null },
  time:        { type: String, required: true },          // HH:MM, guild-local
  timezone:    { type: String, required: true },
  startDate:   { type: String, required: true },          // YYYY-MM-DD
  endDate:     { type: String, required: true },          // YYYY-MM-DD (== startDate for a one-off event)
  enabled:     { type: Boolean, default: true },
  lastDate:    { type: String, default: null },
  createdBy:   { type: String, default: null },
  createdAt:   { type: Date, default: Date.now }
});

eventSchema.index({ enabled: 1, endDate: 1 });

export const ReligiousEvent = mongoose.model('ReligiousEvent', eventSchema);
