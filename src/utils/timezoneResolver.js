/**
 * "Where do you live?" → an IANA time zone. Members type a country or a city the way they write it, in Arabic, English or
 * French, with or without accents / hamza / «ال» / a typo — so the match is tolerant instead of an exact table lookup:
 *
 *   1. an IANA name in any casing (Africa/Algiers, africa/algiers, Egypt…)
 *   2. a UTC offset (UTC+1, GMT-5, +3)
 *   3. the exact name of a country or city, after normalising both sides
 *   4. the LONGEST known name found inside what was typed («جمهورية مصر العربية», «Los Angeles USA»)
 *   5. one typo / swapped letters (only when exactly one zone is that close)
 *
 * Anything else is null, and suggestTimeZones() offers the closest names for the error message.
 * Pure functions, no storage, no network.
 */
import { COUNTRIES } from '../data/countries.js';

const valid = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const canonical = (tz) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone; } catch { return tz; } };

/**
 * Same on both sides of the comparison: lower-case, no accents / tashkeel / hamza marks, ة→ه ى→ي, punctuation → space,
 * and the Arabic article «ال» dropped from every word. "الإمارات" → "امارات", "Algérie" → "algerie".
 */
export function normalizePlace(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')                    // accents, tashkeel, and the hamza marks of أ إ آ ؤ ئ
    .toLowerCase()
    .replace(/ـ/g, '').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ی/g, 'ي').replace(/ک/g, 'ك')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .split(' ').filter(Boolean)
    .map(w => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w))
    .join(' ');
}

// ── What people also call a country ──────────────────────────────────────────────────────────────────────────────
// ISO code → extra names (the official names come from COUNTRIES). Arabizi / French / short forms / dialect spellings.
const COUNTRY_ALIASES = {
  SA: 'السعودية|المملكة السعودية|ksa|saudi|saudia|saoudite|السعوديه',
  AE: 'الامارات|الإمارات|uae|emirates|emirats|emirates arabes|الامارات العربية',
  US: 'امريكا|أمريكا|الولايات المتحدة الامريكية|usa|u s a|u s|america|united states of america|etats unis|états-unis',
  GB: 'بريطانيا|انجلترا|انكلترا|بريطانيا العظمى|uk|britain|great britain|england|scotland|wales|angleterre|royaume uni|grande bretagne',
  EG: 'misr|masr|مصر العربية',
  DZ: 'dzair|djazair|el djazair|el dzair|الجزاير|algerie|الجزائر العربية',
  MA: 'maroc|almaghrib|al maghrib|المملكة المغربية|المغرب الاقصى|marruecos',
  TN: 'tounes|tunisie|تونس الخضراء',
  LY: 'libia|libye',
  SY: 'souria|syrie|syria',
  PS: 'فلسطين|palestine|filastin|falastin|palestinian territories|territoires palestiniens|palestinian',
  IQ: 'irak|iraq|عراق',
  JO: 'urdun|jordanie|المملكة الاردنية|الاردن',
  LB: 'lubnan|liban',
  KW: 'koweit|kuwait',
  QA: 'katar',
  OM: 'sultanate of oman|سلطنة عمان|oman',
  YE: 'yemen|yémen|اليمن السعيد',
  MR: 'mauritanie|شنقيط',
  SD: 'soudan',
  KM: 'comores|جزر القمر',
  DJ: 'جيبوتي',
  SO: 'الصومال',
  TR: 'turkey|turquie|turkiye|تركيا',
  RU: 'russia|روسيا|russie',
  KR: 'korea|south korea|كوريا|كوريا الجنوبية|coree du sud',
  CZ: 'czech republic|tchequie|التشيك',
  CI: 'ivory coast|cote d ivoire|كوت ديفوار|ساحل العاج',
  NL: 'holland|hollande|هولندا',
  MM: 'burma|بورما',
  SZ: 'swaziland',
  MK: 'macedonia|مقدونيا',
  BA: 'bosnia|البوسنة',
  TL: 'east timor',
  VA: 'vatican|الفاتيكان',
  CN: 'china|chine|الصين',
  DE: 'germany|allemagne|المانيا|deutschland',
  ES: 'spain|espagne|اسبانيا|españa',
  IT: 'italy|italie|ايطاليا|italia',
  CH: 'switzerland|suisse|سويسرا',
  CA: 'canada|كندا',
  AU: 'australia|australie|استراليا',
  IN: 'india|inde|الهند',
  PK: 'pakistan|باكستان',
  BD: 'bangladesh|بنغلاديش|بنجلاديش',
  ID: 'indonesia|indonesie|اندونيسيا',
  MY: 'malaysia|malaisie|ماليزيا',
  SG: 'singapore|singapour|سنغافورة',
  PH: 'philippines|الفلبين',
  JP: 'japan|japon|اليابان',
  SE: 'sweden|suede|السويد',
  NO: 'norway|norvege|النرويج',
  BE: 'belgium|belgique|بلجيكا',
  GR: 'greece|grece|اليونان',
  SN: 'senegal|السنغال',
  NG: 'nigeria|نيجيريا',
  ZA: 'south africa|afrique du sud|جنوب افريقيا',
  ET: 'ethiopia|ethiopie|اثيوبيا',
  KE: 'kenya|كينيا'
};

