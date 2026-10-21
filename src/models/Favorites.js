import mongoose from 'mongoose';

const favoritesSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  guildId: {
    type: String,
    required: true,
    index: true
  },
  reciters: {
    type: [String],
    default: []
  },
  surahs: {
    type: [Number],
    default: []
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

favoritesSchema.index({ userId: 1, guildId: 1 }, { unique: true });

// ── Add reciter to favorites ──────────────────────────────────────────────────
favoritesSchema.statics.addReciter = async function (userId, guildId, reciterName) {
  return this.findOneAndUpdate(
    { userId, guildId },
    {
      $addToSet: { reciters: reciterName },
      $set: { updatedAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

// ── Remove reciter from favorites ─────────────────────────────────────────────
favoritesSchema.statics.removeReciter = async function (userId, guildId, reciterName) {
  return this.findOneAndUpdate(
    { userId, guildId },
    {
      $pull: { reciters: reciterName },
      $set: { updatedAt: new Date() }
    },
    { new: true }
  );
};

// ── Add surah to favorites ────────────────────────────────────────────────────
favoritesSchema.statics.addSurah = async function (userId, guildId, surahNumber) {
  return this.findOneAndUpdate(
    { userId, guildId },
    {
      $addToSet: { surahs: surahNumber },
      $set: { updatedAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

// ── Remove surah from favorites ───────────────────────────────────────────────
favoritesSchema.statics.removeSurah = async function (userId, guildId, surahNumber) {
  return this.findOneAndUpdate(
    { userId, guildId },
    {
      $pull: { surahs: surahNumber },
      $set: { updatedAt: new Date() }
    },
    { new: true }
  );
};

// ── Get user favorites ────────────────────────────────────────────────────────
favoritesSchema.statics.getOrCreate = async function (userId, guildId) {
  let fav = await this.findOne({ userId, guildId }).lean();
  if (!fav) {
    fav = await this.create({ userId, guildId });
    fav = fav.toObject();
  }
  return fav;
};

// ── Read-only lookup (autocomplete runs on every keystroke → must not create documents) ──
favoritesSchema.statics.peek = async function (userId, guildId) {
  return this.findOne({ userId, guildId }).lean();
};

export const Favorites = mongoose.model('Favorites', favoritesSchema);
