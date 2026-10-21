import { MessageFlags } from 'discord.js';
import { WirdSubscription } from '../models/WirdSubscription.js';
import { MushafPref, READER_VIEWS } from '../models/MushafPref.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { logReading } from '../services/wirdService.js';
import { fetchMushafPage, prefetchMushafPage } from '../services/mushafService.js';
import { getMushafImage, prefetchMushafImage, mushafImagesEnabled, activeRiwayas } from '../services/mushafImages.js';
import { subscriptionState, pagesToday, liveStreak, TOTAL_PAGES, MAX_PAGES_PER_DAY, DEFAULT_PAGES } from '../utils/wird.js';
import { todayFor, khatmaMessage, normWirdLang, guildWirdLang } from '../utils/wirdUi.js';
import { buildErrorEmbed } from '../utils/embeds.js';
import { parseId, parseKind, parseTarget, clampPage, MODAL_JUMP, TEXT_VIEW, viewFromPref, prefOfView, isPlain } from '../utils/mushaf.js';
import { renderPage, renderImagePage, renderUnavailable, renderKhatmaDone, renderGate, renderDayDone, jumpModal } from '../utils/mushafUi.js';
import { mushafText } from '../utils/mushafText.js';
import { logger } from '../utils/logger.js';

const EPH = MessageFlags.Ephemeral;

/** A member's own language wins (a record saved before languages existed reads as Arabic, like all their wird cards). */
const memberLang = (sub, fallback) => (sub ? normWirdLang(sub.lang) : fallback);

/** Everything the reader needs from the outside world — replaced in tests. */
export const defaultDeps = {
  // The reader must keep working when the database is down: no subscription is then simply "not subscribed".
  getSub: async (userId) => {
    try { return await WirdSubscription.findOne({ userId }).lean(); }
    catch (err) { logger.warn(`[mushaf] wird lookup failed: ${err.message}`); return null; }
  },
  // Language for members without a record: the wird room's (the panel they came from), else their server's (DMs → Arabic).
  guildLang: async (guildId) => {
    if (!guildId) return 'ar';
    try {
      const doc = await GuildSettings.findOne({ guildId }, { wird: 1, language: 1 }).lean();
      return guildWirdLang(doc);
    } catch { return 'ar'; }
  },
  logReading,
  // The member's saved way of reading (text / Hafs picture / Warsh picture). Without a database the reader simply opens on text.
  getPref: async (userId) => {
    try { const doc = await MushafPref.findOne({ userId }, { view: 1 }).lean(); return READER_VIEWS.includes(doc?.view) ? doc.view : null; }
    catch (err) { logger.warn(`[mushaf] preference lookup failed: ${err.message}`); return null; }
  },
  setPref: async (userId, view) => {
    if (!READER_VIEWS.includes(view)) return false;
    try { await MushafPref.updateOne({ userId }, { $set: { view, updatedAt: new Date() } }, { upsert: true }); return true; }
    catch (err) { logger.warn(`[mushaf] preference not saved: ${err.message}`); return false; }
  },
  fetchPage: fetchMushafPage,
  prefetch: prefetchMushafPage,     // the next page is fetched in the background, so "التالية" feels instant
  // Page pictures (Hafs / Warsh): which riwayat have images, the picture of one page, and a background warm-up of the next one.
  imageRiwayat: () => (mushafImagesEnabled() ? activeRiwayas() : []),
  loadImage: getMushafImage,
  prefetchImage: prefetchMushafImage
};

// What each member was last known to use, so turning pages (the same view over and over) never writes to the database:
// only a CHANGE of view (text ⇄ Hafs ⇄ Warsh) is saved. Bounded, and a lost entry only costs one harmless extra write.
const lastView = new Map();
const LAST_VIEW_MAX = 5000;
function rememberView(deps, userId, view) {
  if (!deps.setPref) return;
  const pref = prefOfView(view);
  if (lastView.get(userId) === pref) return;
  lastView.delete(userId); lastView.set(userId, pref);
  while (lastView.size > LAST_VIEW_MAX) lastView.delete(lastView.keys().next().value);
  Promise.resolve(deps.setPref(userId, pref))                     // never delays or breaks the reader; a failed save is tried again next time
    .then((ok) => { if (ok === false) lastView.delete(userId); })
    .catch(() => { lastView.delete(userId); });
}
/** Test hook. */
export const forgetViews = () => lastView.clear();
/** One member's remembered view — dropped when they reset their settings or delete their data. */
export const forgetUserView = (userId) => { lastView.delete(userId); };

