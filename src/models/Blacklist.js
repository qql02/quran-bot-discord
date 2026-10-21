import mongoose from 'mongoose';

// In-memory cache — a Set of banned guildIds for O(1) lookup
// TTL-based: refreshes every 10 minutes or on explicit invalidation
// Uses a Promise lock to prevent cache stampede (multiple concurrent DB queries)
const bannedCache = new Set();
let cacheLoadedAt = 0;
let inflightRefresh = null; // Promise lock — only one DB query at a time
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const blacklistSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    default: null
  },
  reason: {
    type: String,
    default: 'No reason provided'
  },
  bannedAt: {
    type: Date,
    default: Date.now
  }
});

blacklistSchema.statics.isBanned = async function (guildId) {
  if (Date.now() - cacheLoadedAt > CACHE_TTL) {
    // If a refresh is already running, wait for it instead of firing another query
    if (!inflightRefresh) {
      inflightRefresh = this.find({}, 'guildId').lean().then(all => {
        bannedCache.clear();
        for (const doc of all) bannedCache.add(doc.guildId);
        cacheLoadedAt = Date.now();
        inflightRefresh = null;
      }).catch(err => {
        inflightRefresh = null;
        throw err;
      });
    }
    await inflightRefresh;
  }
  return bannedCache.has(guildId);
};

blacklistSchema.statics.invalidateCache = function () {
  cacheLoadedAt = 0; // Force reload on next isBanned() call
};

export const Blacklist = mongoose.model('Blacklist', blacklistSchema);
