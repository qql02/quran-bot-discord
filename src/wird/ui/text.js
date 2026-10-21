// Every user-facing sentence of the daily wird, in both languages. A member's screens follow `sub.lang`; a screen shown
// before the member has subscribed follows the wird language of the server. Surah names and the Quran stay Arabic
// (surah names are shown in their English transliteration in the English screens).

const AR = {
  // ── shared ──
  page: (p) => `صفحة **${p}**`,
  pages: (a, b) => `من صفحة **${a}** إلى **${b}**`,
  where: (surah, juz) => `سورة ${surah} · الجزء ${juz}`,
  duration: { 15: 'ختمة في 15 يوماً', 30: 'ختمة في شهر', 60: 'ختمة في شهرين', 90: 'ختمة في 3 أشهر', 180: 'ختمة في 6 أشهر' },
  durationDays: (d) => `ختمة في ${d} يوماً`,
  pagesPerDay: (n) => `${n === 1 ? 'صفحة واحدة' : n === 2 ? 'صفحتان' : n <= 10 ? `${n} صفحات` : `${n} صفحة`} يومياً`,

  // ── cards ──
  subStopped: '**متوقف** — اضغط «جدّد» لاستئنافه مجاناً',
  subExpired: '**منتهٍ** — جدّده مجاناً بضغطة',
  subActive: (expiring, date, rel) => `**${expiring ? 'ينتهي قريباً' : 'نشط'}** · ينتهي ${date} (${rel})`,
  todayName: 'وردك اليوم',
  adhkarName: 'أذكار في الخاص',
  adhkarOff: 'غير مفعّلة — فعّلها بالأزرار أدناه (صباح ومساء بتوقيتك)',
  adhkarValue: (m, e) => [m && 'الصباح', e && 'المساء'].filter(Boolean).join(' + ') + ' — بتوقيتك',
  adhkarOn: (slot) => (slot === 'morning' ? 'فُعّلت أذكار الصباح في خاصك.' : 'فُعّلت أذكار المساء في خاصك.'),
  adhkarOffMsg: (slot) => (slot === 'morning' ? 'أُوقفت أذكار الصباح.' : 'أُوقفت أذكار المساء.'),
  todayDone: '**أتممت وردك اليوم** — تقبّل الله منك',
  progressName: 'تقدّم الختمة',
  progressValue: (bar, pct, cur, total) => `${bar} **${pct}%**\n${cur} / ${total} صفحة`,
  streakName: 'السلسلة',
  streakValue: (n, best) => `**${n}** يوم\nالأفضل: ${best}`,
  khatmasName: 'الختمات',
  khatmasValue: (n) => `**${n}** ختمة`,
  readName: 'ما قرأت',
  readValue: (n) => `**${n}** صفحة`,
  planName: 'الخطة',
  planValue: (label, days, eta, free) => `**${label}**\nتختم خلال نحو **${days}** يوماً (${eta})${free ? '\nاختيارك الحر، بلا مدة محددة' : ''}`,
  goalName: 'الهدف',
  goalOverdue: 'انتهت مدة هدفك. اختر مدة جديدة من القائمة أدناه، وتقدّمك محفوظ.',
  goalLine: (label, deadline) => `${label} · الموعد \`${deadline}\``,
  goalOnTrack: '**أنت على المسار**',
  goalBehind: (n) => `تحتاج **${n}** صفحة يومياً للحاق، اضغط «أعد حساب خطتي»`,
  goalSubEnds: 'اشتراكك ينتهي قبل موعد هدفك؛ جدّده بضغطة مجاناً لتستمر التذكيرات.',
  subName: 'الاشتراك (مجاني)',
  reminderName: 'التذكير',
  reminderVaried: 'متغيّر يومياً\n(صباحاً / عصراً / مساءً)',
  zoneName: 'المنطقة',
  guideName: 'كيف تستخدم الورد؟',
  guideValue: [
    '**1.** اختر خطتك من القائمتين أدناه.',
    '**2.** اضغط «اقرأ هنا» واقرأ صفحة صفحة.',
    '**3.** اضغط «أتممت هذه الصفحة» ليُسجَّل تقدّمك وتصلك التي بعدها. عند إتمام وردك تصلك البقية غداً.'
  ].join('\n'),
  reminderTitle: 'حان وقت وردك اليوم',
  reminderGreeting: 'السلام عليكم ورحمة الله وبركاته',
  reminderFooter: 'قليلٌ دائم خيرٌ من كثيرٍ منقطع',
  streakInline: (n) => `**${n}** يوم متتالٍ`,
  leftName: 'المتبقي للختم',
  leftValue: (n) => `نحو **${n}** يوماً`,
  roomReminder: (userId, range) => `<@${userId}> حان وقت وردك اليوم: ${range}.\nاكتب \`/help\` ← «وردي اليومي» لعرض تقدّمك. وللتذكير على الخاص افتح رسائلك الخاصة من هذا السيرفر.`,
  statusTitle: 'وردي اليومي',
  statusFooter: 'غيّر خطتك في أي وقت من القائمتين أدناه',
  savedTitles: { subscribed: 'تم الاشتراك', welcomeBack: 'أهلاً بعودتك', settingsSaved: 'تم حفظ إعداداتك', renewed: 'تم تجديد اشتراكك' },
  saved: (title, days) => `**${title}.** الاشتراك مجاني ومدته ${days} يوماً، وتتوقف التذكيرات عند انتهائه حتى تجدده بضغطة.`,
  readingSaved: (n) => `سُجّلت **${n}** صفحة — تقبّل الله منك.`,
  readingDayDone: (streak) => `أتممت وردك اليوم. سلسلتك: **${streak}** يوم.`,
  readingLeft: 'بقي عليك شيء من وردك اليوم — أكمله بإذن الله.',
  khatmaTitle: 'ما شاء الله، تمّت ختمتك للقرآن الكريم',
  khatmaDesc: (n) => [
    `بارك الله فيك وتقبّل منك — هذه ختمتك رقم **${n}**.`, '',
    '> اللهم ارحمني بالقرآن واجعله لي إماماً ونوراً وهدىً ورحمة.',
    '> اللهم اجعل القرآن ربيع قلبي، ونور صدري، وجلاء حزني، وذهاب همّي.',
    '> رَبَّنَا تَقَبَّلْ مِنَّا ۖ إِنَّكَ أَنتَ السَّمِيعُ الْعَلِيمُ.', '',
    'بدأت ختمة جديدة تلقائياً من الصفحة 1. دُمتَ على الخير.'
  ].join('\n'),
  khatmaAnnounce: (userId, n, days) => `ما شاء الله! <@${userId}> ختم القرآن الكريم (الختمة رقم **${n}**)${days ? ` في **${days}** يوماً` : ''} — تقبّل الله منا ومنكم.`,

  // ── buttons and menus ──
  btn: {
    readHere: 'اقرأ هنا', readNow: 'اقرأ الآن', settings: 'الإعدادات', editSettings: 'وقت التذكير والمنطقة',
    stop: 'إيقاف التذكيرات', recalc: 'أعد حساب خطتي', delete: 'احذف بياناتي نهائياً', myProgress: 'تقدّمي',
    renew: 'جدّد اشتراكي مجاناً', renewNow: 'جدّد الآن', resume: 'استأنف الورد',
    deleteYes: 'نعم، احذف كل شيء', deleteNo: 'تراجع',
    adhkarMorning: 'أذكار الصباح', adhkarEvening: 'أذكار المساء',
    subscribe: 'اشترك في الورد', myPlan: 'خطتي وتقدّمي', readMushaf: 'اقرأ المصحف'
  },
  menuDuration: 'اختر مدة لختم القرآن',
  menuDurationItem: (label, ppdLabel, days) => ({ label, description: `${ppdLabel} · تنتهي خلال ${days} يوماً` }),
  menuDurationOther: { label: 'مدة أخرى', description: 'اكتب أي عدد أيام من 7 إلى 365' },
  menuPages: 'أو اختر عدد صفحاتك اليومية بنفسك',
  menuPagesItem: (label, days) => ({ label, description: `ختمة خلال نحو ${days} يوماً` }),
  menuPagesOther: { label: 'عدد آخر', description: 'اكتب عدد صفحاتك بنفسك بدون أي حساب' },

  // ── modals ──
  modalSubEdit: 'وقت التذكير والمنطقة',
  modalSubNew: 'الاشتراك في الورد اليومي',
  fTime: 'وقت ثابت HH:MM (فارغ = يتغير يومياً)',
  fTimePh: 'اتركه فارغاً: صباحاً / عصراً / مساءً بالتناوب',
  fTz: 'بلدك أو منطقتك الزمنية (مثل: مصر)',
  fPage: 'آخر صفحة أتممتها في ختمتك (0 = من البداية)',
  modalGoal: 'مدة الختمة',
  fGoal: 'كم يوماً تريد لختم القرآن؟ (من 7 إلى 365)',
  fGoalPh: 'مثال: 45',
  modalPages: 'صفحاتي اليومية',
  fPages: 'كم صفحة تقرأ يومياً؟ (من 1 إلى 100)',
  fPagesPh: 'مثال: 5',

  // ── notices ──
  deleteTitle: 'حذف بيانات الورد',
  deleteDesc: 'سيُحذف اشتراكك وتقدّمك وسلسلتك وختماتك **نهائياً** ولا يمكن استرجاعها. لن يصلك أي تذكير بعد ذلك.\nهل أنت متأكد؟',
  deletedTitle: 'تم الحذف',
  deletedDesc: 'حُذفت بياناتك بالكامل ولن يصلك شيء بعد الآن. يمكنك الاشتراك من جديد متى شئت.',
  expiringTitle: 'اشتراكك في الورد قارب على الانتهاء',
  expiringDesc: (date, rel, days) => `ينتهي ${date} (${rel}) وتتوقف التذكيرات عندها.\nإن أردت المتابعة فالتجديد **مجاني** ولا يضيع تقدّمك — ضغطة واحدة تمدّه ${days} يوماً.`,
  expiredTitle: 'انتهى اشتراكك في الورد',
  expiredDesc: (cur, total) => `انتهى اشتراكك فتوقفت التذكيرات، وتقدّمك محفوظ (**${cur}** / ${total} صفحة).\nجدّد مجاناً متى شئت لتكمل من حيث وقفت.`,
  inactiveTitle: 'توقفت تذكيرات الورد',
  inactiveDesc: (days, cur, total) => `لم تسجّل وردك منذ ${days} أيام، فأوقفنا التذكيرات حتى لا نزعجك.\nتقدّمك محفوظ (**${cur}** / ${total} صفحة). اضغط «استأنف الورد» متى شئت لتكمل، مجاناً.`,
  roomExpiring: (userId, rel) => `<@${userId}> اشتراكك في الورد ينتهي ${rel} وتتوقف التذكيرات عندها. للتجديد مجاناً اكتب \`/help\` ← «وردي اليومي».`,
  roomExpired: (userId) => `<@${userId}> انتهى اشتراكك في الورد فتوقفت التذكيرات، وتقدّمك محفوظ. للتجديد مجاناً اكتب \`/help\` ← «وردي اليومي».`,
  roomInactive: (userId, days) => `<@${userId}> توقفت تذكيرات الورد لأنك لم تسجّل وردك منذ ${days} أيام. لاستئنافها مجاناً اكتب \`/help\` ← «وردي اليومي».`,

  // ── the room panel ──
  panelTitle: 'الورد اليومي ومتابعة الختمة',
  panelDesc: 'اشترك **مجاناً** ودع البوت يذكّرك بوردك كل يوم ويتابع تقدّمك حتى تختم القرآن بإذن الله.',
  panelFields: [
    { name: '1. الاشتراك', value: 'اضغط **اشترك في الورد** وحدّد بلدك. اترك الوقت فارغاً ليتبدّل بين الصباح والعصر والمساء، أو اكتب وقتاً ثابتاً.' },
    { name: '2. اختر خطتك', value: '**مدة للختم** (15 يوماً، شهر، شهران، 3 أشهر، 6 أشهر أو أي مدة) ويحسب البوت صفحاتك، أو **عدد صفحات** يومياً بنفسك.' },
    { name: '3. التذكير', value: 'يصلك على **الخاص** (أو هنا إن كان الخاص مغلقاً) بصفحات اليوم ومكانها.' },
    { name: '4. القراءة والتسجيل', value: 'اضغط **اقرأ**، واقرأ داخل ديسكورد، واضغط «أتممت هذه الصفحة» بعد كل صفحة ليُسجَّل تقدّمك وسلسلتك.' }
  ],
  panelInfoName: 'معلومات',
  panelInfo: (days, inactive) => `الاشتراك مجاني ومدته ${days} يوماً، وتتوقف التذكيرات عند انتهائه أو إذا انقطعت عن التسجيل ${inactive} أيام. تجدده بضغطة وتقدّمك محفوظ، وتغيّر خطتك في أي وقت.`,

  // ── handler replies ──
  expiredPlan: 'اشتراكك منتهٍ أو متوقف — جدّده مجاناً ثم غيّر خطتك.',
  expiredGoal: 'اشتراكك منتهٍ أو متوقف — جدّده مجاناً ثم اختر مدتك.',
  expiredPages: 'اشتراكك منتهٍ أو متوقف — جدّده مجاناً ثم اختر صفحاتك.',
  notSubscribed: 'لست مشتركاً في الورد اليومي بعد. اشترك مجاناً من لوحة الورد أو من `/help` ← «وردي اليومي».',
  readerOnly: 'لم يعد تسجيل الورد بضغطة مباشرة. اضغط «اقرأ» واقرأ صفحاتك، ويُسجَّل وردك صفحة صفحة بعد إتمام كل صفحة.',
  goalApplied: (label, ppd) => `مدتك: ${label}. وردك اليومي صار **${ppd}** صفحة.`,
  goalFaster: (real) => ` وبهذا الوتيرة تختم خلال **${real}** يوماً، أي قبل المدة.`,
  goalBadDays: 'اكتب عدد الأيام كرقم صحيح بين 7 و365، مثال: `45`',
  pagesApplied: (label, days) => `وردك اليومي صار **${label}** بحسب اختيارك، وتختم على هذه الوتيرة خلال نحو **${days}** يوماً.`,
  pagesBad: (max) => `اكتب عدد الصفحات كرقم صحيح بين 1 و${max}، مثال: \`5\``,
  noGoal: 'لا يوجد هدف محدد. اختر مدة الختمة من بطاقة «تقدّمي».',
  goalEnded: 'انتهت مدة الهدف. اختر مدة جديدة من القائمة أدناه.',
  goalMaxed: (max) => `الحد الأقصى للخطة ${max} صفحة يومياً. اختر مدة أطول لهدف واقعي.`,
  goalRecalc: (n) => `تم تحديث وردك اليومي إلى **${n}** صفحة لتختم في الموعد.`,
  stopAlready: 'اشتراكك متوقف أصلاً أو لم تشترك بعد.',
  stopped: 'تم إيقاف التذكيرات. تقدّمك محفوظ ويمكنك العودة في أي وقت مجاناً.',
  errTime: 'وقت التذكير غير صالح — مثال: `20:00`، أو اتركه فارغاً ليتغير يومياً',
  errZone: (typed, maybe = []) => `لم أتعرف على «${typed}» — اكتب اسم بلدك أو مدينتك (مثل: الجزائر، وهران، مصر) أو \`UTC+1\`${maybe.length ? `\nهل تقصد: ${maybe.join(' · ')}؟` : ''}`,
  errPage: (max) => `آخر صفحة أتممتها يجب أن تكون بين 0 و${max}`,

  // ── /wird setup ──
  setupNeedManage: 'تحتاج صلاحية **إدارة السيرفر** لاستخدام هذا الأمر.',
  setupNoAccess: (ch) => `ليس لدي صلاحيات كافية في <#${ch}>. أحتاج: **عرض القناة** و**إرسال الرسائل** و**تضمين الروابط**.`,
  setupDoneTitle: 'تم إعداد روم الورد',
  setupDone: (ch, announce) => [
    `نُشرت لوحة الاشتراك في <#${ch}>.`,
    'التذكيرات تصل الأعضاء على **الخاص**، وإن كان مغلقاً يُمنشَنون في هذا الروم.',
    `إعلان الختمات: ${announce ? 'مفعّل' : 'متوقف'}`
  ].join('\n')
};