/** The member's wird as the reader needs it, or null when they have no active subscription. */
function memberView(sub, now = new Date()) {
  if (!sub || !sub.active || subscriptionState(sub.expiresAt, now) === 'expired') return null;
  const expected = Math.min(TOTAL_PAGES, (sub.currentPage ?? 0) + 1);
  return { expected, today: pagesToday(sub, todayFor(sub, now)), perDay: sub.pagesPerDay ?? DEFAULT_PAGES };
}

/** Where a member starts reading: the next page of their wird, otherwise page 1. */
export const startPageFor = (sub) => memberView(sub)?.expected ?? 1;

/**
 * One screen of the reader. The reader is for wird subscribers: without an ACTIVE subscription the member gets the
 * (free) subscribe / renew card instead of any text — no page is even fetched for them.
 * `ctx.lang` is the fallback language; a subscribed member's own stored language wins.
 */
async function build(deps, userId, page, ctx, note = null, preloaded, view = TEXT_VIEW) {
  const sub    = preloaded === undefined ? await deps.getSub(userId) : preloaded;
  const lang   = memberLang(sub, ctx.lang);
  const plain  = isPlain(view);                                       // /mushaf: free for everyone, no wird
  const member = plain ? null : memberView(sub);
  if (!plain && !member) return renderGate({ userId, hasSub: !!sub, lang, note });
  rememberView(deps, userId, view);                                  // the member chose this way of reading → next time it opens like this

  const images = deps.imageRiwayat?.() ?? [];
  if (view.mode === 'img' && images.includes(view.riwaya)) {
    const image = await deps.loadImage?.(view.riwaya, page);
    if (image) {
      deps.prefetchImage?.(view.riwaya, page + 1);
      return renderImagePage({ page, riwaya: view.riwaya, image, userId, member, note, lang, images, plain });
    }
    note = [note, mushafText(lang).noteImageFailed].filter(Boolean).join('\n');   // never a dead end: the text of the page follows
  }
  const data = await deps.fetchPage(page);
  if (data) deps.prefetch?.(page + 1);
  return data ? renderPage({ page, data, userId, member, note, lang, images, plain }) : renderUnavailable({ page, userId, note, lang });
}

/**
 * Show the reader. Always defers first: the text may need a network call and Discord only waits 3 seconds.
 * `mode` 'reply' → a new private message;  'update' → edit the message the button/modal came from (no pile-up).
 */
async function present(interaction, mode, makePayload) {
  if (mode === 'update') await interaction.deferUpdate();
  else await interaction.deferReply({ flags: EPH });
  const payload = await makePayload();
  if (!payload.files) payload.attachments = [];            // leaving a page picture for the text (or the gate): drop the old image
  await interaction.editReply(payload);
}

/** Entry point for the slash command. `page` null → the member's own wird page. */
export async function openReader(interaction, page = null, deps = defaultDeps) {
  const userId = interaction.user.id;
  return present(interaction, 'reply', async () => {
    const [sub, lang, pref] = await Promise.all([deps.getSub(userId), deps.guildLang(interaction.guildId), deps.getPref?.(userId)]);
    const view = viewFromPref(pref);                                  // opens the way this member last read (text / Hafs / Warsh picture)
    if (pref) lastView.set(userId, prefOfView(view));
    return build(deps, userId, clampPage(page ?? startPageFor(sub)), { lang }, null, sub, view);
  });
}

/**
 * /mushaf — the FREE reader: anyone, no subscription. Same views (text · Hafs picture · Warsh picture), no wird buttons.
 * `page` null → where the member's wird is (when they have one), otherwise page 1.
 */
export async function openMushaf(interaction, page = null, deps = defaultDeps) {
  const userId = interaction.user.id;
  return present(interaction, 'reply', async () => {
    const [sub, lang, pref] = await Promise.all([deps.getSub(userId), deps.guildLang(interaction.guildId), deps.getPref?.(userId)]);
    const view = viewFromPref(pref, true);
    if (pref) lastView.set(userId, prefOfView(view));
    return build(deps, userId, clampPage(page ?? startPageFor(sub)), { lang: memberLang(sub, lang) }, null, sub, view);
  });
}

/** The free reader as a message payload, for the prefix commands in DMs. */
export async function mushafMessage(userId, page = null, lang = 'ar', deps = defaultDeps) {
  const [sub, pref] = await Promise.all([deps.getSub(userId), deps.getPref?.(userId)]);
  const view = viewFromPref(pref, true);
  if (pref) lastView.set(userId, prefOfView(view));
  return build(deps, userId, clampPage(page ?? startPageFor(sub)), { lang }, null, sub, view);
}

