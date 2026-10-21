const asyncNoop = async () => {};
export const Statistics      = { increment: asyncNoop, addPlayTime: asyncNoop, recordPlay: asyncNoop, recordReciter: asyncNoop };
export const SessionSnapshot = { upsert: asyncNoop, remove: asyncNoop, save: asyncNoop, find: async () => [] };