// ── Cities: [zone, Arabic label, English label, aliases…] ────────────────────────────────────────────────────────
// Every city of a country shares its zone, so the long Arab-world lists are what members actually type; the big cities of
// countries with several zones (US, Canada, Australia…) are here so they can pick theirs.
const CITIES = [
  ['Africa/Algiers', 'الجزائر', 'Algeria', 'الجزائر العاصمة|alger|وهران|oran|قسنطينة|constantine|عنابة|annaba|سطيف|setif|بجاية|bejaia|bgayet|تلمسان|tlemcen|بليدة|blida|باتنة|batna|بسكرة|biskra|ورقلة|ouargla|غرداية|ghardaia|تيزي وزو|tizi ouzou|سكيكدة|skikda|مستغانم|mostaganem|بشار|bechar|الاغواط|laghouat|جيجل|jijel|سيدي بلعباس|sidi bel abbes|تبسة|tebessa|المدية|medea|تيارت|tiaret|الشلف|chlef|البويرة|bouira|بومرداس|boumerdes|تمنراست|tamanrasset|ادرار|adrar|المسيلة|msila|الجلفة|djelfa|خنشلة|khenchela|سوق اهراس|souk ahras|الطارف|el tarf|قالمة|guelma|ميلة|mila|عين الدفلى|ain defla|معسكر|mascara|سعيدة|saida|النعامة|naama|البيض|el bayadh|الوادي|el oued|عين تموشنت|ain temouchent|غليزان|relizane|تيسمسيلت|tissemsilt|تندوف|tindouf|ايليزي|illizi|برج بوعريريج|bordj bou arreridj|عين صالح|in salah|المنيعة|el meniaa'],
  ['Africa/Casablanca', 'المغرب', 'Morocco', 'الدار البيضاء|الرباط|rabat|فاس|fes|fez|مراكش|marrakech|marrakesh|طنجة|tangier|tanger|اكادير|agadir|وجدة|oujda|مكناس|meknes|تطوان|tetouan|القنيطرة|kenitra|سلا|sale|تمارة|temara|المحمدية|mohammedia|الجديدة|el jadida|بني ملال|beni mellal|الناظور|nador|خريبكة|khouribga|تازة|taza|العيون|laayoune|الحسيمة|al hoceima|الداخلة|dakhla|سطات|settat|ورزازات|ouarzazate|الصويرة|essaouira|شفشاون|chefchaouen'],
  ['Africa/Tunis', 'تونس', 'Tunisia', 'تونس العاصمة|صفاقس|sfax|سوسة|sousse|القيروان|kairouan|بنزرت|bizerte|قابس|gabes|المنستير|monastir|نابل|nabeul|قفصة|gafsa|تطاوين|tataouine|جربة|djerba|مدنين|medenine|الكاف|le kef|جندوبة|jendouba|المهدية|mahdia|توزر|tozeur|سيدي بوزيد|sidi bouzid|زغوان|zaghouan'],
  ['Africa/Tripoli', 'ليبيا', 'Libya', 'طرابلس|بنغازي|benghazi|مصراتة|misrata|سبها|sebha|طبرق|tobruk|الزاوية|zawiya|سرت|sirte|زليتن|zliten|البيضاء ليبيا|درنة|derna|اجدابيا|ajdabiya'],
  ['Africa/Cairo', 'مصر', 'Egypt', 'القاهرة|le caire|الاسكندرية|alexandria|alexandrie|الجيزة|giza|المنصورة|mansoura|اسوان|aswan|الاقصر|luxor|طنطا|tanta|بورسعيد|port said|السويس|suez|الاسماعيلية|ismailia|الزقازيق|zagazig|اسيوط|asyut|assiut|سوهاج|sohag|شرم الشيخ|sharm el sheikh|الغردقة|hurghada|دمياط|damietta|الفيوم|fayoum|بني سويف|beni suef|المنيا|minya|قنا|qena|مطروح|marsa matruh|دمنهور|damanhur|شبين الكوم|shebin el kom|العريش|arish|الاسكندريه'],
  ['Asia/Riyadh', 'السعودية', 'Saudi Arabia', 'الرياض|جدة|jeddah|jidda|مكة|مكة المكرمة|makkah|mecca|la mecque|المدينة المنورة|المدينة|medina|madinah|الدمام|dammam|الخبر|khobar|الطائف|taif|تبوك|tabuk|ابها|abha|بريدة|buraidah|حائل|hail|جازان|jazan|نجران|najran|الجبيل|jubail|الاحساء|hofuf|الهفوف|ينبع|yanbu|الظهران|dhahran|خميس مشيط|khamis mushait|القطيف|qatif|عرعر|arar|سكاكا|sakaka|الباحة|baha|عنيزة|unaizah|الخرج|kharj'],
  ['Asia/Dubai', 'الإمارات', 'United Arab Emirates', 'دبي|ابوظبي|ابو ظبي|abu dhabi|الشارقة|sharjah|عجمان|ajman|العين|al ain|راس الخيمة|ras al khaimah|الفجيرة|fujairah|ام القيوين|umm al quwain'],
  ['Asia/Baghdad', 'العراق', 'Iraq', 'بغداد|bagdad|البصرة|basra|الموصل|mosul|اربيل|erbil|arbil|النجف|najaf|كربلاء|karbala|السليمانية|sulaymaniyah|كركوك|kirkuk|الناصرية|nasiriyah|الرمادي|ramadi|الفلوجة|fallujah|دهوك|duhok|الحلة|hillah|العمارة|amarah|الكوت|kut|الديوانية|diwaniyah|السماوة|samawah'],
  ['Asia/Amman', 'الأردن', 'Jordan', 'عمان الاردن|عمان الأردن|amman|اربد|irbid|الزرقاء|zarqa|العقبة|aqaba|السلط|salt|مادبا|madaba|الكرك|karak|جرش|jerash|المفرق|mafraq|معان|maan'],
  ['Asia/Damascus', 'سوريا', 'Syria', 'دمشق|damascus|damas|حلب|aleppo|alep|حمص|homs|اللاذقية|latakia|حماة|hama|طرطوس|tartus|دير الزور|deir ez zor|الرقة|raqqa|درعا|daraa|ادلب|idlib|القامشلي|qamishli|السويداء|suwayda'],
  ['Asia/Beirut', 'لبنان', 'Lebanon', 'بيروت|beyrouth|طرابلس لبنان|tripoli lebanon|صيدا|sidon|صور|tyre|زحلة|zahle|جونية|jounieh|بعلبك|baalbek|النبطية|nabatieh'],
  ['Asia/Kuwait', 'الكويت', 'Kuwait', 'مدينة الكويت|kuwait city|السالمية|salmiya|الجهراء|jahra'],
  ['Asia/Qatar', 'قطر', 'Qatar', 'الدوحة|doha|الوكرة|wakrah|الخور|al khor'],
  ['Asia/Bahrain', 'البحرين', 'Bahrain', 'المنامة|manama|المحرق|muharraq|الرفاع|riffa'],
  ['Asia/Muscat', 'عمان', 'Oman', 'مسقط|صلالة|salalah|صحار|sohar|نزوى|nizwa|صور عمان|sur oman'],
  ['Asia/Aden', 'اليمن', 'Yemen', 'صنعاء|sanaa|sana a|عدن|تعز|taiz|الحديدة|hodeidah|المكلا|mukalla|اب اليمن|مارب|marib'],
  ['Africa/Khartoum', 'السودان', 'Sudan', 'الخرطوم|ام درمان|omdurman|بورتسودان|port sudan|كسلا|kassala|الابيض|el obeid|نيالا|nyala'],
  ['Africa/Nouakchott', 'موريتانيا', 'Mauritania', 'نواكشوط|نواذيبو|nouadhibou|روصو|rosso|كيفة|kiffa'],
  ['Asia/Gaza', 'فلسطين', 'Palestine (Gaza)', 'غزة|خان يونس|khan younis|رفح|rafah|دير البلح|deir al balah|جباليا|jabalia'],
  ['Asia/Hebron', 'فلسطين', 'Palestine (West Bank)', 'رام الله|ramallah|نابلس|nablus|الخليل|hebron|بيت لحم|bethlehem|جنين|jenin|طولكرم|tulkarm|قلقيلية|qalqilya|اريحا|jericho|الضفة الغربية|west bank'],
  ['Asia/Jerusalem', 'القدس', 'Jerusalem', 'القدس|al quds|القدس الشريف'],
  ['Europe/Istanbul', 'تركيا', 'Turkey', 'اسطنبول|استانبول|انقرة|ankara|ازمير|izmir|بورصة|bursa|انطاليا|antalya|اضنة|adana|قونية|konya'],
  ['Europe/Paris', 'فرنسا', 'France', 'باريس|مرسيليا|marseille|ليون|lyon|تولوز|toulouse|نيس|nice|ليل|lille|بوردو|bordeaux|ستراسبورغ|strasbourg|نانت|nantes|مونبلييه|montpellier'],
  ['Europe/London', 'بريطانيا', 'United Kingdom', 'لندن|مانشستر|manchester|برمنغهام|birmingham|ليفربول|liverpool|ادنبرة|edinburgh|glasgow|كارديف|cardiff'],
  ['Europe/Berlin', 'ألمانيا', 'Germany', 'برلين|ميونخ|munich|munchen|هامبورغ|hamburg|فرانكفورت|frankfurt|كولن|cologne|koln|شتوتغارت|stuttgart'],
  ['Europe/Madrid', 'إسبانيا', 'Spain', 'مدريد|برشلونة|barcelona|فالنسيا|valencia|اشبيلية|seville|sevilla|ملقة|malaga'],
  ['Europe/Rome', 'إيطاليا', 'Italy', 'روما|ميلانو|milan|milano|نابولي|naples|napoli|تورينو|turin|torino'],
  ['Europe/Brussels', 'بلجيكا', 'Belgium', 'بروكسل|bruxelles|انتويرب|antwerp|لياج|liege'],
  ['Europe/Amsterdam', 'هولندا', 'Netherlands', 'امستردام|روتردام|rotterdam|لاهاي|the hague|den haag|اوتريخت|utrecht'],
  ['Europe/Stockholm', 'السويد', 'Sweden', 'ستوكهولم|غوتنبرغ|gothenburg|مالمو|malmo'],
  ['Europe/Zurich', 'سويسرا', 'Switzerland', 'زيورخ|جنيف|geneva|geneve|برن|bern|لوزان|lausanne|بازل|basel'],
  ['Europe/Moscow', 'روسيا', 'Russia', 'موسكو|سانت بطرسبرغ|saint petersburg|st petersburg|قازان|kazan'],
  ['America/New_York', 'أمريكا', 'USA (Eastern)', 'نيويورك|nyc|واشنطن|washington|بوسطن|boston|ميامي|miami|اتلانتا|atlanta|فيلادلفيا|philadelphia|ديترويت|detroit|اورلاندو|orlando|شارلوت|charlotte'],
  ['America/Chicago', 'أمريكا', 'USA (Central)', 'شيكاغو|هيوستن|houston|دالاس|dallas|اوستن|austin|سان انطونيو|san antonio|نيو اورليانز|new orleans|مينيابوليس|minneapolis'],
  ['America/Denver', 'أمريكا', 'USA (Mountain)', 'دنفر|salt lake city|سولت ليك|فينيكس|phoenix'],
  ['America/Los_Angeles', 'أمريكا', 'USA (Pacific)', 'لوس انجلوس|لوس انجليس|la|سان فرانسيسكو|san francisco|سياتل|seattle|لاس فيغاس|las vegas|سان دييغو|san diego|بورتلاند|portland'],
  ['America/Toronto', 'كندا', 'Canada (Eastern)', 'تورنتو|مونتريال|montreal|اوتاوا|ottawa|كيبيك|quebec'],
  ['America/Vancouver', 'كندا', 'Canada (Pacific)', 'فانكوفر|فكتوريا|victoria'],
  ['America/Edmonton', 'كندا', 'Canada (Mountain)', 'ادمونتون|كالغاري|calgary'],
  ['Australia/Sydney', 'أستراليا', 'Australia (Sydney)', 'سيدني|ملبورن|melbourne|كانبيرا|canberra'],
  ['Australia/Perth', 'أستراليا', 'Australia (Perth)', 'بيرث'],
  ['Asia/Kolkata', 'الهند', 'India', 'دلهي|delhi|new delhi|مومباي|mumbai|بومباي|bombay|كلكتا|kolkata|calcutta|بنغالور|bangalore|حيدر اباد|hyderabad|تشيناي|chennai'],
  ['Asia/Karachi', 'باكستان', 'Pakistan', 'كراتشي|لاهور|lahore|اسلام اباد|islamabad|بيشاور|peshawar|راولبندي|rawalpindi'],
  ['Asia/Dhaka', 'بنغلاديش', 'Bangladesh', 'دكا|dacca|شيتاغونغ|chittagong'],
  ['Asia/Kuala_Lumpur', 'ماليزيا', 'Malaysia', 'كوالالمبور|penang|جوهور|johor'],
  ['Asia/Jakarta', 'إندونيسيا', 'Indonesia', 'جاكرتا|surabaya|bandung'],
  ['Africa/Johannesburg', 'جنوب أفريقيا', 'South Africa', 'جوهانسبرغ|كيب تاون|cape town|دوربان|durban|بريتوريا|pretoria'],
  ['Africa/Lagos', 'نيجيريا', 'Nigeria', 'لاغوس|ابوجا|abuja|كانو|kano'],
  ['Africa/Dakar', 'السنغال', 'Senegal', 'داكار'],
  ['Africa/Nairobi', 'كينيا', 'Kenya', 'نيروبي|mombasa'],
  ['Africa/Addis_Ababa', 'إثيوبيا', 'Ethiopia', 'اديس ابابا'],
  ['Africa/Mogadishu', 'الصومال', 'Somalia', 'مقديشو']
];

