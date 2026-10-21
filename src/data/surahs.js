// All 114 Surahs of the Holy Quran
// Fields: number, arabic, english, ayahs, type ('meccan'|'medinan'), page (first page in Mushaf)
export const SURAHS = [
  { number: 1,   arabic: "الفاتحة",      english: "Al-Fatihah",       ayahs: 7,   type: "meccan",  page: 1   },
  { number: 2,   arabic: "البقرة",       english: "Al-Baqarah",       ayahs: 286, type: "medinan", page: 2   },
  { number: 3,   arabic: "آل عمران",     english: "Aal-E-Imran",      ayahs: 200, type: "medinan", page: 50  },
  { number: 4,   arabic: "النساء",       english: "An-Nisa",          ayahs: 176, type: "medinan", page: 77  },
  { number: 5,   arabic: "المائدة",      english: "Al-Maidah",        ayahs: 120, type: "medinan", page: 106 },
  { number: 6,   arabic: "الأنعام",      english: "Al-Anam",          ayahs: 165, type: "meccan",  page: 128 },
  { number: 7,   arabic: "الأعراف",      english: "Al-Araf",          ayahs: 206, type: "meccan",  page: 151 },
  { number: 8,   arabic: "الأنفال",      english: "Al-Anfal",         ayahs: 75,  type: "medinan", page: 177 },
  { number: 9,   arabic: "التوبة",       english: "At-Tawbah",        ayahs: 129, type: "medinan", page: 187 },
  { number: 10,  arabic: "يونس",         english: "Yunus",            ayahs: 109, type: "meccan",  page: 208 },
  { number: 11,  arabic: "هود",          english: "Hud",              ayahs: 123, type: "meccan",  page: 221 },
  { number: 12,  arabic: "يوسف",         english: "Yusuf",            ayahs: 111, type: "meccan",  page: 235 },
  { number: 13,  arabic: "الرعد",        english: "Ar-Rad",           ayahs: 43,  type: "medinan", page: 249 },
  { number: 14,  arabic: "إبراهيم",      english: "Ibrahim",          ayahs: 52,  type: "meccan",  page: 255 },
  { number: 15,  arabic: "الحجر",        english: "Al-Hijr",          ayahs: 99,  type: "meccan",  page: 262 },
  { number: 16,  arabic: "النحل",        english: "An-Nahl",          ayahs: 128, type: "meccan",  page: 267 },
  { number: 17,  arabic: "الإسراء",      english: "Al-Isra",          ayahs: 111, type: "meccan",  page: 282 },
  { number: 18,  arabic: "الكهف",        english: "Al-Kahf",          ayahs: 110, type: "meccan",  page: 293 },
  { number: 19,  arabic: "مريم",         english: "Maryam",           ayahs: 98,  type: "meccan",  page: 305 },
  { number: 20,  arabic: "طه",           english: "Ta-Ha",            ayahs: 135, type: "meccan",  page: 312 },
  { number: 21,  arabic: "الأنبياء",     english: "Al-Anbiya",        ayahs: 112, type: "meccan",  page: 322 },
  { number: 22,  arabic: "الحج",         english: "Al-Hajj",          ayahs: 78,  type: "medinan", page: 332 },
  { number: 23,  arabic: "المؤمنون",     english: "Al-Muminun",       ayahs: 118, type: "meccan",  page: 342 },
  { number: 24,  arabic: "النور",        english: "An-Nur",           ayahs: 64,  type: "medinan", page: 350 },
  { number: 25,  arabic: "الفرقان",      english: "Al-Furqan",        ayahs: 77,  type: "meccan",  page: 359 },
  { number: 26,  arabic: "الشعراء",      english: "Ash-Shuara",       ayahs: 227, type: "meccan",  page: 367 },
  { number: 27,  arabic: "النمل",        english: "An-Naml",          ayahs: 93,  type: "meccan",  page: 377 },
  { number: 28,  arabic: "القصص",        english: "Al-Qasas",         ayahs: 88,  type: "meccan",  page: 385 },
  { number: 29,  arabic: "العنكبوت",     english: "Al-Ankabut",       ayahs: 69,  type: "meccan",  page: 396 },
  { number: 30,  arabic: "الروم",        english: "Ar-Rum",           ayahs: 60,  type: "meccan",  page: 404 },
  { number: 31,  arabic: "لقمان",        english: "Luqman",           ayahs: 34,  type: "meccan",  page: 411 },
  { number: 32,  arabic: "السجدة",       english: "As-Sajdah",        ayahs: 30,  type: "meccan",  page: 415 },
  { number: 33,  arabic: "الأحزاب",      english: "Al-Ahzab",         ayahs: 73,  type: "medinan", page: 418 },
  { number: 34,  arabic: "سبأ",          english: "Saba",             ayahs: 54,  type: "meccan",  page: 428 },
  { number: 35,  arabic: "فاطر",         english: "Fatir",            ayahs: 45,  type: "meccan",  page: 434 },
  { number: 36,  arabic: "يس",           english: "Ya-Sin",           ayahs: 83,  type: "meccan",  page: 440 },
  { number: 37,  arabic: "الصافات",      english: "As-Saffat",        ayahs: 182, type: "meccan",  page: 446 },
  { number: 38,  arabic: "ص",            english: "Sad",              ayahs: 88,  type: "meccan",  page: 453 },
  { number: 39,  arabic: "الزمر",        english: "Az-Zumar",         ayahs: 75,  type: "meccan",  page: 458 },
  { number: 40,  arabic: "غافر",         english: "Ghafir",           ayahs: 85,  type: "meccan",  page: 467 },
  { number: 41,  arabic: "فصلت",         english: "Fussilat",         ayahs: 54,  type: "meccan",  page: 477 },
  { number: 42,  arabic: "الشورى",       english: "Ash-Shura",        ayahs: 53,  type: "meccan",  page: 483 },
  { number: 43,  arabic: "الزخرف",       english: "Az-Zukhruf",       ayahs: 89,  type: "meccan",  page: 489 },
  { number: 44,  arabic: "الدخان",       english: "Ad-Dukhan",        ayahs: 59,  type: "meccan",  page: 496 },
  { number: 45,  arabic: "الجاثية",      english: "Al-Jathiyah",      ayahs: 37,  type: "meccan",  page: 499 },
  { number: 46,  arabic: "الأحقاف",      english: "Al-Ahqaf",         ayahs: 35,  type: "meccan",  page: 502 },
  { number: 47,  arabic: "محمد",         english: "Muhammad",         ayahs: 38,  type: "medinan", page: 507 },
  { number: 48,  arabic: "الفتح",        english: "Al-Fath",          ayahs: 29,  type: "medinan", page: 511 },
  { number: 49,  arabic: "الحجرات",      english: "Al-Hujurat",       ayahs: 18,  type: "medinan", page: 515 },
  { number: 50,  arabic: "ق",            english: "Qaf",              ayahs: 45,  type: "meccan",  page: 518 },
  { number: 51,  arabic: "الذاريات",     english: "Adh-Dhariyat",     ayahs: 60,  type: "meccan",  page: 520 },
  { number: 52,  arabic: "الطور",        english: "At-Tur",           ayahs: 49,  type: "meccan",  page: 523 },
  { number: 53,  arabic: "النجم",        english: "An-Najm",          ayahs: 62,  type: "meccan",  page: 526 },
  { number: 54,  arabic: "القمر",        english: "Al-Qamar",         ayahs: 55,  type: "meccan",  page: 528 },
  { number: 55,  arabic: "الرحمن",       english: "Ar-Rahman",        ayahs: 78,  type: "medinan", page: 531 },
  { number: 56,  arabic: "الواقعة",      english: "Al-Waqiah",        ayahs: 96,  type: "meccan",  page: 534 },
  { number: 57,  arabic: "الحديد",       english: "Al-Hadid",         ayahs: 29,  type: "medinan", page: 537 },
  { number: 58,  arabic: "المجادلة",     english: "Al-Mujadila",      ayahs: 22,  type: "medinan", page: 542 },
  { number: 59,  arabic: "الحشر",        english: "Al-Hashr",         ayahs: 24,  type: "medinan", page: 545 },
  { number: 60,  arabic: "الممتحنة",     english: "Al-Mumtahanah",    ayahs: 13,  type: "medinan", page: 549 },
  { number: 61,  arabic: "الصف",         english: "As-Saf",           ayahs: 14,  type: "medinan", page: 551 },
  { number: 62,  arabic: "الجمعة",       english: "Al-Jumuah",        ayahs: 11,  type: "medinan", page: 553 },
  { number: 63,  arabic: "المنافقون",    english: "Al-Munafiqun",     ayahs: 11,  type: "medinan", page: 554 },
  { number: 64,  arabic: "التغابن",      english: "At-Taghabun",      ayahs: 18,  type: "medinan", page: 556 },
  { number: 65,  arabic: "الطلاق",       english: "At-Talaq",         ayahs: 12,  type: "medinan", page: 558 },
  { number: 66,  arabic: "التحريم",      english: "At-Tahrim",        ayahs: 12,  type: "medinan", page: 560 },
  { number: 67,  arabic: "الملك",        english: "Al-Mulk",          ayahs: 30,  type: "meccan",  page: 562 },
  { number: 68,  arabic: "القلم",        english: "Al-Qalam",         ayahs: 52,  type: "meccan",  page: 564 },
  { number: 69,  arabic: "الحاقة",       english: "Al-Haqqah",        ayahs: 52,  type: "meccan",  page: 566 },
  { number: 70,  arabic: "المعارج",      english: "Al-Maarij",        ayahs: 44,  type: "meccan",  page: 568 },
  { number: 71,  arabic: "نوح",          english: "Nuh",              ayahs: 28,  type: "meccan",  page: 570 },
  { number: 72,  arabic: "الجن",         english: "Al-Jinn",          ayahs: 28,  type: "meccan",  page: 572 },
  { number: 73,  arabic: "المزمل",       english: "Al-Muzzammil",     ayahs: 20,  type: "meccan",  page: 574 },
  { number: 74,  arabic: "المدثر",       english: "Al-Muddaththir",   ayahs: 56,  type: "meccan",  page: 575 },
  { number: 75,  arabic: "القيامة",      english: "Al-Qiyamah",       ayahs: 40,  type: "meccan",  page: 577 },
  { number: 76,  arabic: "الإنسان",      english: "Al-Insan",         ayahs: 31,  type: "medinan", page: 578 },
  { number: 77,  arabic: "المرسلات",     english: "Al-Mursalat",      ayahs: 50,  type: "meccan",  page: 580 },
  { number: 78,  arabic: "النبأ",        english: "An-Naba",          ayahs: 40,  type: "meccan",  page: 582 },
  { number: 79,  arabic: "النازعات",     english: "An-Naziat",        ayahs: 46,  type: "meccan",  page: 583 },
  { number: 80,  arabic: "عبس",          english: "Abasa",            ayahs: 42,  type: "meccan",  page: 585 },
  { number: 81,  arabic: "التكوير",      english: "At-Takwir",        ayahs: 29,  type: "meccan",  page: 586 },
  { number: 82,  arabic: "الانفطار",     english: "Al-Infitar",       ayahs: 19,  type: "meccan",  page: 587 },
  { number: 83,  arabic: "المطففين",     english: "Al-Mutaffifin",    ayahs: 36,  type: "meccan",  page: 587 },
  { number: 84,  arabic: "الانشقاق",     english: "Al-Inshiqaq",      ayahs: 25,  type: "meccan",  page: 589 },
  { number: 85,  arabic: "البروج",       english: "Al-Buruj",         ayahs: 22,  type: "meccan",  page: 590 },
  { number: 86,  arabic: "الطارق",       english: "At-Tariq",         ayahs: 17,  type: "meccan",  page: 591 },
  { number: 87,  arabic: "الأعلى",       english: "Al-Ala",           ayahs: 19,  type: "meccan",  page: 591 },
  { number: 88,  arabic: "الغاشية",      english: "Al-Ghashiyah",     ayahs: 26,  type: "meccan",  page: 592 },
  { number: 89,  arabic: "الفجر",        english: "Al-Fajr",          ayahs: 30,  type: "meccan",  page: 593 },
  { number: 90,  arabic: "البلد",        english: "Al-Balad",         ayahs: 20,  type: "meccan",  page: 594 },
  { number: 91,  arabic: "الشمس",        english: "Ash-Shams",        ayahs: 15,  type: "meccan",  page: 595 },
  { number: 92,  arabic: "الليل",        english: "Al-Layl",          ayahs: 21,  type: "meccan",  page: 595 },
  { number: 93,  arabic: "الضحى",        english: "Ad-Duha",          ayahs: 11,  type: "meccan",  page: 596 },
  { number: 94,  arabic: "الشرح",        english: "Ash-Sharh",        ayahs: 8,   type: "meccan",  page: 596 },
  { number: 95,  arabic: "التين",        english: "At-Tin",           ayahs: 8,   type: "meccan",  page: 597 },
  { number: 96,  arabic: "العلق",        english: "Al-Alaq",          ayahs: 19,  type: "meccan",  page: 597 },
  { number: 97,  arabic: "القدر",        english: "Al-Qadr",          ayahs: 5,   type: "meccan",  page: 598 },
  { number: 98,  arabic: "البينة",       english: "Al-Bayyinah",      ayahs: 8,   type: "medinan", page: 598 },
  { number: 99,  arabic: "الزلزلة",      english: "Az-Zalzalah",      ayahs: 8,   type: "medinan", page: 599 },
  { number: 100, arabic: "العاديات",     english: "Al-Adiyat",        ayahs: 11,  type: "meccan",  page: 599 },
  { number: 101, arabic: "القارعة",      english: "Al-Qariah",        ayahs: 11,  type: "meccan",  page: 600 },
  { number: 102, arabic: "التكاثر",      english: "At-Takathur",      ayahs: 8,   type: "meccan",  page: 600 },
  { number: 103, arabic: "العصر",        english: "Al-Asr",           ayahs: 3,   type: "meccan",  page: 601 },
  { number: 104, arabic: "الهمزة",       english: "Al-Humazah",       ayahs: 9,   type: "meccan",  page: 601 },
  { number: 105, arabic: "الفيل",        english: "Al-Fil",           ayahs: 5,   type: "meccan",  page: 601 },
  { number: 106, arabic: "قريش",         english: "Quraysh",          ayahs: 4,   type: "meccan",  page: 602 },
  { number: 107, arabic: "الماعون",      english: "Al-Maun",          ayahs: 7,   type: "meccan",  page: 602 },
  { number: 108, arabic: "الكوثر",       english: "Al-Kawthar",       ayahs: 3,   type: "meccan",  page: 602 },
  { number: 109, arabic: "الكافرون",     english: "Al-Kafirun",       ayahs: 6,   type: "meccan",  page: 603 },
  { number: 110, arabic: "النصر",        english: "An-Nasr",          ayahs: 3,   type: "medinan", page: 603 },
  { number: 111, arabic: "المسد",        english: "Al-Masad",         ayahs: 5,   type: "meccan",  page: 603 },
  { number: 112, arabic: "الإخلاص",      english: "Al-Ikhlas",        ayahs: 4,   type: "meccan",  page: 604 },
  { number: 113, arabic: "الفلق",        english: "Al-Falaq",         ayahs: 5,   type: "meccan",  page: 604 },
  { number: 114, arabic: "الناس",        english: "An-Nas",           ayahs: 6,   type: "meccan",  page: 604 }
];