/**
 * The reader as a plain message payload, for prefix commands in the bot's DMs (no interaction exists there).
 * Same rules as openReader: the reader is for wird subscribers, so anyone else gets the (free) subscribe card.
 * `page` null → the member's own wird page.
 */
export async function readerMessage(userId, page = null, lang = 'ar', deps = defaultDeps) {
  const [sub, pref] = await Promise.all([deps.getSub(userId), deps.getPref?.(userId)]);
  const view = viewFromPref(pref);
  if (pref) lastView.set(userId, prefOfView(view));
  return build(deps, userId, clampPage(page ?? startPageFor(sub)), { lang }, null, sub, view);
}

const notYours = async (i, deps) => i.reply({ content: mushafText(await deps.guildLang(i.guildId)).notYours, flags: EPH });

export async function handleMushaf(interaction, client, deps = defaultDeps) {
  const id = parseId(interaction.customId);
  if (!id) return;
  const kind = parseKind(id.kind);                    // the action, and whether the member is reading text or a page picture
  if (!kind) return;
  const { base, view } = kind;
  const userId = interaction.user.id;
  if (id.userId && id.userId !== userId) return notYours(interaction, deps);
  const ctx = { lang: await deps.guildLang(interaction.guildId) };

  switch (base) {
    case 'open':            // from a wird reminder / the room panel: opens the clicker's OWN page in a private message
      return openReader(interaction, null, deps);

    case 'p':               // navigate
      return present(interaction, 'update', () => build(deps, userId, clampPage(id.page), ctx, null, undefined, view));

    case 'mine':            // back to the wird page
      return present(interaction, 'update', async () => { const sub = await deps.getSub(userId); return build(deps, userId, startPageFor(sub), ctx, null, sub, view); });

    case 'jump':
      return interaction.showModal(jumpModal(userId, memberLang(await deps.getSub(userId), ctx.lang), view));

    case 'jumpm': {         // modal submit
      const sub  = await deps.getSub(userId);
      const lang = memberLang(sub, ctx.lang);                         // the member's own language wins over the server's
      const target = parseTarget(interaction.fields.getTextInputValue('target'), lang);
      if (target.error) return interaction.reply({ embeds: [buildErrorEmbed(target.error, lang)], flags: EPH });
      const mode = interaction.isFromMessage?.() ? 'update' : 'reply';
      return present(interaction, mode, () => build(deps, userId, target.page, ctx, `📍 ${target.label}`, sub, view));
    }

    case 'done':
      return present(interaction, 'update', () => finishPage(client, userId, id.page, deps, ctx, view));
  }
}

/** "I finished this page": record exactly one page of the wird, then move on to the next. */
async function finishPage(client, userId, page, deps, ctx, view = TEXT_VIEW) {
  const sub    = await deps.getSub(userId);
  const member = memberView(sub);
  const t      = mushafText(memberLang(sub, ctx.lang));
  if (!member) return build(deps, userId, page, ctx, null, sub, view);           // lapsed meanwhile → the subscribe / renew card
  if (page !== member.expected) return build(deps, userId, page, ctx, t.noteNext(member.expected), sub, view);

  const res = await deps.logReading(client, userId, 1);
  switch (res.status) {
    case 'ok': {
      if (res.result?.completedKhatma) return renderKhatmaDone({ khatmaEmbeds: khatmaMessage(res.sub).embeds, userId, lang: memberLang(sub, ctx.lang), view });
      const next = Math.min(TOTAL_PAGES, page + 1);
      if (res.result?.newlyDone) {                // today's goal reached → stop here; the next pages arrive tomorrow
        let streak = 0;
        try { streak = liveStreak(res.sub, todayFor(res.sub, new Date())); } catch { /* the card works without it */ }
        return renderDayDone({ userId, nextPage: next, perDay: member.perDay, streak, lang: memberLang(sub, ctx.lang), view });
      }
      return build(deps, userId, next, ctx, t.noteSaved(page, false), undefined, view);
    }
    case 'busy':  return build(deps, userId, page, ctx, t.noteBusy, undefined, view);
    case 'limit': return build(deps, userId, page, ctx, t.noteLimit(MAX_PAGES_PER_DAY), undefined, view);
    default:      return build(deps, userId, page, ctx, null, undefined, view);    // subscription ended → gate
  }
}

export { MODAL_JUMP };
