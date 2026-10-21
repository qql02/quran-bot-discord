// Fake session manager: tests assign globalThis.__sessions (a Map) and globalThis.__createAndJoin (a function).
export const getSession    = (guildId) => globalThis.__sessions.get(guildId);
export const createAndJoin = (...args) => globalThis.__createAndJoin(...args);
