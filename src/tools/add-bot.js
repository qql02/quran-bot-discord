/**
 * Guided installer for the VOICE-ONLY second bot in the same server — run by hand:   npm run add-bot
 *
 *   1. asks for the second bot's token (typed hidden) and takes the client ID from it — nothing else to copy
 *   2. checks the token with Discord (valid, is a bot, ID matches, not the first bot)
 *   3. NO fixed server: the second bot works in any server it is added to — each server's admin adds it from Discord (🎧 button under /invite).
 *      A general bot-only invite link is printed; with NEW_BOT_GUILD set, it is also added + verified in that one server (a first test)
 *   4. checks that its application has NO slash commands
 *   5. checks the shared database is reachable and shows which one it is
 *   6. writes  .env.secondary  (BOT_ROLE=secondary, SAME database + owners, own SESSION_SECRET) — upload it as `.env`
 *      on the second host/container together with the same project files.
 *
 * Non-interactive use: NEW_BOT_TOKEN=… npm run add-bot   (optional: NEW_BOT_GUILD=… to also test it in one server)   (the token never appears in the output).
 * Reads .env (if present) only to copy MONGODB_URI / ADMIN_IDS and to know the first bot's ID.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  clientIdFromToken, looksLikeTokenText, inspectBot, inspectApplication, inviteUrl, isInGuild, guildPermissionGaps, waitUntilInGuild,
  listGlobalCommands, clearGlobalCommands, VOICE_WORKER_PERMS, VOICE_WORKER_INVITE_PERMISSIONS
} from '../utils/botToken.js';
import { envLine } from '../utils/envFile.js';

const OUT = '.env.secondary';
const SNOWFLAKE = /^\d{17,20}$/;
const say = (m = '') => console.log(m);
const fail = (m) => { console.error(`\n❌ ${m}`); process.exit(1); };

let muted = false;
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const origWrite = rl._writeToOutput?.bind(rl);
if (origWrite) rl._writeToOutput = (s) => { if (!muted) origWrite(s); };
// Panel hosts (bot-hosting.net…) feed ONE line into the console and then close its input. A closed input must not crash the tool:
// every later question just takes its default (the server from GUILD_ID, "yes" to deleting leftover commands, "no" to overwriting a file).
let closed = false;
rl.on('close', () => { closed = true; });
const ask = (q, { hidden = false } = {}) => new Promise((res) => {
  process.stdout.write(q);
  if (closed) { say('(لا مدخلات — القيمة الافتراضية)'); return res(''); }
  muted = hidden;
  rl.question('', (a) => { muted = false; if (hidden) say(); res(a.trim()); });
  rl.once('close', () => res(''));                       // input ended while waiting for the answer
});

say('🕌 إضافة بوت ثانٍ (مشغّل صوت فقط) — أدخل التوكن فقط، والباقي تلقائي\n');

// 1 + 2 ── token → client ID → checked with Discord
const token = process.env.NEW_BOT_TOKEN?.trim() || await ask('توكن البوت الثاني (لن يظهر أثناء الكتابة): ', { hidden: true });
const id = clientIdFromToken(token);
if (!id || !looksLikeTokenText(token)) fail('هذا ليس توكن بوت صحيحاً (الشكل: ثلاثة أجزاء تفصل بينها نقاط). انسخه من Developer Portal ← Bot ← Reset Token.');
if (id === clientIdFromToken(process.env.DISCORD_TOKEN)) fail('هذا توكن البوت الأول نفسه — أنشئ تطبيقاً جديداً في Developer Portal للبوت الثاني.');

const bot = await inspectBot(token);
if (!bot.ok) {
  fail({ invalid_token: 'ديسكورد رفض التوكن (خاطئ أو أُعيد ضبطه). انسخ توكناً جديداً.',
         not_a_bot: 'الحساب ليس بوتاً أو لا يطابق التوكن.',
         network: 'تعذّر الاتصال بديسكورد. تحقق من الإنترنت وأعد المحاولة.',
         format: 'شكل التوكن غير صحيح.' }[bot.reason]);
}
say(`✅ التوكن صالح — البوت: ${bot.name}  (client id: ${bot.id})`);

// The invite link only works for OTHER servers' admins when the application is public — warn now, not when the first admin reports it.
const app = await inspectApplication(token);
if (app.ok && (!app.public || app.codeGrant)) {
  say('⚠️ تطبيق البوت الثاني ليس عامًا: ' + [!app.public ? 'فعّل «Public Bot»' : '', app.codeGrant ? 'وأوقف «Requires OAuth2 Code Grant»' : ''].filter(Boolean).join(' و') +
      ' من Developer Portal ← Bot (أو Installation)، وإلا لن يستطيع مدراء السيرفرات الأخرى إضافته (الرابط يعمل لك أنت فقط).');
} else if (app.ok) say('✅ التطبيق عام: يستطيع مدراء أي سيرفر إضافته.');

// 3 ── no fixed server: the second bot works in ANY server where it is added. Members' admins add it themselves from Discord
//      (the 🎧 button under /invite → steps, invite link for THEIR server, and a "Check" button). Only when NEW_BOT_GUILD is set do we
//      add + verify it in one server right now (handy for a first test).
const testGuild = process.env.NEW_BOT_GUILD?.trim();
say('\nالبوت الثاني لا يرتبط بسيرفر محدد: يعمل في أي سيرفر يُضاف إليه. يضيفه مدير كل سيرفر بنفسه من ديسكورد (زر «🎧 البوت الثاني» تحت /invite).');
say('رابط دعوة عام (بوت فقط، بلا أوامر سلاش) للتجربة:\n' + inviteUrl(bot.id, VOICE_WORKER_INVITE_PERMISSIONS, null, { commands: false }) + '\n');
if (testGuild) {
  if (!SNOWFLAKE.test(testGuild)) fail('NEW_BOT_GUILD غير صحيح (17–20 رقماً).');
  if (await isInGuild(token, testGuild)) say('✅ البوت موجود في سيرفر الاختبار بالفعل.');
  else {
    say(`افتح هذا الرابط لإضافته إلى سيرفر الاختبار:\n${inviteUrl(bot.id, VOICE_WORKER_INVITE_PERMISSIONS, testGuild, { commands: false })}\n\n⏳ بانتظار انضمام البوت… (حتى 5 دقائق، Ctrl+C للإلغاء)`);
    if (!(await waitUntilInGuild(token, testGuild))) fail('لم ينضم البوت خلال 5 دقائق.');
    say('✅ انضم البوت إلى السيرفر.');
  }
  const gaps = await guildPermissionGaps(token, testGuild, bot.id, undefined, VOICE_WORKER_PERMS);
  if (gaps?.missing?.length) say(`⚠️ ينقص البوت صلاحيات: ${gaps.missing.join(', ')}`);
  else if (gaps) say('✅ الصلاحيات الأساسية موجودة.');
}

// 4 ── no slash commands on this application
const leftover = await listGlobalCommands(token, bot.id);
if (leftover?.length) {
  say(`⚠️ تطبيق هذا البوت فيه ${leftover.length} أمر سلاش مسجّل مسبقاً (${leftover.slice(0, 5).map(n => '/' + n).join(' ')}…). البوت الثاني مشغّل صوت فقط ولن يردّ عليها.`);
  const a = process.env.NEW_BOT_TOKEN ? 'y' : (await ask('حذف هذه الأوامر من التطبيق؟ (Y/n): ')).toLowerCase();
  if (a !== 'n') say((await clearGlobalCommands(token, bot.id)) ? '✅ حُذفت أوامر السلاش من التطبيق.' : '⚠️ تعذّر حذفها تلقائياً — احذفها يدوياً أو اتركها (لن تعمل).');
} else if (leftover) {
  say('✅ لا توجد أوامر سلاش مسجّلة لهذا البوت.');
}

// 5 ── the shared database
let mongoUri = process.env.MONGODB_URI?.trim();
if (!mongoUri) mongoUri = await ask('MONGODB_URI (نفس قاعدة البوت الأول — لن يظهر أثناء الكتابة): ', { hidden: true });
if (!/^mongodb(\+srv)?:\/\/\S+$/.test(mongoUri)) fail('MONGODB_URI غير صحيح (يبدأ بـ mongodb:// أو mongodb+srv://). يجب أن يكون نفس رابط قاعدة البوت الأول.');
try {
  const { default: mongoose } = await import('mongoose');
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8_000 });
  say(`✅ قاعدة البيانات متاحة — الخادم: ${mongoose.connection.host} · القاعدة: ${mongoose.connection.name}  (البوتان سيستعملان هذه القاعدة نفسها)`);
  await mongoose.disconnect();
} catch (err) {
  say(`⚠️ تعذّر الاتصال بقاعدة البيانات من هنا (${err.message.split('\n')[0]}). إن كانت Atlas فتأكد أن Network Access يسمح بعنوان الاستضافة الثانية، ثم تحقق من السجل عند التشغيل.`);
}

// 6 ── .env.secondary
if (existsSync(OUT) && !process.env.NEW_BOT_TOKEN) {
  const a = (await ask(`${OUT} موجود. استبداله؟ (y/N): `)).toLowerCase();
  if (a !== 'y') { say('تم الإيقاف دون كتابة ملف.'); process.exit(0); }
}
const adminIds = (process.env.ADMIN_IDS ?? '').split(',').map(s => s.trim()).filter(s => SNOWFLAKE.test(s));
let body;
try {
  body = [
    '# Generated by `npm run add-bot` — upload as `.env` on the SECOND host/container (same project files).',
    '# Voice-only bot: it registers no slash commands. Never run `npm run deploy` there.',
    envLine('DISCORD_TOKEN', token),
    envLine('BOT_ROLE', 'secondary'),
    envLine('MONGODB_URI', mongoUri),                       // the SAME database as the first bot
    envLine('ADMIN_IDS', adminIds.join(',')),
    envLine('SESSION_SECRET', randomBytes(48).toString('hex')),
    envLine('NODE_ENV', process.env.NODE_ENV === 'development' ? 'development' : 'production'),
    ''
  ].join('\n');
} catch (err) {
  fail(`تعذّر كتابة الملف بأمان: ${err.message}`);
}
writeFileSync(OUT, body, { mode: 0o600 });
say(`\n✅ كُتب الملف ${OUT} (يحوي التوكن وكلمة سر القاعدة — لا ترفعه لأي مكان عام).`);
say('الخطوة الأخيرة: على الاستضافة الثانية ارفع نفس ملفات المشروع + هذا الملف باسم .env ثم شغّل البوت (npm start).');
say('بعد التشغيل: عند طلب تلاوة والبوت الأول مشغول في روم آخر، يدخل البوت الثاني روم العضو تلقائياً ويرسل لوحة تحكمه.');
rl.close();