export function getSurahByNumber(number) {
  return SURAHS.find(s => s.number === number) || null;
}

import { normalizeText } from '../utils/arabic.js';

// Pre-normalised search keys (built once; SURAHS objects are left untouched).
const KEYS = SURAHS.map(s => ({ s, ar: normalizeText(s.arabic), en: normalizeText(s.english), num: String(s.number) }));

// Shown first when the user hasn't typed anything yet: most-requested surahs.
const POPULAR = [1, 18, 36, 55, 56, 67, 112, 113, 114, 2, 19, 32, 78];

export function getSurahByName(query, _lang = 'en') {
  const q = normalizeText(query);
  if (!q) return null;
  return (
    KEYS.find(k => k.num === q || k.ar === q || k.en === q) ||
    KEYS.find(k => k.ar.startsWith(q) || k.en.startsWith(q)) ||
    KEYS.find(k => k.ar.includes(q) || k.en.includes(q))
  )?.s ?? null;
}

export function searchSurahs(query, _lang = 'en') {
  const q = normalizeText(query);
  if (!q) {
    const first = POPULAR.map(n => SURAHS[n - 1]);
    const rest  = SURAHS.filter(s => !POPULAR.includes(s.number));
    return [...first, ...rest].slice(0, 25);
  }
  const score = k =>
    k.num === q || k.ar === q || k.en === q ? 0 :
    k.num.startsWith(q) || k.ar.startsWith(q) || k.en.startsWith(q) ? 1 :
    k.ar.includes(q) || k.en.includes(q) ? 2 : 9;
  return KEYS
    .map(k => ({ k, sc: score(k) }))
    .filter(x => x.sc < 9)
    .sort((x, y) => x.sc - y.sc || x.k.s.number - y.k.s.number)
    .slice(0, 25)
    .map(x => x.k.s);
}

/** Label for autocomplete: both languages so everyone recognises the surah. */
export function surahLabel(s, lang = 'en') {
  const [first, second] = lang === 'ar' ? [s.arabic, s.english] : [s.english, s.arabic];
  return `${s.number}. ${first} · ${second}`;
}

export function getRandomSurah() {
  return SURAHS[Math.floor(Math.random() * SURAHS.length)];
}

/** Returns all meccan surahs */
export function getMeccanSurahs() {
  return SURAHS.filter(s => s.type === 'meccan');
}

/** Returns all medinan surahs */
export function getMedinanSurahs() {
  return SURAHS.filter(s => s.type === 'medinan');
}
