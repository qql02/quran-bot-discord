import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cache = {};

function loadLocale(lang) {
  if (cache[lang]) return cache[lang];
  try {
    const path = join(__dirname, '..', 'locales', `${lang}.json`);
    cache[lang] = JSON.parse(readFileSync(path, 'utf8'));
    return cache[lang];
  } catch {
    if (lang !== 'en') return loadLocale('en');
    throw new Error(`Missing locale file: ${lang}.json`);
  }
}

/**
 * Get a localized string with optional variable interpolation.
 * @param {string} lang - 'ar' | 'en'
 * @param {string} key  - dot-separated key e.g. 'commands.play.now_playing'
 * @param {object} vars - optional replacement variables e.g. { name: 'Mishary' }
 */
export function t(lang, key, vars = {}) {
  const locale = loadLocale(lang || 'en');
  const parts = key.split('.');
  let value = locale;
  for (const part of parts) {
    value = value?.[part];
    if (value === undefined) break;
  }
  if (typeof value !== 'string') {
    // Fallback to English
    if (lang !== 'en') return t('en', key, vars);
    return key;
  }
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function getSupportedLanguages() {
  return ['en', 'ar'];
}