// ── The index: normalised name → { zone, ar, en }. First one wins, so the order below is the priority. ──────────────
let INDEX = null;
const stripParen = (name) => String(name).replace(/\s*\(.*?\)\s*/g, ' ').trim();

function buildIndex() {
  const map = new Map();
  const add = (name, zone, ar, en) => {
    const key = normalizePlace(name);
    if (!key || map.has(key)) return;
    if (!valid(zone)) return;                       // an old runtime that does not know this zone: skip it, never crash
    map.set(key, { zone, ar, en });
  };
  // 1) cities and the names members use for them
  for (const [zone, ar, en, aliases] of CITIES) for (const a of aliases.split('|')) add(a, zone, ar, en);
  // 2) countries: official names in three languages, ISO code, and the extra spellings
  for (const [cc, zone, ar, en, fr] of COUNTRIES) {
    const arName = stripParen(ar);
    for (const n of [ar, arName, en, fr, cc]) add(n, zone, arName, en);
    for (const a of (COUNTRY_ALIASES[cc] ?? '').split('|')) if (a) add(a, zone, arName, en);
  }
  // 3) every city of the tz database ("Buenos Aires", "Ho Chi Minh", "Kuala Lumpur"…)
  for (const zone of Intl.supportedValuesOf?.('timeZone') ?? []) {
    const city = zone.split('/').pop().replace(/_/g, ' ');
    add(city, zone, city, city);
  }
  return map;
}
const index = () => (INDEX ??= buildIndex());