const EN = {
  page: (p) => `Page **${p}**`,
  pages: (a, b) => `Pages **${a}** to **${b}**`,
  where: (surah, juz) => `Surah ${surah} · Juz ${juz}`,
  duration: { 15: 'Khatma in 15 days', 30: 'Khatma in 1 month', 60: 'Khatma in 2 months', 90: 'Khatma in 3 months', 180: 'Khatma in 6 months' },
  durationDays: (d) => `Khatma in ${d} days`,
  pagesPerDay: (n) => `${n} page${n === 1 ? '' : 's'} a day`,

  subStopped: '**Paused** — tap “Renew” to resume for free',
  subExpired: '**Expired** — renew it for free with one tap',
  subActive: (expiring, date, rel) => `**${expiring ? 'Ending soon' : 'Active'}** · ends ${date} (${rel})`,
  todayName: "Today's wird",
  adhkarName: 'Adhkar in DMs',
  adhkarOff: 'Off — switch them on with the buttons below (morning & evening, on your clock)',
  adhkarValue: (m, e) => [m && 'Morning', e && 'Evening'].filter(Boolean).join(' + ') + ' — on your clock',
  adhkarOn: (slot) => `${slot === 'morning' ? 'Morning' : 'Evening'} adhkar are on in your DMs.`,
  adhkarOffMsg: (slot) => `${slot === 'morning' ? 'Morning' : 'Evening'} adhkar are off.`,
  todayDone: "**You finished today's wird** — may Allah accept it from you",
  progressName: 'Khatma progress',
  progressValue: (bar, pct, cur, total) => `${bar} **${pct}%**\n${cur} / ${total} pages`,
  streakName: 'Streak',
  streakValue: (n, best) => `**${n}** day${n === 1 ? '' : 's'}\nBest: ${best}`,
  khatmasName: 'Khatmas',
  khatmasValue: (n) => `**${n}** completed`,
  readName: 'Pages read',
  readValue: (n) => `**${n}** page${n === 1 ? '' : 's'}`,
  planName: 'Plan',
  planValue: (label, days, eta, free) => `**${label}**\nYou finish in about **${days}** days (${eta})${free ? '\nYour own choice, no fixed period' : ''}`,
  goalName: 'Goal',
  goalOverdue: 'Your goal period has ended. Pick a new one from the menu below; your progress is saved.',
  goalLine: (label, deadline) => `${label} · Deadline \`${deadline}\``,
  goalOnTrack: '**You are on track**',
  goalBehind: (n) => `You need **${n}** pages a day to catch up. Tap “Recalculate my plan”`,
  goalSubEnds: 'Your subscription ends before your goal deadline; renew it for free with one tap to keep the reminders.',
  subName: 'Subscription (free)',
  reminderName: 'Reminder',
  reminderVaried: 'Varies daily\n(morning / afternoon / evening)',
  zoneName: 'Time zone',
  guideName: 'How to use the wird',
  guideValue: [
    '**1.** Choose your plan from the two menus below.',
    '**2.** Tap “Read here” and read page by page.',
    '**3.** Tap “I finished this page” so your progress is saved and the next one arrives. When you finish your wird, the rest arrives tomorrow.'
  ].join('\n'),
  reminderTitle: "It's time for your wird",
  reminderGreeting: 'As-salamu alaykum wa rahmatullahi wa barakatuh',
  reminderFooter: 'A little that lasts is better than a lot that stops',
  streakInline: (n) => `**${n}** day${n === 1 ? '' : 's'} in a row`,
  leftName: 'Left to finish',
  leftValue: (n) => `about **${n}** days`,
  roomReminder: (userId, range) => `<@${userId}> it's time for your wird today: ${range}.\nType \`/help\` → “My daily wird” to see your progress. To get reminders in your DMs, allow direct messages from this server.`,
  statusTitle: 'My daily wird',
  statusFooter: 'Change your plan any time from the two menus below',
  savedTitles: { subscribed: 'Subscribed', welcomeBack: 'Welcome back', settingsSaved: 'Your settings were saved', renewed: 'Your subscription was renewed' },
  saved: (title, days) => `**${title}.** The subscription is free and lasts ${days} days; reminders stop when it ends until you renew with one tap.`,
  readingSaved: (n) => `**${n}** page${n === 1 ? '' : 's'} saved — may Allah accept it from you.`,
  readingDayDone: (streak) => `You finished today's wird. Streak: **${streak}** day${streak === 1 ? '' : 's'}.`,
  readingLeft: "Some of today's wird is left — finish it, God willing.",
  khatmaTitle: 'MashaAllah, you completed the Holy Quran',
  khatmaDesc: (n) => [
    `May Allah bless you and accept from you — this is your khatma number **${n}**.`, '',
    '> O Allah, have mercy on us through the Quran, and make it for us a guide, a light, a guidance and a mercy.',
    '> O Allah, make the Quran the spring of my heart, the light of my chest, the departure of my sorrow and the relief of my worry.',
    '> Our Lord, accept this from us; You are the All-Hearing, the All-Knowing.', '',
    'A new khatma started automatically from page 1. May you always stay on the good.'
  ].join('\n'),
  khatmaAnnounce: (userId, n, days) => `MashaAllah! <@${userId}> completed the Holy Quran (khatma number **${n}**)${days ? ` in **${days}** days` : ''} — may Allah accept from us and from you.`,

  btn: {
    readHere: 'Read here', readNow: 'Read now', settings: 'Settings', editSettings: 'Reminder time & time zone',
    stop: 'Stop reminders', recalc: 'Recalculate my plan', delete: 'Delete my data for good', myProgress: 'My progress',
    renew: 'Renew my subscription for free', renewNow: 'Renew now', resume: 'Resume the wird',
    deleteYes: 'Yes, delete everything', deleteNo: 'Go back',
    adhkarMorning: 'Morning adhkar', adhkarEvening: 'Evening adhkar',
    subscribe: 'Subscribe to the wird', myPlan: 'My plan & progress', readMushaf: 'Read the Mushaf'
  },
  menuDuration: 'Pick a period to finish the Quran',
  menuDurationItem: (label, ppdLabel, days) => ({ label, description: `${ppdLabel} · finishes in ${days} days` }),
  menuDurationOther: { label: 'Another period', description: 'Type any number of days from 7 to 365' },
  menuPages: 'Or choose your own daily pages',
  menuPagesItem: (label, days) => ({ label, description: `Khatma in about ${days} days` }),
  menuPagesOther: { label: 'Another number', description: 'Type your own pages per day, no calculation' },

  modalSubEdit: 'Reminder time and time zone',
  modalSubNew: 'Subscribe to the daily wird',
  fTime: 'Fixed time HH:MM (empty = varies daily)',
  fTimePh: 'Leave empty: morning / afternoon / evening in turn',
  fTz: 'Your country or time zone (e.g. Egypt)',
  fPage: 'Last page you finished (0 = from the start)',
  modalGoal: 'Khatma period',
  fGoal: 'Days to finish the Quran? (7 to 365)',
  fGoalPh: 'Example: 45',
  modalPages: 'My daily pages',
  fPages: 'Pages you read per day? (1 to 100)',
  fPagesPh: 'Example: 5',

  deleteTitle: 'Delete wird data',
  deleteDesc: 'Your subscription, progress, streak and khatmas will be deleted **for good** and cannot be recovered. You will not get any more reminders.\nAre you sure?',
  deletedTitle: 'Deleted',
  deletedDesc: 'Your data was deleted completely and nothing will be sent to you anymore. You can subscribe again whenever you like.',
  expiringTitle: 'Your wird subscription is about to end',
  expiringDesc: (date, rel, days) => `It ends ${date} (${rel}) and the reminders stop then.\nTo continue, renewing is **free** and your progress is kept — one tap extends it by ${days} days.`,
  expiredTitle: 'Your wird subscription has ended',
  expiredDesc: (cur, total) => `Your subscription ended, so the reminders stopped. Your progress is saved (**${cur}** / ${total} pages).\nRenew for free whenever you like to continue where you stopped.`,
  inactiveTitle: 'Wird reminders paused',
  inactiveDesc: (days, cur, total) => `You have not logged your wird for ${days} days, so the reminders were paused so as not to bother you.\nYour progress is saved (**${cur}** / ${total} pages). Tap “Resume the wird” whenever you like to continue, for free.`,
  roomExpiring: (userId, rel) => `<@${userId}> your wird subscription ends ${rel} and the reminders stop then. To renew for free, type \`/help\` → “My daily wird”.`,
  roomExpired: (userId) => `<@${userId}> your wird subscription ended and the reminders stopped. Your progress is saved. To renew for free, type \`/help\` → “My daily wird”.`,
  roomInactive: (userId, days) => `<@${userId}> your wird reminders were paused because you have not logged your wird for ${days} days. To resume them for free, type \`/help\` → “My daily wird”.`,

  panelTitle: 'Daily wird & khatma tracker',
  panelDesc: 'Subscribe **for free** and let the bot remind you of your wird every day and track your progress until you finish the Quran, God willing.',
  panelFields: [
    { name: '1. Subscribe', value: 'Tap **Subscribe to the wird** and enter your country. Leave the time empty to rotate between morning, afternoon and evening, or type a fixed time.' },
    { name: '2. Choose your plan', value: 'Pick a **period** (15 days, 1 month, 2 months, 3 months, 6 months or any period) and the bot works out your pages, or choose your own **pages per day**.' },
    { name: '3. Reminders', value: 'They reach you in your **DMs** (or here if your DMs are closed) with today’s pages and where they are.' },
    { name: '4. Read and log', value: 'Tap **Read**, read inside Discord, and tap “I finished this page” after each page so your progress and streak are saved.' }
  ],
  panelInfoName: 'Good to know',
  panelInfo: (days, inactive) => `The subscription is free and lasts ${days} days. Reminders stop when it ends, or if you stop logging for ${inactive} days. Renew with one tap and your progress is kept; change your plan any time.`,

  expiredPlan: 'Your subscription has ended or is paused — renew it for free, then change your plan.',
  expiredGoal: 'Your subscription has ended or is paused — renew it for free, then pick your period.',
  expiredPages: 'Your subscription has ended or is paused — renew it for free, then pick your pages.',
  notSubscribed: 'You have not subscribed to the daily wird yet. Subscribe for free from the wird panel or from `/help` → “My daily wird”.',
  readerOnly: 'The wird can no longer be logged with a single tap. Tap “Read”, read your pages, and your wird is saved page by page as you finish each one.',
  goalApplied: (label, ppd) => `Your period: ${label}. Your daily wird is now **${ppd}** pages.`,
  goalFaster: (real) => ` At this pace you finish in **${real}** days, which is before the period ends.`,
  goalBadDays: 'Type the number of days as a whole number between 7 and 365, for example `45`',
  pagesApplied: (label, days) => `Your daily wird is now **${label}** as you chose, and at this pace you finish in about **${days}** days.`,
  pagesBad: (max) => `Type the number of pages as a whole number between 1 and ${max}, for example \`5\``,
  noGoal: 'There is no goal set. Pick a khatma period from the “My progress” card.',
  goalEnded: 'The goal period has ended. Pick a new one from the menu below.',
  goalMaxed: (max) => `The plan maximum is ${max} pages a day. Pick a longer period for a realistic goal.`,
  goalRecalc: (n) => `Your daily wird was updated to **${n}** pages so you finish on time.`,
  stopAlready: 'Your subscription is already paused, or you have not subscribed yet.',
  stopped: 'Reminders stopped. Your progress is saved and you can come back any time for free.',
  errTime: 'The reminder time is not valid — example: `20:00`, or leave it empty to vary daily',
  errZone: (typed, maybe = []) => `I did not recognise “${typed}” — type your country or city (e.g. Egypt, Algiers, Saudi Arabia) or \`UTC+1\`${maybe.length ? `\nDid you mean: ${maybe.join(' · ')}?` : ''}`,
  errPage: (max) => `The last page you finished must be between 0 and ${max}`,

  setupNeedManage: 'You need the **Manage Server** permission to use this command.',
  setupNoAccess: (ch) => `I do not have enough permissions in <#${ch}>. I need: **View Channel**, **Send Messages** and **Embed Links**.`,
  setupDoneTitle: 'Wird room is ready',
  setupDone: (ch, announce) => [
    `The subscribe panel was posted in <#${ch}>.`,
    'Reminders reach members in their **DMs**, and if those are closed they are mentioned in this room.',
    `Khatma announcements: ${announce ? 'on' : 'off'}`
  ].join('\n')
};

export const normWirdLang = (lang) => (lang === 'en' ? 'en' : 'ar');
export const wirdText = (lang) => (normWirdLang(lang) === 'en' ? EN : AR);
/** The language a member's own screens use: their stored one (documents saved before it existed read as Arabic). */
export const subLang = (sub) => normWirdLang(sub?.lang);

/**
 * The language of a server's wird, from its settings document. A room set up before panels had a language (it has a
 * channel but no `wird.lang`) holds the Arabic-only panel of the earlier version, so it stays Arabic — otherwise a
 * server that never chose a language (default: English) would flip its Arabic panel to English on upgrade.
 */
export const guildWirdLang = (doc) => normWirdLang(doc?.wird?.lang ?? (doc?.wird?.channelId ? 'ar' : (doc?.language ?? 'en')));
