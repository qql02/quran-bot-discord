/**
 * Search-friendly normalisation for Arabic + English names.
 *  - strips tashkeel / tatweel / Quranic marks        (الرَّحْمَن → الرحمن)
 *  - unifies alef/yaa/taa-marbuta/hamza variants      (أ إ آ → ا ، ى → ي ، ة → ه)
 *  - Arabic-Indic digits → Latin                      (٢ → 2)
 *  - hyphens/apostrophes → space, lower-case          (Al-Baqarah → al baqarah)
 */
export function normalizeText(input) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[-_'’`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const hasArabic = (s) => /[\u0600-\u06FF]/.test(String(s ?? ''));
