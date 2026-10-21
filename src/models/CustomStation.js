import mongoose from 'mongoose';

/**
 * A user-added radio station.
 *  scope 'guild'  → private to ONE server (guildId set), managed by that server's managers
 *  scope 'global' → visible in every server (guildId null), managed only by the bot owner (ADMIN_IDS)
 * The two groups never mix: every query filters by scope + guildId.
 */
const customStationSchema = new mongoose.Schema({
  scope:     { type: String, enum: ['guild', 'global'], required: true, index: true },
  guildId:   { type: String, default: null, index: true },
  name:      { type: String, required: true, maxlength: 60 },
  url:       { type: String, required: true, maxlength: 500 },
  addedBy:   { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

customStationSchema.index({ scope: 1, guildId: 1, url: 1 }, { unique: true });

export const CustomStation = mongoose.model('CustomStation', customStationSchema);