/** Optimal-string-alignment distance (insert, delete, replace, swap two neighbours), giving up above `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d; if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** "UTC+1", "gmt - 5", "+3" → "Etc/GMT-1" (the tz database writes the sign the other way round), else null. */
function parseOffset(raw) {
  const m = /^(?:(?:utc|gmt)\s*)?([+\-−])\s*(\d{1,2})(?::?00)?$/i.exec(raw.trim()) ?? /^(?:utc|gmt)\s*()(0{1,2})$/i.exec(raw.trim());
  if (!m) return null;
  const hours = Number(m[2]);
  if (hours === 0) return 'UTC';
  const plus = m[1] === '+';
  if (plus ? hours > 14 : hours > 12) return null;
  return `Etc/GMT${plus ? '-' : '+'}${hours}`;
}

/** "Africa/Algiers", "الجزائر", "Algérie", "السعوديه", "Saudi Arabi", "UTC+1" … → a valid IANA zone, or null. */
export function resolveTimeZone(input) {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 80) return null;
  if (valid(raw)) return canonical(raw);                                // 1) IANA name in any casing
  const offset = parseOffset(raw);                                       // 2) UTC offset
  if (offset && valid(offset)) return offset;

  const key = normalizePlace(raw);
  if (!key) return null;
  const idx = index();
  const exact = idx.get(key);                                            // 3) exact name
  if (exact) return exact.zone;

  const words = key.split(' ');                                          // 4) the longest known name inside the words typed
  for (let n = words.length - 1; n >= 1; n--) {
    const zones = new Set();
    for (let i = 0; i + n <= words.length; i++) {
      const part = words.slice(i, i + n).join(' ');
      const hit = part.length >= 3 ? idx.get(part) : null;
      if (hit) zones.add(hit.zone);
    }
    if (zones.size === 1) return [...zones][0];
    if (zones.size > 1) return null;                                     // two different places at the same weight → ask, don't guess
  }

  if (key.length >= 4) {                                                 // 5) a typo: only when exactly one zone is that close
    const max = key.length >= 8 ? 2 : 1;
    let best = max + 1, zones = new Set();
    for (const [k, v] of idx) {
      if (k.length < 4) continue;
      const d = distance(key, k, max);
      if (d < best) { best = d; zones = new Set([v.zone]); } else if (d === best && d <= max) zones.add(v.zone);
    }
    if (best <= max && zones.size === 1) return [...zones][0];
  }
  return null;
}

/**
 * Up to `limit` names that look like what was typed, for "did you mean…?" in the error message.
 * @param {'ar'|'en'} lang
 * @returns {string[]} display names (country or city), one per zone
 */
export function suggestTimeZones(input, lang = 'ar', limit = 3) {
  const key = normalizePlace(input);
  if (key.length < 2) return [];
  const max = key.length <= 4 ? 1 : Math.max(2, Math.floor(key.length / 3));      // 4 letters or fewer: one letter off at most, so no random suggestions
  const best = new Map();                                                // zone → { score, label }
  for (const [k, v] of index()) {
    if (k.length < 3) continue;
    let score = distance(key, k, max);
    if (score > max && key.length >= 3 && (k.startsWith(key) || key.startsWith(k))) score = 1;      // "saud" → Saudi Arabia
    if (score > max) continue;
    const cur = best.get(v.zone);
    if (!cur || score < cur.score) best.set(v.zone, { score, label: lang === 'ar' ? v.ar : v.en });
  }
  return [...best.values()].sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)).slice(0, limit).map(x => x.label);
}
