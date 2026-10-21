# تشغيل / إيقاف البوت الثاني من لوحة الأونر

- **أين:** لوحة الأونر ← «الأسطول و /pull» ← الأسطول ← قسم **🎧 تشغيل / إيقاف البوت الثاني** (حالة، مدة التشغيل، الرام التي يستهلكها، وزر).
- **إيقاف كامل:** يُنهى process البوت الثاني (SIGTERM ثم SIGKILL بعد 12ث إن لم يخرج) فتعود **كل ذاكرته** للاستضافة: الكاش، المخازن المؤقتة، عمليات ffmpeg التابعة له.
  يخرج من الرومات الصوتية بنظافة، ويُحذف من سجل البوتات فوراً، وتُلغى أوامر اللوحة المعلّقة له، فلا يُسلَّم له طلب وهو غير موجود.
- **تشغيل:** process جديد، وجلساته تعود من لقطاتها المحفوظة.
- **تُحفظ الحالة في قاعدة البيانات** (`BotControl.secondBotPaused`): إعادة تشغيل البوت الرئيسي لا تُرجعه وحدها.
- **حدّ:** يعمل فقط للبوت الثاني الذي يشغّله هذا المشروع (`SECOND_BOT_TOKEN`). بوت ثانٍ على استضافة أخرى يُوقَف من استضافته، واللوحة تقول ذلك.
- API (للأونر فقط): `GET /api/admin/second-bot` · `POST /api/admin/second-bot { action: 'stop' | 'start' }`.
- الملفات: `services/secondBotLauncher.js` (`pause/resume/status`)، `services/secondBotControl.js` (جديد)، `api/ownerControl.js`، `bootstrap.js`، `models/BotControl.js`، `dashboard/admin/phase5.js`.
- اختبارات: `test/secondBotControl.test.js` (جديد) + إضافات في `test/secondBotLauncher.test.js`.
