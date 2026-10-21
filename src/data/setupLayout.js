/**
 * What /setup can build, in ONE language at a time (never a mix): the category, the channels, their topics, the guide
 * message and every sentence /setup says. Pure data + small helpers, so it is easy to read and to test.
 *
 * The admin picks which of the six features to set up; a feature that is not picked gets no channel and is not touched.
 * The Quran and the adhkar texts are Arabic by nature in both languages.
 */

export const SETUP_KEYS = ['start', 'listen', 'adhkar', 'ayah', 'hadith', 'wird'];

const LAYOUT = {
  ar: {
    category: '🕌 القرآن الكريم',
    channels: {
      start:  { name: '📌・ابدأ-من-هنا',      topic: 'دليل استخدام البوت بخطوات بسيطة' },
      listen: { name: '🎧 الاستماع' },
      adhkar: { name: '📿・الأذكار-والأدعية', topic: 'أذكار الصباح والمساء، وذكر أو دعاء قصير على مدار اليوم' },
      ayah:   { name: '📖・آية-اليوم',        topic: 'آية من القرآن الكريم كل يوم' },
      hadith: { name: '📜・حديث-اليوم',       topic: 'حديث من الأربعين النووية ورياض الصالحين كل يوم' },
      wird:   { name: '📚・الورد-اليومي',     topic: 'اشترك مجاناً في الورد اليومي وتابع ختمتك' }
    }
  },
  en: {
    category: '🕌 Holy Quran',
    channels: {
      start:  { name: '📌・start-here',        topic: 'How to use the bot in a few simple steps' },
      listen: { name: '🎧 Listening' },
      adhkar: { name: '📿・adhkar-and-duas',   topic: 'Morning and evening adhkar, plus a short dhikr or dua through the day' },
      ayah:   { name: '📖・verse-of-the-day',  topic: 'A verse from the Holy Quran every day' },
      hadith: { name: '📜・hadith-of-the-day', topic: 'A hadith from the Forty Nawawi and Riyad as-Salihin every day' },
      wird:   { name: '📚・daily-wird',        topic: 'Subscribe for free to the daily wird and follow your khatma' }
    }
  }
};

export const normLang = (lang) => (lang === 'ar' ? 'ar' : 'en');

/**
 * The channels that will be created for this language, in display order.
 * `selected` (an iterable of keys) limits the plan to what the admin picked; leave it out for everything.
 */
export function setupPlan(lang, selected) {
  const l = LAYOUT[normLang(lang)];
  const pick = selected ? new Set(selected) : null;
  return {
    category: l.category,
    items: SETUP_KEYS.filter(k => l.channels[k] && (!pick || pick.has(k))).map(k => ({ key: k, type: k === 'listen' ? 'voice' : 'text', ...l.channels[k] }))
  };
}

/** Keeps only valid keys, in display order (a stale or forged select value can never reach the builder). */
export const cleanSelection = (keys) => { const s = new Set(keys ?? []); return SETUP_KEYS.filter(k => s.has(k)); };

