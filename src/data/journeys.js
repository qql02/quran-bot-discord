/**
 * /journey — guided "journeys" through the Quran: a topic, then a few verses read one at a time, each with its short tafsir
 * (التفسير الميسر) and a reflection question (وقفة).
 *
 * Only REFERENCES ("surah:ayah") are stored here. The verse text, its tafsir and the Mushaf page are fetched from the Quran API
 * at read time (services/ayahService.js → fetchAyah), exactly like the verse of the day — no Quran text is typed by hand.
 * The only hand-written words are the titles and the reflection questions, which are questions, not religious rulings.
 *
 * To add a journey: append an object below (unique short ASCII `id`, 3–6 steps). test/journeys.test.js checks every reference
 * against the real number of verses of its surah, so a typo cannot ship.
 */

/** @typedef {{ ref: string, ar: string, en: string }} JourneyStep  `ar` / `en` = the reflection question (وقفة) */
/** @typedef {{ id: string, icon: string, ar: string, en: string, descAr: string, descEn: string, steps: JourneyStep[] }} Journey */

/** @type {Journey[]} */
export const JOURNEYS = [
  {
    id: 'sabr', icon: '🌿', ar: 'الصبر والثبات', en: 'Patience & steadfastness',
    descAr: 'حين يطول الطريق وتثقل الأيام', descEn: 'When the road is long and the days are heavy',
    steps: [
      { ref: '2:153', ar: 'ما الموقف الذي تحتاج أن تستعين فيه بالصبر والصلاة؟', en: 'Where in your life do you need patience and prayer right now?' },
      { ref: '2:155', ar: 'ما الابتلاء الذي مرّ بك وكنت تظنه أثقل مما تحتمل، ثم احتملته؟', en: 'Which hardship felt unbearable, yet you carried it?' },
      { ref: '39:10', ar: 'كيف يتغير شعورك بالصبر حين تتذكر أن أجره بغير حساب؟', en: 'How does it change patience to know its reward is without measure?' },
      { ref: '3:200', ar: 'أي ثغر في حياتك تحتاج أن تثبت عليه اليوم؟', en: 'Which post in your life do you need to hold steady today?' }
    ]
  },
  {
    id: 'hope', icon: '🌅', ar: 'الرجاء وعدم اليأس', en: 'Hope & never despairing',
    descAr: 'لمن ضاق صدره وظن أن الأبواب أُغلقت', descEn: 'For when doors seem closed',
    steps: [
      { ref: '12:87', ar: 'ما الأمر الذي كدتَ تيأس منه، وماذا لو فتح الله فيه بابًا لم تتوقعه؟', en: 'What did you nearly give up on — and what if a door opened you never expected?' },
      { ref: '39:53', ar: 'ما الذنب أو الضعف الذي تظن أنه يبعدك عن رحمة الله؟', en: 'What sin or weakness makes you feel far from His mercy?' },
      { ref: '94:5', ar: 'تذكّر ضيقًا مضى: كيف جاء اليسر بعده؟', en: 'Remember a past hardship: how did ease follow it?' },
      { ref: '65:7', ar: 'أين ترى في حياتك أثر هذا الوعد: «سيجعل الله بعد عسر يسرًا»؟', en: 'Where do you see this promise at work in your life?' }
    ]
  },
  {
    id: 'sakina', icon: '🕊️', ar: 'السكينة والطمأنينة', en: 'Calm & inner peace',
    descAr: 'حين يضطرب القلب ويكثر الضجيج', descEn: 'When the heart is restless and the noise is loud',
    steps: [
      { ref: '13:28', ar: 'ما أكثر ما يشغل قلبك اليوم، وما ذكر الله الذي تهدّئه به؟', en: 'What occupies your heart most today, and which dhikr will settle it?' },
      { ref: '48:4', ar: 'متى شعرتَ بسكينة نزلت عليك دون سبب ظاهر؟', en: 'When did you last feel calm descend on you for no visible reason?' },
      { ref: '9:40', ar: 'ماذا يعني لك أن الله «معنا» في لحظة الخوف؟', en: 'What does it mean to you that Allah is "with us" in a moment of fear?' },
      { ref: '89:27', ar: 'ما الذي يقرّبك من أن تكون نفسًا مطمئنة؟', en: 'What brings you closer to a soul at peace?' }
    ]
  },
  {
    id: 'shukr', icon: '✨', ar: 'الشكر', en: 'Gratitude',
    descAr: 'التفات إلى النعم التي اعتدنا عليها', descEn: 'Noticing the blessings we got used to',
    steps: [
      { ref: '14:7', ar: 'اذكر ثلاث نعم لا تنتبه لها عادة، واشكر الله عليها الآن.', en: 'Name three blessings you usually overlook, and thank Allah for them now.' },
      { ref: '2:152', ar: 'كيف تجعل ذكر الله وشكره حاضرين في يومك؟', en: 'How can remembrance and gratitude be present in your day?' },
      { ref: '16:18', ar: 'حاول أن تعدّ نعمك… ماذا تلاحظ؟', en: 'Try counting your blessings… what do you notice?' },
      { ref: '31:12', ar: 'الشكر يعود نفعه إليك؛ كيف رأيت ذلك في حياتك؟', en: 'Gratitude benefits you first; how have you seen that?' }
    ]
  },
  {
    id: 'tawba', icon: '🤲', ar: 'التوبة والعودة', en: 'Repentance & return',
    descAr: 'بداية جديدة مهما طال البعد', descEn: 'A fresh start, however far you drifted',
    steps: [
      { ref: '66:8', ar: 'ما الخطوة الأولى الصادقة التي تستطيع أن تخطوها اليوم نحو التوبة؟', en: 'What is the first sincere step you can take toward repentance today?' },
      { ref: '3:135', ar: 'ما الذي يعينك على ألّا تُصرّ على الخطأ بعد أن تعرفه؟', en: 'What helps you avoid persisting in a mistake once you know it?' },
      { ref: '4:110', ar: 'كيف يطمئنك أن باب الاستغفار مفتوح دائمًا؟', en: 'How does the always-open door of istighfar reassure you?' },
      { ref: '24:31', ar: 'ما الذي تريد أن تفلح فيه بعد أن تعود؟', en: 'What do you hope to succeed in after you return?' }
    ]
  },
  {
    id: 'tawakkul', icon: '🌙', ar: 'التوكل', en: 'Trust in Allah',
    descAr: 'أن تأخذ بالأسباب وتترك النتائج له', descEn: 'Do your part and leave the outcome to Him',
    steps: [
      { ref: '65:3', ar: 'ما الأمر الذي تحمل همّه وتحتاج أن تسلّمه لله؟', en: 'What burden are you carrying that you need to hand over to Allah?' },
      { ref: '3:173', ar: 'ماذا تقول لنفسك حين يخوّفك الناس أو الظروف؟', en: 'What do you tell yourself when people or circumstances frighten you?' },
      { ref: '3:159', ar: 'ما الخطوة العملية التي ستعزم عليها، ثم تتوكل؟', en: 'What practical step will you commit to before trusting in Him?' },
      { ref: '9:51', ar: 'كيف يخفف عنك أن كل شيء مكتوب بعلم الله؟', en: 'How does it lighten you that everything is written with His knowledge?' }
    ]
  },
  {
    id: 'dua', icon: '🤍', ar: 'الدعاء والقرب من الله', en: 'Du\'a & nearness to Allah',
    descAr: 'هو قريب يجيب إذا دعوته', descEn: 'He is near and answers when you call',
    steps: [
      { ref: '2:186', ar: 'متى آخر مرة دعوتَ الله بإلحاح وصدق؟ وما الذي تريد أن تدعوه به الآن؟', en: 'When did you last make du\'a sincerely? What will you ask Him for now?' },
      { ref: '40:60', ar: 'لماذا نتردد أحيانًا في الدعاء مع أنه أمرنا به؟', en: 'Why do we sometimes hesitate to ask when He commanded us to?' },
      { ref: '7:55', ar: 'كيف تدعو بتضرع وخفية، بعيدًا عن الأنظار؟', en: 'How can you call upon Him humbly and privately?' },
      { ref: '27:62', ar: 'من يجيب المضطر إذا دعاه؟ ما الذي تضطر إليه اليوم؟', en: 'Who answers the one in distress? What do you need most today?' }
    ]
  },
  {
    id: 'akhlaq', icon: '🌸', ar: 'حسن الخلق والعفو', en: 'Good character & forgiving',
    descAr: 'ادفع بالتي هي أحسن', descEn: 'Repel evil with what is better',
    steps: [
      { ref: '41:34', ar: 'من الذي أساء إليك وتستطيع اليوم أن تقابله بالحسنى؟', en: 'Who wronged you that you could meet with kindness today?' },
      { ref: '7:199', ar: 'ما الذي يجعل العفو والإعراض عن الجاهلين صعبًا عليك؟', en: 'What makes forgiving and turning away from ignorance hard for you?' },
      { ref: '3:134', ar: 'متى كظمتَ غيظك لله؟ وكيف كان أثره عليك؟', en: 'When did you swallow your anger for Allah, and what did it do for you?' },
      { ref: '25:63', ar: 'كيف تجيب بـ«سلامًا» حين يخاطبك الجاهلون؟', en: 'How can you answer "peace" when the ignorant address you?' }
    ]
  },
  {
    id: 'family', icon: '🏡', ar: 'الوالدان والأسرة', en: 'Parents & family',
    descAr: 'الإحسان لمن كانوا سببًا في وجودك', descEn: 'Kindness to those who raised you',
    steps: [
      { ref: '17:23', ar: 'ما الكلمة اللطيفة التي تستطيع أن تقولها لوالديك اليوم؟', en: 'What gentle word can you say to your parents today?' },
      { ref: '17:24', ar: 'متى آخر مرة دعوتَ لوالديك؟ ادعُ لهما الآن.', en: 'When did you last make du\'a for your parents? Do it now.' },
      { ref: '31:14', ar: 'تذكّر تعب الأمّ وجهدها… كيف تردّ جزءًا من الجميل؟', en: 'Remember a mother\'s hardship… how can you repay part of it?' },
      { ref: '30:21', ar: 'كيف تزرع المودة والرحمة في بيتك؟', en: 'How can you plant affection and mercy at home?' }
    ]
  },
  {
    id: 'ilm', icon: '📚', ar: 'العلم والتدبر', en: 'Knowledge & reflection',
    descAr: 'اقرأ، وتدبّر، وارتفع', descEn: 'Read, reflect, and rise',
    steps: [
      { ref: '20:114', ar: 'ما العلم الذي تريد أن تزداد منه هذا الأسبوع؟', en: 'What knowledge do you want to grow in this week?' },
      { ref: '39:9', ar: 'ما الذي ينقصك لتكون من «الذين يعلمون» عملًا لا قولًا فقط؟', en: 'What would make you among those who know — in deed, not just word?' },
      { ref: '58:11', ar: 'كيف ترفعك الأخلاق والعلم معًا؟', en: 'How do knowledge and character raise you together?' },
      { ref: '47:24', ar: 'متى آخر مرة قرأتَ القرآن بتدبّر وتوقفتَ عند آية؟', en: 'When did you last read the Quran reflectively and pause on a verse?' }
    ]
  },
  {
    id: 'sidq', icon: '🤝', ar: 'الصدق والأمانة', en: 'Truthfulness & trust',
    descAr: 'أن يوافق قولُك فعلَك', descEn: 'When your word matches your deed',
    steps: [
      { ref: '9:119', ar: 'من هم الصادقون الذين تحب أن تكون معهم؟', en: 'Who are the truthful people you want to stand with?' },
      { ref: '33:70', ar: 'ما القول السديد الذي تحتاج أن تلتزمه في حديثك اليوم؟', en: 'What straight speech do you need to commit to today?' },
      { ref: '4:58', ar: 'ما الأمانة التي بين يديك وتحتاج أن تؤديها لأهلها؟', en: 'What trust is in your hands that you must return to its people?' },
      { ref: '61:2', ar: 'هل هناك وعد قلتَه ولم تفعله بعد؟', en: 'Is there a promise you made and have not yet kept?' }
    ]
  },
  {
    id: 'istiqama', icon: '🧭', ar: 'الاستقامة', en: 'Staying on the straight path',
    descAr: 'قليل دائم خير من كثير منقطع', descEn: 'Small and constant beats big and broken',
    steps: [
      { ref: '1:6', ar: 'كم مرة تطلب الهداية يوميًا؟ وهل تستحضر معناها؟', en: 'How often do you ask for guidance daily — and do you feel its meaning?' },
      { ref: '41:30', ar: 'ماذا تنتظر من الاستقامة؟ كيف تثبّت نفسك عليها؟', en: 'What do you hope for from steadfastness, and how will you keep it?' },
      { ref: '11:112', ar: 'ما الذي يجعلك تنحرف أحيانًا عن الطريق؟', en: 'What makes you drift off the path sometimes?' },
      { ref: '46:13', ar: 'ما عادة صغيرة تستطيع أن تداوم عليها بدءًا من اليوم؟', en: 'What small habit can you keep up starting today?' }
    ]
  },
  {
    id: 'infaq', icon: '💝', ar: 'الإنفاق والصدقة', en: 'Giving & charity',
    descAr: 'ما أنفقتَه في سبيل الله باقٍ لك', descEn: 'What you give for Allah stays with you',
    steps: [
      { ref: '2:261', ar: 'كيف تتخيل أن عطاءك الصغير قد يتضاعف؟', en: 'How do you picture your small gift multiplying?' },
      { ref: '3:92', ar: 'ما الشيء الذي تحبه ويمكنك أن تتصدق به؟', en: 'What do you love that you could give away?' },
      { ref: '2:274', ar: 'هل تستطيع أن تتصدق اليوم سرًا؟', en: 'Could you give in secret today?' },
      { ref: '2:271', ar: 'ما الأبواب الأخرى للخير غير المال التي تفتحها اليوم؟', en: 'Beyond money, what other doors of good can you open today?' }
    ]
  },
  {
    id: 'rida', icon: '🌤️', ar: 'الرضا بالقضاء', en: 'Contentment with the decree',
    descAr: 'عسى أن تكرهوا شيئًا وهو خير لكم', descEn: 'Perhaps what you dislike is good for you',
    steps: [
      { ref: '2:216', ar: 'ما الأمر الذي كرهتَه ثم ظهر لك خيره لاحقًا؟', en: 'What did you dislike that later proved good?' },
      { ref: '64:11', ar: 'كيف يهدي الله قلب من يؤمن به عند المصيبة؟', en: 'How does Allah guide the heart of the believer in calamity?' },
      { ref: '57:22', ar: 'كيف يخفف عنك أن ما أصابك لم يكن ليخطئك؟', en: 'How does it ease you that what befell you was never going to miss you?' },
      { ref: '2:286', ar: 'ما الذي تسأل الله أن يخفّفه عنك الآن؟', en: 'What do you ask Allah to lighten for you now?' }
    ]
  }
];

