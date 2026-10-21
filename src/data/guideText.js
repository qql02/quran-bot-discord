/**
 * The user guide: pure text, one entry per topic, in Arabic and English. Shown by /guide and by the "User guide" button of /help.
 * Keep each body under ~1500 characters (one Discord embed) and the topic count at 25 or fewer (one select menu).
 * test/guide.test.js checks both, and that every command of the bot is explained.
 */
export const GUIDE_TOPICS = [
  {
    key: 'start',
    ar: { label: 'البدء السريع', desc: 'من الصفر إلى أول تلاوة في دقيقة',
      body: [
        '**١.** ادخل **روماً صوتياً**.',
        '**٢.** اكتب `/recite` واختر **السورة** — أو اكتب **اسم قارئ** فقط ليتلو القرآن كاملاً.',
        '**٣.** تظهر لك **لوحة التشغيل** في الشات: أزرار وقوائم لكل شيء بعدها.',
        '',
        'وإن أحببت الأزرار فقط: اكتب `/start` وستصلك اللوحة، واختر السورة من القائمة.',
        'للتحكم دون لوحة: `/hold` `/continue` `/next` `/volume` `/leave`.',
        'انتقلت إلى روم صوتي آخر؟ اكتب `/pull` فيأتي إليك البوت ويكمل من نفس النقطة.',
        '',
        'نصيحة: البوت يغادر وحده بعد **5 دقائق** من الصمت، و**15 دقيقة** من الإيقاف المؤقت، وخلال **30 ثانية** إن خلا الروم من الناس.'
      ].join('\n') },
    en: { label: 'Quick start', desc: 'From zero to the first recitation in a minute',
      body: [
        '**1.** Join a **voice room**.',
        '**2.** Type `/recite` and pick the **surah** — or type just a **reciter\'s name** to hear the whole Quran by him.',
        '**3.** The **player panel** appears in the chat: buttons and menus for everything after that.',
        '',
        'Prefer buttons only? Type `/start` and pick the surah from the menu.',
        'Control without the panel: `/hold` `/continue` `/next` `/volume` `/leave`.',
        'Moved to another voice room? Type `/pull` and the recitation follows you, from the same point.',
        '',
        'Tip: The bot leaves by itself after **5 minutes** of silence, **15 minutes** paused, or **30 seconds** after the room empties.'
      ].join('\n') }
  },
  {
    key: 'commands',
    ar: { label: 'كل الأوامر', desc: 'ما يفعله كل أمر',
      body: [
        '`/start` — لوحة التشغيل في شات روم صوتي',
        '`/recite` — سورة و/أو قارئ بالبحث بالاسم (قارئ بلا سورة = القرآن كاملاً)',
        '`/khatma` — القرآن كاملاً بالترتيب، من أي سورة وبأي قارئ',
        '`/live` — إذاعة قرآنية مباشرة · `/memorize` — تكرار سورة للحفظ · `/sleep` — إيقاف تلقائي',
        '`/hold` — إيقاف مؤقت · `/continue` — متابعة',
        '`/next` — تخطي للسورة التالية',
        '`/volume` — الصوت من 0 إلى 150 (100 = عادي)',
        '`/leave` — إيقاف التلاوة والخروج من الروم',
        '`/now` — ما يُشغَّل الآن · `/queue` — القائمة · `/clearqueue` — مسحها',
        '`/mushaf` — المصحف (نص أو صور حفص وورش) · `/stats` — إحصائيات السيرفر · `/invite` — رابط البوت',
        '`/azkar` — أذكار وأدعية حصن المسلم: اكتب اسم الباب واختره من القائمة',
        '`/hadith` — حديث نبوي من الكتب الستة: اختر الكتاب وأدخل الرقم (أو اتركه عشوائيًا)',
        '`/hijri` — التاريخ الهجري اليوم مع الميلادي (تقويم أم القرى، ويمكن تعديله بيوم أو يومين)',
        '`/journey` — رحلة قرآنية مع موضوع (الصبر، الرجاء، الشكر…): آية وتفسير ووقفة، مع حفظ الصفحة وفتحها في المصحف',
        '`/help` — قائمة الأعضاء: المصحف، الورد، الإحصائيات، الدعم',
        '`/guide` — هذا الدليل',
        '`/setup` — إعدادات السيرفر (للمشرفين)',
        '`/cleardm` — يحذف رسائل البوت (ورسائلك إن سمح ديسكورد) من خاصك',
        '',
        'والمفضلة **أزرار وقوائم** داخل اللوحة (⚙ أدوات).'
      ].join('\n') },
    en: { label: 'All commands', desc: 'What each command does',
      body: [
        '`/start` — the player panel in a voice room\'s chat',
        '`/recite` — a surah and/or a reciter found by name (reciter only = the whole Quran)',
        '`/khatma` — the whole Quran in order, from any surah and by any reciter',
        '`/live` — a live Quran radio · `/memorize` — repeat a surah to learn it · `/sleep` — stop automatically',
        '`/hold` — pause · `/continue` — resume',
        '`/next` — skip to the next surah',
        '`/volume` — volume 0 to 150 (100 = normal)',
        '`/leave` — stop and leave the room',
        '`/now` — what is playing · `/queue` — the queue · `/clearqueue` — empty it',
        '`/mushaf` — the Mushaf (text or Hafs / Warsh images) · `/stats` — server stats · `/invite` — the bot link',
        '`/azkar` — Hisn al-Muslim adhkar & du\'a: type a chapter name and pick it from the list',
        '`/hadith` — a hadith from the six books: pick the book and a number (or leave it random)',
        '`/hijri` — today\'s Hijri date with the Gregorian one (Umm al-Qura; adjustable by a day or two)',
        '`/journey` — a guided Quran journey on a topic (patience, hope, gratitude…): verse, tafsir and a reflection; save the page or open it in the Mushaf',
        '`/help` — the members\' menu: Mushaf, wird, stats, support',
        '`/guide` — this guide',
        '`/setup` — server settings (admins)',
        '`/cleardm` — deletes the bot\'s messages (and yours, if Discord allows) from your DMs',
        '',
        'Favourites are **buttons and menus** inside the panel (Tools).'
      ].join('\n') }
  },
  {
    key: 'dm',
    ar: { label: 'الأوامر في الخاص', desc: 'اقرأ القرآن دون العودة للسيرفر',
      body: [
        'راسل البوت في **الخاص** واكتب الأمر بعد العلامة `{prefix}` — لا حاجة للعودة إلى السيرفر:',
        '`{prefix}مصحف` يفتح المصحف عند وردك',
        '`{prefix}صفحة 45` · `{prefix}سورة الكهف` · `{prefix}جزء 5` للقراءة مباشرة',
        '`{prefix}اية 2:255` آية مع التفسير الميسر، و`{prefix}اية` وحدها لآية عشوائية',
        '`{prefix}حديث` حديث من الأربعين النووية ورياض الصالحين، و`{prefix}حديث 13` للحديث رقم 13 من الأربعين النووية',
        '`{prefix}اذكار` أذكار الصباح، و`{prefix}اذكار مساء` أذكار المساء',
        '`{prefix}ادعية` موسوعة الأدعية والأذكار (حصن المسلم والقرآن الكريم): `{prefix}ادعية 12` لفتح باب، `{prefix}ادعية سفر` للبحث',
        '`{prefix}ورد` الاشتراك في الورد أو تقدمك فيه',
        '`{prefix}علامة 45` تحفظ صفحة، و`{prefix}احفظ 2:255` تحفظ آية، في **قائمتك الشخصية**',
        '`{prefix}قائمتي` تعرضها · `{prefix}افتح 1` تفتح عنصراً · `{prefix}ازل 1` تحذفه',
        '`{prefix}اعدادات` · `{prefix}بياناتي` · `{prefix}تصدير` · `{prefix}انسني` — إعداداتك وبياناتك وحذفها (التفاصيل في موضوع «حسابي في الخاص»)',
        '`{prefix}مساعدة` قائمة كل الأوامر · `{prefix}دليل` هذا الدليل · `{prefix}دعوة` رابط البوت · `{prefix}مسح` حذف رسائل البوت',
        '',
        'قائمتك لك وحدك: محفوظة باسم حسابك فقط، لا ترتبط بأي سيرفر ولا يراها أحد، وأوامر العلامة لا تعمل داخل السيرفرات إطلاقاً.',
        'أوامر الخاص للقراءة والمعلومات فقط؛ التلاوة والتحكم بالصوت في السيرفر. لكل أمر اسم إنجليزي أيضاً: `{prefix}help` `{prefix}page` `{prefix}surah` `{prefix}juz` `{prefix}ayah` `{prefix}hadith` `{prefix}adhkar` `{prefix}dua` `{prefix}wird`.'
      ].join('\n') },
    en: { label: 'Commands in DMs', desc: 'Read the Quran without going back to the server',
      body: [
        'Message the bot **privately** and type the command after the `{prefix}` sign — no need to go back to a server:',
        '`{prefix}mushaf` opens the Mushaf (free, no subscription)',
        '`{prefix}page 45` · `{prefix}surah kahf` · `{prefix}juz 5` to read straight away',
        '`{prefix}ayah 2:255` a verse with its tafsir, or `{prefix}ayah` alone for a random one',
        '`{prefix}hadith` a hadith from the Forty Nawawi and Riyad as-Salihin, or `{prefix}hadith 13` for Nawawi no. 13',
        '`{prefix}adhkar` morning adhkar, `{prefix}adhkar evening` for the evening ones',
        '`{prefix}dua` the du\'a & adhkar library (Hisn al-Muslim and the Qur\'an): `{prefix}dua 12` opens a chapter, `{prefix}dua سفر` searches',
        '`{prefix}wird` subscribe to the wird or see your progress',
        '`{prefix}mark 45` saves a page and `{prefix}save 2:255` saves a verse, in your **personal list**',
        '`{prefix}mine` shows it · `{prefix}open 1` opens an item · `{prefix}remove 1` deletes it',
        '`{prefix}settings` · `{prefix}mydata` · `{prefix}export` · `{prefix}forget` — your settings, your data and its deletion (details in the "My account in DMs" topic)',
        '`{prefix}help` all the commands · `{prefix}guide` this guide · `{prefix}invite` the bot link · `{prefix}clear` delete the bot\'s messages',
        '',
        'Your list is yours alone: stored under your account only, tied to no server, seen by no one, and these commands never work inside servers.',
        'DM commands are for reading and information only; recitation and voice control are in the server. Every command also has an Arabic name: `{prefix}مساعدة` `{prefix}صفحة` `{prefix}سورة` `{prefix}جزء` `{prefix}اية` `{prefix}اذكار` `{prefix}ورد`.'
      ].join('\n') }
  },
  {
    key: 'account',
    ar: { label: 'حسابي في الخاص', desc: 'إعداداتك وبياناتك وحذفها',
      body: [
        'كل هذه الأوامر في **الخاص** فقط، وتخصّ حسابك وحده ولا تؤثر على أي سيرفر:',
        '`{prefix}اعدادات` تعرض إعداداتك الحالية',
        '`{prefix}اعدادات لغة عربي` أو `{prefix}اعدادات لغة en` — لغة ردود البوت لك (تتغلب على لغة الكلمة التي تكتبها)',
        '`{prefix}اعدادات عرض نص` · `حفص` · `ورش` — نمط المصحف',
        '`{prefix}اعدادات اعادة` — يرجع الإعدادات للافتراضي وتبقى قائمتك',
        '`{prefix}بياناتي` — كل ما هو محفوظ باسم حسابك: الإعدادات، قائمتك، اشتراك الورد وتقدمك، ومفضلة المشغّل (أعداد فقط)',
        '`{prefix}تصدير` — نسخة من بياناتك كملف. يُعرض عليك ما سيُرسل أولاً، ولا يُرسل شيء قبل أن تكتب `{prefix}تصدير تأكيد` خلال دقيقتين',
        '`{prefix}انسني` — يعرض ما سيُحذف. ثم `{prefix}انسني تأكيد` يحذف بياناتك الشخصية (قائمتك والإعدادات والمفضلة)، و`{prefix}انسني الكل تأكيد` يحذف معها اشتراك الورد وتقدمك وتتوقف التذكيرات',
        '',
        'الحذف نهائي، والتأكيد يُقبل مرة واحدة خلال دقيقتين من الشاشة التي سبقته. خذ نسخة بـ `{prefix}تصدير` قبل الحذف إن أردت.'
      ].join('\n') },
    en: { label: 'My account in DMs', desc: 'Your settings, your data and deleting it',
      body: [
        'These commands work in **private chat** only, concern your account alone and affect no server:',
        '`{prefix}settings` shows your current settings',
        '`{prefix}settings lang ar` or `{prefix}settings lang en` — the language the bot replies to you in (it wins over the language of the word you type)',
        '`{prefix}settings view text` · `hafs` · `warsh` — Mushaf view',
        '`{prefix}settings reset` — back to the defaults; your list stays',
        '`{prefix}mydata` — everything stored under your account: settings, your list, your wird subscription and progress, and player favourites (counts only)',
        '`{prefix}export` — a copy of your data as a file. It first shows what would be sent, and nothing is sent until you type `{prefix}export confirm` within two minutes',
        '`{prefix}forget` — shows what would be deleted. Then `{prefix}forget confirm` deletes your personal data (list, settings, favourites), and `{prefix}forget all confirm` also removes the wird subscription and progress, and reminders stop',
        '',
        'Deletion is permanent, and a confirmation counts once, within two minutes of the screen before it. Take a copy with `{prefix}export` first if you want one.'
      ].join('\n') }
  },
  {
    key: 'reciters',
    ar: { label: 'القرّاء والروايات', desc: 'البحث عن قارئ وتغيير الرواية',
      body: [
        '**بالأمر:** `/recite` ثم اكتب في خانة `reciter` جزءاً من الاسم (مثل «عفاسي» أو «husary») — تظهر الأسماء أثناء الكتابة والمفضلون أولاً.',
        'إن لم يوجد القارئ يخبرك البوت ويقترح أسماء قريبة، ولا يشغّل غيره بصمت.',
        '',
        '**من اللوحة:** قائمة **القارئ** فيها 10 قرّاء مشهورين و«قارئ آخر…»، و** أدوات ← قارئ آخر أو رواية** يبحث بالاسم و/أو الرواية (حفص، ورش، قالون، الدوري…).',
        '',
        'اختيارك من اللوحة **يُحفظ للسيرفر** ويبقى بعد إعادة التشغيل، ويُستخدم في كل ما يُشغَّل بعده من اللوحة وفي `/recite` بلا قارئ.',
        'إن لم يملك القارئ السورة المطلوبة يخبرك البوت لتختار غيره.'
      ].join('\n') },
    en: { label: 'Reciters & narrations', desc: 'Find a reciter, change the narration',
      body: [
        '**By command:** `/recite`, then type part of the name in the `reciter` field (e.g. "afasy" or "husary") — names appear as you type, favourites first.',
        'If the reciter does not exist the bot says so and suggests close names; it never plays someone else silently.',
        '',
        '**From the panel:** the **reciter** menu has 10 famous reciters and "Another reciter…"; **Tools → Another reciter / narration** searches by name and/or narration (Hafs, Warsh, Qalon, Doori…).',
        '',
        'A choice made in the panel is **saved for the server**, survives restarts, and is used for everything started from the panel afterwards and for `/recite` without a reciter.',
        'If the reciter lacks the surah you asked for, the bot tells you so you can pick another.'
      ].join('\n') }
  },
  {
    key: 'khatma',
    ar: { label: 'الختمة والقرآن كاملاً', desc: 'من الفاتحة إلى الناس بلا توقف',
      body: [
        '**أسرع طريقة:** `/khatma` (والقارئ والسورة اختياريان)، أو `/recite` باسم القارئ **دون سورة**.',
        '**من اللوحة:** زر **ابدأ ختمة من الفاتحة** — بصوت القارئ الحالي.',
        '',
        'تُشغَّل 114 سورة بالترتيب دون توقف.',
        'تنبيه: بدء الختمة **يستبدل قائمة الانتظار** الحالية.',
        '',
        'لإنهائها: `/leave`، أو زر **خروج** في اللوحة. وللتخطي: `/next`.'
      ].join('\n') },
    en: { label: 'Khatma — the whole Quran', desc: 'Al-Fatiha to An-Nas, non-stop',
      body: [
        '**Fastest:** `/khatma` (reciter and starting surah are optional), or `/recite` with the reciter\'s name **without a surah**.',
        '**From the panel:** the **Start a Khatma** button — with the current reciter.',
        '',
        'All 114 surahs play in order, non-stop.',
        'Note: Starting a Khatma **replaces the current queue**.',
        '',
        'To end it: `/leave`, or the **Leave** button on the panel. To skip: `/next`.'
      ].join('\n') }
  },
  {
    key: 'queue',
    ar: { label: 'قائمة الانتظار والتكرار', desc: 'أضف سوراً وتحكم بالترتيب',
      body: [
        'كل `/recite` بسورة **يضيف** للقائمة إن كان هناك تشغيل جارٍ، ويبدأ فوراً إن لم يكن.',
        'اختيار سورة من قائمة اللوحة يفعل الشيء نفسه.',
        '',
        '`/queue` أو **زر القائمة** (Up next) يعرض ما بعد الحالية، و`/clearqueue` أو «مسح القائمة» يفرغها. `/now` يعرض ما يُشغَّل الآن.',
        '**التكرار** يعيد السورة الحالية بلا نهاية؛ **التالي** يتخطى.',
        '',
        'سعة القائمة حتى **100** سورة.'
      ].join('\n') },
    en: { label: 'Queue & repeat', desc: 'Add surahs and control the order',
      body: [
        'Each `/recite` with a surah **adds** to the queue when something is playing, and starts at once otherwise.',
        'Picking a surah from the panel\'s menu does the same.',
        '',
        '`/queue` or the **Up next** button lists what comes next; `/clearqueue` or "Clear the queue" empties it. `/now` shows what is playing.',
        '**Repeat** loops the current surah forever; **Next** skips.',
        '',
        'The queue holds up to **100** surahs.'
      ].join('\n') }
  },
  {
    key: 'memorize',
    ar: { label: 'وضع الحفظ', desc: 'كرّر سورة للحفظ',
      body: [
        '**بالأمر:** `/memorize` ثم السورة وعدد التكرار. **أو من اللوحة:** أدوات ← وضع الحفظ.',
        '**١.** اختر **عدد التكرار** (3 · 5 · 7 · 10 · 20 · 30 · 50).',
        '**٢.** اختر **السورة** — تبدأ فوراً بصوت القارئ الحالي وتتكرر بفاصل 3 ثوانٍ.',
        '',
        'نصيحة: غيّر القارئ أولاً (من قائمة القارئ) إن أردت الحفظ على صوت شيخ بعينه.',
        'الحفظ والختمة والتكرار لا تعمل معاً: تشغيل أحدها يوقف الآخر.'
      ].join('\n') },
    en: { label: 'Memorize mode', desc: 'Repeat a surah to learn it',
      body: [
        '**By command:** `/memorize`, then the surah and the repetitions. **Or from the panel:** Tools → Memorize.',
        '**1.** Pick the **repetitions** (3 · 5 · 7 · 10 · 20 · 30 · 50).',
        '**2.** Pick the **surah** — it starts at once with the current reciter and repeats 3 seconds apart.',
        '',
        'Tip: Change the reciter first (reciter menu) to memorize with a particular sheikh.',
        'Memorize, Khatma and repeat do not run together: starting one stops the other.'
      ].join('\n') }
  },
  {
    key: 'sleep',
    ar: { label: 'مؤقت النوم', desc: 'إيقاف تلقائي',
      body: [
        '**بالأمر:** `/sleep`. **أو من اللوحة:** أدوات ← مؤقت النوم.',
        'اختر: بعد **10** أو **30** أو **60** دقيقة، أو **بعد انتهاء السورة الحالية**، أو **إلغاء المؤقت**.',
        '',
        'عند انتهاء المدة يتوقف البوت ويخرج من الروم.',
        'الإذاعة لا تنتهي وحدها، لذلك اختر معها مدة.'
      ].join('\n') },
    en: { label: 'Sleep timer', desc: 'Stop automatically',
      body: [
        '**By command:** `/sleep`. **Or from the panel:** Tools → Sleep timer.',
        'Choose **10**, **30** or **60** minutes, **after the current surah**, or **cancel the timer**.',
        '',
        'When the time is up the bot stops and leaves the room.',
        'Radio never ends by itself, so pick a duration with it.'
      ].join('\n') }
  },
  {
    key: 'radio',
    ar: { label: 'الإذاعة المباشرة', desc: 'محطات القرآن على مدار الساعة',
      body: [
        'بالأمر: `/live` واكتب اسم المحطة. أو من اللوحة: زر **إذاعة مباشرة** أو **أدوات ← إذاعة**، ثم اختر محطة.',
        'محطات هذا السيرفر · محطات عامة · الإذاعات القرآنية. **تُعرض المحطات التي تبث الآن فقط**، والقائمة تتحدث كل بضع دقائق.',
        '',
        '**للمشرفين:** أضف محطتك الخاصة من `/setup` ← «المحطات» (رابط بث مباشر صوتي).',
        '',
        'لا توجد سورة «تالية» في الإذاعة؛ استخدم مؤقت النوم أو `/leave` للإنهاء.'
      ].join('\n') },
    en: { label: 'Live radio', desc: 'Quran stations around the clock',
      body: [
        'By command: `/live` and type the station\'s name. Or from the panel: the **Live radio** button or **Tools → Radio**, then pick a station.',
        'This server\'s stations · public · Quran radios. **Only stations on the air right now are listed**, and the list refreshes every few minutes.',
        '',
        '**Admins:** add your own station from `/setup` → "Stations" (a live audio stream link).',
        '',
        'Radio has no "next surah"; use the sleep timer or `/leave` to end it.'
      ].join('\n') }
  },
  {
    key: 'controls',
    ar: { label: 'التحكم والصوت', desc: 'إيقاف، تخطي، صوت، خروج',
      body: [
        '**بالأوامر** (لمن هو في **نفس الروم** مع البوت):',
        '`/hold` إيقاف مؤقت · `/continue` متابعة · `/next` تخطي · `/volume` الصوت · `/leave` خروج.',
        '',
        '**بالأزرار** في اللوحة: إيقاف مؤقت/استئناف · التالية · تكرار · الصوت − / + · خروج.',
        '',
        'مدى الصوت من **0 إلى 150%** (100 = عادي).',
        'من خارج الروم الصوتي لا يمكن التحكم بالتلاوة، حمايةً من العبث.'
      ].join('\n') },
    en: { label: 'Controls & volume', desc: 'Pause, skip, volume, leave',
      body: [
        '**By command** (for people in the **same room** as the bot):',
        '`/hold` pause · `/continue` resume · `/next` skip · `/volume` volume · `/leave` leave.',
        '',
        '**By buttons** on the panel: Pause/Resume · Next · Repeat · Volume − / + · Leave.',
        '',
        'Volume ranges **0 to 150%** (100 = normal).',
        'People outside the voice room cannot control playback — protection against abuse.'
      ].join('\n') }
  },
  {
    key: 'favorites',
    ar: { label: 'المفضلة والإحصائيات', desc: 'سورك وقرّاؤك، وإحصائيات السيرفر',
      body: [
        '**أدوات ← مفضلتي:** أثناء التشغيل اضغط «أضف السورة الحالية» أو «أضف القارئ الحالي».',
        'ثم شغّل أي سورة من مفضلتك بضغطة. المفضلة **خاصة بك** في كل سيرفر، والمفضلون يظهرون أولاً في بحث القرّاء.',
        '',
        '**الإحصائيات:** `/help` ← «إحصائيات السيرفر»: السور المُشغَّلة، وقت التلاوة، الجلسات، الأكثر تشغيلاً.'
      ].join('\n') },
    en: { label: 'Favourites & stats', desc: 'Your surahs and reciters, server stats',
      body: [
        '**Tools → My favourites:** while playing, press "Save this surah" or "Save this reciter".',
        'Then play any of your saved surahs in one tap. Favourites are **yours** in each server, and favourite reciters come first in the reciter search.',
        '',
        '**Stats:** `/help` → "Server stats": surahs played, listening time, sessions, most played.'
      ].join('\n') }
  },
  {
    key: 'mushaf',
    ar: { label: 'المصحف', desc: 'اقرأ المصحف صفحة صفحة',
      body: [
        '`/mushaf` أو `/help` ← **المصحف**. وفي الخاص `{prefix}مصحف`.',
        'تقرأ **604 صفحات** بنص الصفحة أو **صورة المصحف** (حفص أو ورش)، وتنتقل بالصفحة أو السورة أو الجزء («جزء 5»).',
        '',
        'المصحف **مفتوح للجميع** بلا اشتراك؛ وتبدّل بين النص وصورتي حفص وورش بأزرار تحت الصفحة (ويتذكّر البوت اختيارك).',
        'للقراءة اليومية بمتابعة تقدمك اكتب في الخاص `{prefix}ورد` (الاشتراك **مجاني**، 30 يوماً): يفتح عند صفحة وردك ويحفظ كل صفحة تنهيها.'
      ].join('\n') },
    en: { label: 'The Mushaf', desc: 'Read the Mushaf page by page',
      body: [
        '`/mushaf` or `/help` → **Mushaf**. In DMs: `{prefix}mushaf`.',
        'Read **604 pages** as text or as the **Mushaf image** (Hafs or Warsh), and jump by page, surah or juz ("juz 5").',
        '',
        'The Mushaf is **open to everyone**, no subscription; switch between text and the Hafs / Warsh page images with the buttons under the page (the bot remembers your choice).',
        'For daily reading with progress type `{prefix}wird` in DMs (subscribing is **free**, 30 days): it opens at your wird page and saves every page you finish.'
      ].join('\n') }
  },
  {
    key: 'wird',
    ar: { label: 'الورد اليومي', desc: 'خطة ختمة بتذكير على الخاص',
      body: [
        '`/help` ← **وردي اليومي** ← اشترك مجاناً.',
        '',
        '• اختر **مدة الختمة** أو **صفحاتك اليومية**، ويحسب البوت الباقي.',
        '• يصلك **تذكير على الخاص** بتوقيت بلدك (اكتب بلدك أو مدينتك بالعربي أو الإنجليزي).',
        '• تتابع **سلسلة الأيام** وتاريخ الختم المتوقع، ويوم الجمعة تنبيه **سورة الكهف**.',
        '• اختياري: **أذكار الصباح والمساء** على الخاص.',
        '',
        'الاشتراك 30 يوماً ويُجدَّد **مجاناً بضغطة**، وتتوقف التذكيرات وحدها إن لم تقرأ 7 أيام. تقدمك يبقى محفوظاً دائماً.'
      ].join('\n') },
    en: { label: 'Daily wird', desc: 'A Khatma plan with DM reminders',
      body: [
        '`/help` → **My daily wird** → subscribe free.',
        '',
        '• Choose the **Khatma period** or your **pages per day**; the bot works out the rest.',
        '• A **DM reminder** arrives at your local time (type your country or city).',
        '• Track your **streak** and expected finish date; on Fridays a **Surah Al-Kahf** reminder.',
        '• Optional: **morning and evening adhkar** in DMs.',
        '',
        'The subscription lasts 30 days and renews **free in one tap**; reminders stop on their own after 7 days without reading. Your progress is always kept.'
      ].join('\n') }
  },
  {
    key: 'admin',
    ar: { label: 'للمشرفين: /setup', desc: 'الأذكار، آية اليوم، حديث اليوم، الفعاليات، الرومات',
      body: [
        '`/setup` (يحتاج صلاحية **إدارة السيرفر**) — بطاقة واحدة بقائمة:',
        '**الأذكار** صباحاً ومساءً وطوال اليوم · **آية اليوم** مع التفسير · **حديث اليوم** من الأربعين النووية ورياض الصالحين',
        '**الفعاليات** (رمضان، الجمعة…) · **غرفة الورد** · **محطات الراديو**',
        '**اللغة** (العربية / English) · **إنشاء الرومات** تلقائياً',
        '',
        'لكل صفحة زر للعودة، والبطاقة **لا تنتهي صلاحيتها**.',
        'نصيحة: ابدأ بـ «إنشاء الرومات» ليجهّز البوت الرومات المناسبة، ثم فعّل ما تريد.',
        'يحتاج البوت صلاحية النشر في الروم المختار (عرض القناة، إرسال الرسائل، تضمين الروابط).'
      ].join('\n') },
    en: { label: 'Admins: /setup', desc: 'Adhkar, verse of the day, events, rooms',
      body: [
        '`/setup` (needs **Manage Server**) — one card with a menu:',
        '**Adhkar** morning, evening and all day · **Verse of the day** with tafsir',
        '**Events** (Ramadan, Fridays…) · **Wird room** · **Radio stations**',
        '**Language** (Arabic / English) · **Create rooms** automatically',
        '',
        'Each page has a button to come back, and the card **never expires**.',
        'Tip: Start with "Create rooms" so the bot prepares suitable rooms, then switch on what you want.',
        'The bot needs permission to post in the chosen room (View Channel, Send Messages, Embed Links).'
      ].join('\n') }
  },
  {
    key: 'faq1',
    ar: { label: 'أسئلة شائعة (١): الاستخدام', desc: 'كيف أشغّل، أغيّر، أوقف؟',
      body: [
        '**كيف أسمع قارئاً معيناً؟** `/recite` واكتب اسمه في خانة القارئ.',
        '**كيف أسمع القرآن كاملاً؟** `/recite` باسم القارئ فقط، أو زر «ابدأ ختمة من الفاتحة».',
        '**أين اللوحة؟** في شات الروم الصوتي. إن لم تجدها اكتب `/start` وأنت في الروم.',
        '**كيف أوقف مؤقتاً؟** `/hold` ثم `/continue`.',
        '**كيف أخرّج البوت؟** `/leave` أو زر «خروج».',
        '**هل يمكن لأي أحد التحكم؟** فقط من هو في نفس الروم الصوتي.',
        '**هل اختياري للقارئ يبقى؟** نعم، يُحفظ للسيرفر حتى بعد إعادة تشغيل البوت.',
        '**لماذا خرج البوت وحده؟** لصمت 5 دقائق، أو إيقاف 15 دقيقة، أو خلو الروم، أو انتهاء مؤقت النوم.'
      ].join('\n') },
    en: { label: 'FAQ (1): using the bot', desc: 'How do I play, change, stop?',
      body: [
        '**How do I hear a particular reciter?** `/recite` and type his name in the reciter field.',
        '**How do I hear the whole Quran?** `/recite` with just the reciter\'s name, or the "Start a Khatma" button.',
        '**Where is the panel?** In the voice room\'s chat. If you cannot find it, type `/start` while in the room.',
        '**How do I pause?** `/hold`, then `/continue`.',
        '**How do I make the bot leave?** `/leave` or the "Leave" button.',
        '**Can anyone control it?** Only people in the same voice room.',
        '**Is my reciter choice kept?** Yes, saved for the server even after the bot restarts.',
        '**Why did the bot leave by itself?** 5 minutes of silence, 15 paused, an empty room, or the sleep timer ended.'
      ].join('\n') }
  },
  {
    key: 'faq2',
    ar: { label: 'أسئلة شائعة (٢): مشاكل', desc: 'لا صوت؟ لا يدخل؟ لا يجد القارئ؟',
      body: [
        '**لا يدخل الروم:** تأكد أنك في روم صوتي (لا Stage) وأن للبوت صلاحيات **عرض القناة والاتصال والتحدث**. إن كان الروم ممتلئاً يلزم صلاحية «نقل الأعضاء».',
        '**لا أسمع شيئاً:** اضغط زر الصوت (+) أو اكتب `/volume 100`، وتأكد أن البوت غير مكتوم عندك.',
        '**«لا يوجد قارئ بهذا الاسم»:** اكتب جزءاً أقصر (كلمة واحدة) واختر من القائمة، وجرّب الاسم بالعربي أو الإنجليزي.',
        '**«ليس لديه سورة …»:** بعض القرّاء/الروايات لا تغطي كل السور، اختر قارئاً آخر.',
        '**«البوت مشغول في روم آخر»:** البوت يخدم روماً واحداً في السيرفر؛ انضم لنفس الروم أو استعمل البوت الثاني إن وُجد.',
        '**الأوامر لا تظهر:** بعد تحديث البوت قد تتأخر حتى ساعة. أعد تحميل ديسكورد (Ctrl+R).',
        '**رسالة «غير متاحة/معطّل»:** أوقفتها إدارة البوت مؤقتاً.',
        '**خطأ برمز مثل E-9A41C2:** أرسل الرمز لمالك البوت ليجد السبب.'
      ].join('\n') },
    en: { label: 'FAQ (2): problems', desc: 'No sound? Will not join? Reciter not found?',
      body: [
        '**It will not join:** be in a voice room (not a Stage) and give the bot **View Channel, Connect, Speak**. A full room needs "Move Members".',
        '**I hear nothing:** press the volume + button or type `/volume 100`, and check the bot is not muted on your side.',
        '**"No reciter found":** type a shorter part (one word) and pick from the list; try the Arabic or English name.',
        '**"has no recording of …":** some reciters/narrations do not cover every surah; pick another reciter.',
        '**"Bot is busy in another room":** the bot serves one room per server; join that room or use the second bot if there is one.',
        '**Commands do not show:** after a bot update they can take up to an hour. Reload Discord (Ctrl+R).',
        '**"Not available / disabled":** the bot\'s owner switched it off temporarily.',
        '**An error with a code like E-9A41C2:** send the code to the bot\'s owner to find the cause.'
      ].join('\n') }
  }
];

export const GUIDE_KEYS = GUIDE_TOPICS.map(t => t.key);
export const guideTopic = (key) => GUIDE_TOPICS.find(t => t.key === key) ?? GUIDE_TOPICS[0];
