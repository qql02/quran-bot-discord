/**
 * Parses the mp3quran `surah_list` field ("1,2,5-8 112") into surah numbers.
 * Only real surah numbers (1..114) are kept — a bogus range like "1-999999999" can't blow up memory.
 */
export function parseSurahList(surahList) {
  if (!surahList) return [];
  const normalized = String(surahList).replace(/,/g, ' ');
  const parts = normalized.split(/\s+/).filter(Boolean);
  const nums = [];
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
        for (let i = start; i <= Math.min(end, 114); i++) nums.push(i);   // only 114 surahs exist
      }
    } else {
      const n = Number(part);
      if (!isNaN(n) && n > 0 && n <= 114) nums.push(n);
    }
  }
  return nums;
}
