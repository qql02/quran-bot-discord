# تشغيل البوت على bot-hosting.net

> أسماء الأزرار في لوحة الاستضافة قد تختلف قليلاً عمّا هنا، لكن الخطوات واحدة. لوحات هذه الاستضافات مبنية على Pterodactyl.

## قبل أن تبدأ (5 دقائق)
1. **توكن البوت:** [Developer Portal](https://discord.com/developers/applications) ← تطبيقك ← Bot ← Reset Token. وانسخ `Application ID` من General Information.
2. **قاعدة MongoDB مجانية:** [MongoDB Atlas](https://www.mongodb.com/atlas) ← أنشئ Cluster مجاني ← Database Access: أنشئ مستخدماً بكلمة سر ← **Network Access: أضف `0.0.0.0/0`** (عنوان الاستضافة يتغيّر) ← Connect ← Drivers ← انسخ الرابط `mongodb+srv://...` وضع اسماً لقاعدة البيانات بعد `.net/` مثل `/quranbot`.
3. **معرّفك في Discord:** فعّل Developer Mode ← كليك يمين على اسمك ← Copy User ID.

## الرفع
1. أنشئ سيرفراً من نوع **Node.js** في الاستضافة.
2. من **File Manager** ارفع `quran-bot-host-latest.zip` ثم **Unzip**. تأكد أن `index.js` و`package.json` في **جذر** السيرفر (انقلها من المجلد الداخلي إن لزم).
3. **إصدار Node: يجب 22.12 أو أحدث.** من **Startup** (أو Settings) اختر Node 22 أو أعلى. إن كان أقصى إصدار تعرضه اللوحة أقدم من 22، فالبوت لن يعمل على هذه الاستضافة (والبوت يطبع رسالة واضحة بذلك بدل انهيار غامض).
4. **ملف التشغيل (Startup file / Main file):** `index.js`.
5. أنشئ ملفاً اسمه `.env` بجانب `index.js` وانسخ إليه محتوى `.env.example` ثم املأ على الأقل:
   ```
   DISCORD_TOKEN=...
   CLIENT_ID=...
   MONGODB_URI=...
   NODE_ENV=production
   SESSION_SECRET=<32 حرفاً عشوائياً أو أكثر>
   ADMIN_IDS=<معرّفك>
   ```
   لتوليد `SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` من أي جهاز عليه Node.
6. اضغط **Start**. اللوحة تثبّت الحزم تلقائياً (`npm install`) وقد يستغرق التشغيل الأول دقائق.

## كيف تعرف أنه اشتغل
في الـ Console تظهر بالترتيب: `MongoDB connected` ثم `Logged in` ثم `Auto-deployed ... commands`. أوامر السلاش **تُسجَّل تلقائياً** عند التشغيل (لا تحتاج `npm run deploy`)، وقد تأخذ حتى ساعة لتظهر في كل السيرفرات، أو فوراً في سيرفر واحد إن ضبطت `GUILD_ID`.

## أول تجربة
ادعُ البوت للسيرفر (`/invite`)، ثم من حسابك (الموجود في `ADMIN_IDS`):
- `/owner health` ← فحص شامل يقول لك ما الخلل (قاعدة البيانات، واجهة القرآن، ffmpeg، الصلاحيات).
- ادخل روماً صوتياً وجرّب `/recite` ثم `/mushaf`.

## الصوت على الاستضافة
- **ffmpeg اختياري.** البوت يشتغل بدونه (فك MP3 مدمج). إن لم يتوفر على استضافتك فلا مشكلة في تلاوات mp3quran ومحطات MP3. محطات AAC/HLS تحتاج ffmpeg.
- إن كانت ذاكرة الاستضافة قليلة (256MB مثلاً) فخفّض `MAX_SESSIONS=5` أو `10` في `.env`.

## لوحة المالك (اختيارية)
تحتاج عنوان **HTTPS** يصل إلى البوت. إن لم تتوفر لك هذه الميزة في الاستضافة فتجاهلها: البوت يعمل كاملاً بدونها (ويكتب في السجل تنبيهاً فقط). المنفذ يُقرأ تلقائياً من `SERVER_PORT` الذي تضبطه الاستضافة.

## حلول المشاكل الشائعة
| الرسالة في الـ Console | السبب والحل |
|---|---|
| `Node.js 18.x is too old` | اختر Node 22+ من Startup |
| `Missing required env variable: ...` | ناقص في `.env` |
| `SESSION_SECRET is missing... ` | في الإنتاج يلزم 32 حرفاً فأكثر |
| `MongoDB connection failed` | رابط خاطئ، أو Atlas ← Network Access لم تضف `0.0.0.0/0` |
| `Used disallowed intents` أو `TOKEN_INVALID` | التوكن خاطئ أو لم تعِد نسخه بعد Reset |
| البوت يعمل لكن لا تظهر الأوامر | انتظر حتى ساعة، أو ضع `GUILD_ID` للتجربة الفورية |
| `API could not listen on port` | المنفذ مستخدم: لوحة المالك فقط معطلة والبوت يكمل |
| `E-XXXXXX` تظهر للمستخدمين | ابحث عنه: `logs/error.log` (انظر SETUP-HOST.md) |

## التحديث لاحقاً
أوقف السيرفر ← ارفع الملفات الجديدة فوق القديمة **دون حذف `.env` ولا مجلد `logs`** ← Start.
