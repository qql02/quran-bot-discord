// Global owner controls for sessionManager tests: nothing restricted (no database needed).
export const getControlSync = () => ({ maxQueue: null, disabledCommands: [], disabledFeatures: [], locked: false, lockedUntil: null, note: '', modCaps: {}, ...(globalThis.__control ?? {}) });
export const refreshControl = async () => getControlSync();
export const saveControl = async () => getControlSync();
export const startControl = () => {};
