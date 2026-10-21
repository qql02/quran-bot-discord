import mongoose from 'mongoose';

/**
 * A member's own saved pages and verses (the DM commands "!mark" / "!save").
 * One tiny document per member, keyed ONLY by the member's id — never by a server — so nothing a server does can touch it.
 */
const schema = new mongoose.Schema({
  userId:    { type: String, required: true, unique: true },
  pages:     { type: [Number], default: [] },
  verses:    { type: [String], default: [] },
  lang:      { type: String, enum: ['ar', 'en'], default: undefined },   // the member's own reply language (!settings)
  updatedAt: { type: Date, default: Date.now }
});

export const PersonalList = mongoose.models.PersonalList ?? mongoose.model('PersonalList', schema);
