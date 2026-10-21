// Module hooks used ONLY by tests:
//   • discord.js                       → tiny stub (permission flags + chainable EmbedBuilder)
//   • ensureSession.js's session mgr   → controllable fake
//   • sessionManager.js's dependencies → fakes for the voice player, models, logger and Quran API
// Everything else (config, urlSafety, arabic, surahs, i18n, permissions, sessionManager itself…) is the real code.
const stub = (name) => new URL(`./stubs/${name}`, import.meta.url).href;

const SESSION_MANAGER_DEPS = [
  ['services/audioService.js',  'audioService.mjs'],
  ['utils/logger.js',           'logger.mjs'],
  ['models/Statistics.js',      'models.mjs'],
  ['models/SessionSnapshot.js', 'models.mjs'],
  ['services/quranService.js',  'quranService.mjs'],
  ['services/controlService.js', 'controlService.mjs'],
];

export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? '';

  // quranService.js under test: fake HTTP (axios) and fake models; its own logic is the real code.
  if (parent.endsWith('services/quranService.js')) {
    if (specifier === 'axios') return { url: stub('axios.mjs'), shortCircuit: true };
    if (specifier.endsWith('models/GuildSettings.js')) return { url: stub('guildSettings.mjs'), shortCircuit: true };
    if (specifier.endsWith('models/Favorites.js'))     return { url: stub('favorites.mjs'),     shortCircuit: true };
    if (specifier.endsWith('utils/logger.js'))         return { url: stub('logger.mjs'),        shortCircuit: true };
  }
  // extraReciters.js (the second reciter source): fake HTTP too, so no test ever touches the network.
  if (parent.endsWith('services/extraReciters.js') && specifier === 'axios') return { url: stub('axios.mjs'), shortCircuit: true };
  // panelRegistry.js (the one-panel-per-server logic): language lookup without a database.
  if (parent.endsWith('utils/panelRegistry.js') && specifier.endsWith('models/GuildSettings.js')) {
    return { url: stub('guildSettings.mjs'), shortCircuit: true };
  }
  if (specifier.endsWith('errorReporter.js') && parent.endsWith('utils/ensureSession.js')) {
    return { url: stub('errorReporter.mjs'), shortCircuit: true };
  }
  if (specifier === 'discord.js') return { url: stub('discord.mjs'), shortCircuit: true };

  if (specifier.endsWith('managers/sessionManager.js') && parent.endsWith('utils/ensureSession.js')) {
    return { url: stub('sessionManager.mjs'), shortCircuit: true };
  }
  if (parent.endsWith('managers/sessionManager.js')) {
    for (const [suffix, file] of SESSION_MANAGER_DEPS) {
      if (specifier.endsWith(suffix)) return { url: stub(file), shortCircuit: true };
    }
  }
  return next(specifier, context);
}
