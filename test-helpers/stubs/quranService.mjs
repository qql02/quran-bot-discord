export const getPlayableUrls = async (r, n) => (globalThis.__urls ? globalThis.__urls(r, n) : []);