const byId = new Map(JOURNEYS.map(j => [j.id, j]));
export const getJourney = (id) => byId.get(id) ?? null;
export const journeyTitle = (j, lang = 'ar') => (lang === 'ar' ? j.ar : j.en);
export const journeyDesc = (j, lang = 'ar') => (lang === 'ar' ? j.descAr : j.descEn);

/** A journey the member did not just do: random, avoiding `exceptId` when there is more than one. */
export function randomJourney(exceptId = null, rng = Math.random) {
  const pool = JOURNEYS.filter(j => j.id !== exceptId);
  return pool[Math.floor(rng() * pool.length)];
}

// ── Tafsir editions a member can pick (all served by the same Quran API as the verse text) ───────────────────────────
/** `key` is what travels in button ids (kept short); `edition` is the API's identifier. The first one is the default. */
export const TAFSIRS = [
  { key: 'mu', edition: 'ar.muyassar', ar: 'التفسير الميسر',   en: 'Al-Muyassar (concise)' },
  { key: 'jl', edition: 'ar.jalalayn', ar: 'تفسير الجلالين',   en: 'Al-Jalalayn' },
  { key: 'qu', edition: 'ar.qurtubi',  ar: 'تفسير القرطبي',    en: 'Al-Qurtubi' },
  { key: 'bg', edition: 'ar.baghawi',  ar: 'تفسير البغوي',     en: 'Al-Baghawi' },
  { key: 'ws', edition: 'ar.waseet',   ar: 'التفسير الوسيط',   en: 'Al-Waseet' }
];
export const DEFAULT_TAFSIR = TAFSIRS[0].key;
export const getTafsir = (key) => TAFSIRS.find(t => t.key === key) ?? TAFSIRS[0];
