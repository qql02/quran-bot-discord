import mongoose from 'mongoose';

const statisticsSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  totalPlayedSurahs: {
    type: Number,
    default: 0
  },
  totalPlayTime: {
    type: Number,  // stored in seconds
    default: 0
  },
  totalSessions: {
    type: Number,
    default: 0
  },
  reciterPlayCounts: {
    type: Map,
    of: Number,
    default: {}
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

statisticsSchema.statics.increment = async function (guildId, fields) {
  const update = { $inc: fields, $set: { updatedAt: new Date() } };
  return this.findOneAndUpdate(
    { guildId },
    update,
    { upsert: true, new: true }
  );
};

statisticsSchema.statics.addPlayTime = async function (guildId, seconds) {
  return this.findOneAndUpdate(
    { guildId },
    { $inc: { totalPlayTime: seconds }, $set: { updatedAt: new Date() } },
    { upsert: true, new: true }
  );
};

statisticsSchema.statics.recordReciter = async function (guildId, reciterName) {
  // FIX: MongoDB treats dots in field names as nested path separators.
  // Reciter names like "Dr. Ahmad Al-Ajmi" contain dots → $inc would fail or corrupt data.
  // Replace dots with a safe Unicode substitute (U+FF0E FULLWIDTH FULL STOP) for storage.
  const safeKey = String(reciterName).slice(0, 120).replace(/\./g, '\uFF0E').replace(/^\$/, '\uFF04');
  return this.findOneAndUpdate(
    { guildId },
    {
      $inc: { [`reciterPlayCounts.${safeKey}`]: 1 },
      $set: { updatedAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

statisticsSchema.statics.getTopReciter = function (stats) {
  if (!stats?.reciterPlayCounts) return null;
  // .lean() returns a plain object, not a Map - use Object.entries to iterate safely
  const entries = stats.reciterPlayCounts instanceof Map
    ? [...stats.reciterPlayCounts.entries()]
    : Object.entries(stats.reciterPlayCounts);
  let top = null;
  let max = 0;
  for (const [name, count] of entries) {
    if (count > max) { max = count; top = name; }
  }
  // Restore dots replaced during recordReciter (U+FF0E → '.')
  return top ? top.replace(/\uFF0E/g, '.') : null;
};

export const Statistics = mongoose.model('Statistics', statisticsSchema);