const T = {
  ar: {
    needManage: 'تحتاج صلاحية **إدارة السيرفر** لاستخدام هذا الأمر.',
    botMissing: (p) => `ينقص البوت هذه الصلاحيات: ${p}. أعطه إياها ثم أعد المحاولة.`,
    badZone: (z) => `المنطقة الزمنية \`${z}\` غير صالحة. مثال: \`Africa/Algiers\` أو \`Asia/Riyadh\`.`,
    previewTitle: '🛠️ إعداد القرآن الكريم في السيرفر',
    previewIntro: 'اختر من القائمة ما تريد إعداده، وسأنشئ رومات ما اخترته فقط (ولن أحذف أو أغيّر أي روم موجود عندك):',
    pickerPlaceholder: 'اختر ما تريد إعداده',
    choices: {
      start:  { label: 'ابدأ من هنا', description: 'روم فيه دليل الاستخدام' },
      listen: { label: 'الاستماع', description: 'روم صوتي وفي شاته لوحة التحكم' },
      adhkar: { label: 'الأذكار والأدعية', description: 'أذكار الصباح والمساء وأدعية على مدار اليوم' },
      ayah:   { label: 'آية اليوم', description: 'آية من القرآن كل يوم' },
      hadith: { label: 'حديث اليوم', description: 'حديث من مصادر معروفة كل يوم' },
      wird:   { label: 'الورد اليومي', description: 'لوحة اشتراك ومتابعة الختمة' }
    },
    nothingPicked: '⚠️ لم تختر شيئاً بعد، اختر واحداً على الأقل.',
    notCreating: (names) => `🚫 لن أنشئ: ${names}`,
    category: (n) => `📁 كاتيغوري **${n}**`,
    voiceLine: (n) => `🔊 ${n} — روم صوتي، وفيه لوحة التحكم`,
    textLine: (n, note) => `💬 ${n} — ${note}`,
    notes: {
      start:  'دليل الاستخدام (للقراءة فقط)',
      adhkar: 'أذكار الصباح والمساء وأدعية على مدار اليوم (تُفعَّل تلقائياً)',
      ayah:   'آية كل يوم (تُفعَّل تلقائياً)',
      hadith: 'حديث كل يوم (يُفعَّل تلقائياً)',
      wird:   'الورد اليومي، وفيه لوحة الاشتراك'
    },
    langLine: (l) => `🌐 لغة البوت في السيرفر: **${l}**`,
    zoneLine: (z) => `🌍 المنطقة الزمنية للأذكار: \`${z}\``,
    rerun: 'إن شغّلت الأمر مرة أخرى فلن يتكرر ما أُنشئ، يُكمل الناقص فقط.',
    confirm: '✅ أنشئ', cancel: '✖ إلغاء',
    cancelled: 'أُلغي الإعداد، لم يتغير شيء.',
    timedOut: 'انتهت المهلة دون تأكيد، لم يتغير شيء.',
    busy: 'هناك إعداد جارٍ الآن في هذا السيرفر، انتظر حتى ينتهي ثم أعد المحاولة.',
    working: '⏳ جارٍ الإنشاء…',
    doneTitle: '✅ تم الإعداد',
    created: 'أُنشئ', reused: 'موجود مسبقاً',
    listenPanel: (ok, ch) => ok ? `🎛️ لوحة التحكم أُرسلت في ${ch}` : `⚠️ تعذّر إرسال لوحة التحكم في ${ch}، استخدم \`/start\` وأنت في الروم الصوتي.`,
    adhkarDone: (ch, z) => `📿 الأذكار والأدعية تُنشر تلقائياً في ${ch} (المنطقة الزمنية \`${z}\`). للتخصيص: \`/setup\` ← «الأذكار»`,
    ayahDone: (ch) => `📖 آية اليوم تُنشر في ${ch}`,
    hadithDone: (ch) => `📜 حديث اليوم يُنشر في ${ch}`,
    wirdDone: (ch) => `📚 لوحة الاشتراك في الورد نُشرت في ${ch}`,
    nothingCreatedNew: 'كل ما اخترته موجود مسبقاً، لم أنشئ شيئاً جديداً.',
    lockLeaks: (list) => `⚠️ هذه الرتب أو الأعضاء لديهم استثناء خاص يسمح لهم بالكتابة رغم القفل، عدّلوه من صلاحيات الروم إن لم يكن مقصوداً:\n${list}`,
    lockFailed: (chs) => `⚠️ تعذّر منع الكتابة في: ${chs}. أعطِ البوت صلاحية **إدارة الرتب** (أو عدّل صلاحيات الروم يدوياً: امنع «الجميع» من «إرسال الرسائل») ثم أعد الأمر.`,
    failed: (what) => `تعذّر إكمال الإعداد (${what}). ما أُنشئ قبل الخطأ باقٍ، ويمكنك إعادة الأمر ليُكمل الناقص.`,
    guideTitle: '🕌 ابدأ من هنا',
    guideDesc: 'كل شيء يعمل بأزرار وقوائم، ولا تحتاج حفظ أي أمر.',
    guideSteps: (listen) => [
      listen ? `**١. ادخل ${listen}** — ستجد لوحة التحكم في الشات الخاص بالروم الصوتي.` : '**١. ادخل أي روم صوتي** واكتب `/start` لتصلك لوحة التحكم.',
      '**٢. اضغط** «ابدأ ختمة» أو «إذاعة مباشرة»، أو اختر أي سورة من القائمة.',
      '**٣. تحكّم** من اللوحة: إيقاف مؤقت، التالية، الصوت، الخروج.'
    ].join('\n'),
    guideCmds: ['`/start` — أرسل لوحة التحكم إلى رومي الصوتي (كل شيء فيها بالأزرار: السور، الختمة، الإذاعة، الحفظ، مؤقت النوم)', '`/help` — المصحف والورد وباقي القائمة', '`/setup` — إعدادات السيرفر (للمشرفين)'].join('\n'),
    guideCmdsTitle: '⌨️ الأوامر',
    guideRooms: 'الرومات',
    guideFooter: 'تقبّل الله منا ومنكم'
  },
  en: {
    needManage: 'You need the **Manage Server** permission to use this command.',
    botMissing: (p) => `The bot is missing these permissions: ${p}. Give them to it and try again.`,
    badZone: (z) => `The time zone \`${z}\` is not valid. Example: \`Africa/Algiers\` or \`Asia/Riyadh\`.`,
    previewTitle: '🛠️ Set up the Holy Quran in this server',
    previewIntro: 'Choose from the menu what you want to set up. I will create channels only for what you pick (and I will not delete or change any channel you already have):',
    pickerPlaceholder: 'Choose what to set up',
    choices: {
      start:  { label: 'Start here', description: 'A channel with the how-to guide' },
      listen: { label: 'Listening', description: 'A voice channel with the control panel in its chat' },
      adhkar: { label: 'Adhkar and duas', description: 'Morning and evening adhkar plus duas through the day' },
      ayah:   { label: 'Verse of the day', description: 'A verse from the Quran every day' },
      hadith: { label: 'Hadith of the day', description: 'A hadith from well-known sources every day' },
      wird:   { label: 'Daily wird', description: 'A subscribe panel and khatma tracking' }
    },
    nothingPicked: '⚠️ You have not picked anything yet. Pick at least one.',
    notCreating: (names) => `🚫 I will not create: ${names}`,
    category: (n) => `📁 Category **${n}**`,
    voiceLine: (n) => `🔊 ${n} — a voice channel, with the control panel in its chat`,
    textLine: (n, note) => `💬 ${n} — ${note}`,
    notes: {
      start:  'the how-to guide (read-only)',
      adhkar: 'morning and evening adhkar plus a short dhikr or dua through the day (turned on automatically)',
      ayah:   'a verse every day (turned on automatically)',
      hadith: 'a hadith every day (turned on automatically)',
      wird:   'the daily wird, with the subscribe panel'
    },
    langLine: (l) => `🌐 Bot language in this server: **${l}**`,
    zoneLine: (z) => `🌍 Time zone for the adhkar: \`${z}\``,
    rerun: 'Running it again will not duplicate anything; it only fills in what is missing.',
    confirm: '✅ Create', cancel: '✖ Cancel',
    cancelled: 'Setup cancelled. Nothing was changed.',
    timedOut: 'No confirmation in time. Nothing was changed.',
    busy: 'A setup is already running on this server. Wait for it to finish, then try again.',
    working: '⏳ Creating…',
    doneTitle: '✅ Setup complete',
    created: 'Created', reused: 'Already existed',
    listenPanel: (ok, ch) => ok ? `🎛️ The control panel was sent to ${ch}` : `⚠️ I could not send the control panel to ${ch}. Use \`/start\` while in the voice channel.`,
    adhkarDone: (ch, z) => `📿 Adhkar and duas are posted automatically in ${ch} (time zone \`${z}\`). To customise: \`/setup\` → “Adhkar”`,
    ayahDone: (ch) => `📖 The verse of the day is posted in ${ch}`,
    hadithDone: (ch) => `📜 The hadith of the day is posted in ${ch}`,
    wirdDone: (ch) => `📚 The wird subscribe panel was posted in ${ch}`,
    nothingCreatedNew: 'Everything you picked already existed, so I did not create anything new.',
    lockLeaks: (list) => `⚠️ These roles or members have their own permission that lets them write despite the lock. Change it in the channel's permissions if it is not intended:\n${list}`,
    lockFailed: (chs) => `⚠️ I could not stop members from writing in: ${chs}. Give the bot the **Manage Roles** permission (or deny @everyone “Send Messages” in the channel by hand) and run the command again.`,
    failed: (what) => `Setup could not finish (${what}). Whatever was created before the error stays, and running the command again fills in the rest.`,
    guideTitle: '🕌 Start here',
    guideDesc: 'Everything works with buttons and menus — no commands to memorise.',
    guideSteps: (listen) => [
      listen ? `**1. Join ${listen}** — the control panel is in that voice channel's chat.` : '**1. Join any voice channel** and type `/start` to get the control panel.',
      '**2. Press** “Start a Khatma” or “Live radio”, or pick any surah from the menu.',
      '**3. Control it** from the panel: pause, next, volume, leave.'
    ].join('\n'),
    guideCmds: ['`/start` — send the control panel to my voice channel (everything is buttons: surahs, Khatma, radio, memorize, sleep timer)', '`/help` — the Mushaf, the wird and the rest of the menu', '`/setup` — server settings (admins)'].join('\n'),
    guideCmdsTitle: '⌨️ Commands',
    guideRooms: 'Channels',
    guideFooter: 'May Allah accept from us and from you'
  }
};
export const setupText = (lang) => T[normLang(lang)];
export const langName = (lang) => (normLang(lang) === 'ar' ? 'العربية' : 'English');

/** The guide posted in the "start here" channel; `ids` = { listen, adhkar, ayah, hadith, wird } channel ids. */
export function guideContent(lang, ids) {
  const t = T[normLang(lang)];
  const rooms = [
    ids.listen && `🎧 <#${ids.listen}>`,
    ids.adhkar && `📿 <#${ids.adhkar}>`,
    ids.ayah   && `📖 <#${ids.ayah}>`,
    ids.hadith && `📜 <#${ids.hadith}>`,
    ids.wird   && `📚 <#${ids.wird}>`
  ].filter(Boolean).join('\n');
  return {
    title: t.guideTitle,
    description: `${t.guideDesc}\n\n${t.guideSteps(ids.listen ? `<#${ids.listen}>` : '')}`,
    fields: [
      { name: t.guideCmdsTitle, value: t.guideCmds },
      { name: t.guideRooms, value: rooms || '—' }
    ],
    footer: t.guideFooter
  };
}
