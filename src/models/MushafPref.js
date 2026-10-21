import mongoose from 'mongoose';

/**
 * How a member likes to read the Mushaf: the text, or the picture of the page in Hafs / Warsh.
 * One tiny document per member; the reader works without it (no document = text).
 */
export const READER_VIEWS = Object.freeze(['text', 'hafs', 'warsh']);

const schema = new mongoose.Schema({
  userId:    { type: String, required: true, unique: true },
  view:      { type: String, enum: READER_VIEWS, default: 'text' },
  updatedAt: { type: Date, default: Date.now }
});

export const MushafPref = mongoose.models.MushafPref ?? mongoose.model('MushafPref', schema);
