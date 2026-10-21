import mongoose from 'mongoose';

// One row per /pull attempt (outcome only — no member names, no content). Read by the owner dashboard (Fleet page).
// Expires after 30 days.
const schema = new mongoose.Schema({
  guildId:   { type: String, required: true, index: true },
  userId:    { type: String, default: null },
  ok:        { type: Boolean, required: true },
  kind:      { type: String, enum: ['move', 'clone', null], default: null },
  key:       { type: String, default: null, maxlength: 60 },     // failure: the locale key (errors.*)
  botId:     { type: String, default: null },                     // the bot that ended up in the member's room
  fromBotId: { type: String, default: null },
  ms:        { type: Number, default: null },                     // how long the pull took
  at:        { type: Date, default: Date.now }
}, { versionKey: false });
schema.index({ at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const PullLog = mongoose.models.PullLog || mongoose.model('PullLog', schema);
