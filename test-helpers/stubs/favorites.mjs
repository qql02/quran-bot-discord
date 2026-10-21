export const Favorites = { peek: async (userId, guildId) => globalThis.__favorites?.[`${userId}:${guildId}`] ?? null };
