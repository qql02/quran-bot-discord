import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder
} from 'discord.js';
import { COLORS } from './embeds.js';
import { emojiObj } from './emojis.js';
import { TOTAL_PAGES } from './wird.js';
import { layoutPage, pageTitle, mid, MODAL_JUMP, TEXT_VIEW, PLAIN_TEXT, imageView, kindFor, isPlain } from './mushaf.js';
import { mushafText } from './mushafText.js';

const quranUrl = (page) => `https://quran.com/page/${page}`;

function button(id, label, emojiKey, style = ButtonStyle.Secondary) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const e = emojiKey && emojiObj(emojiKey);
  return e ? b.setEmoji(e) : b;
}
const linkButton = (page, t) => {
  const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t.webMushaf).setURL(quranUrl(page));
  const e = emojiObj('read');
  return e ? b.setEmoji(e) : b;
};

/**
 * Row 1: navigation, laid out for right-to-left reading (the next page is on the LEFT, as when turning a mushaf).
 * The middle button shows the page number and opens the "go to…" box.
 */
function navRow(page, userId, t, view = TEXT_VIEW) {
  return new ActionRowBuilder().addComponents(
    // At the first / last page the button is disabled. Its id must NOT equal the id of another button on the message
    // (the riwaya switcher uses `p` + this very page) — Discord rejects duplicated custom ids (COMPONENT_CUSTOM_ID_DUPLICATED).
    button(page >= TOTAL_PAGES ? mid('end', 'next', userId) : mid(kindFor('p', view), page + 1, userId), t.next, 'next').setDisabled(page >= TOTAL_PAGES),
    button(mid(kindFor('jump', view), userId), `${page} / ${TOTAL_PAGES}`, 'jump'),
    button(page <= 1 ? mid('end', 'prev', userId) : mid(kindFor('p', view), page - 1, userId), t.prev, 'prev').setDisabled(page <= 1)
  );
}

/**
 * Row 2 (the reader is for wird subscribers only, so `member` is always present):
 *   on their next page  → "I finished this page" (records ONE page in the wird)
 *   page already read   → a disabled "read" mark;   page ahead of the wird → also a button back to the wird page
 * @param {{ expected:number }} member
 */
function actionRow(page, userId, member, t, view = TEXT_VIEW) {
  const row = new ActionRowBuilder();
  if (isPlain(view)) {                                              // the free reader: nothing about the wird
    if (view.mode !== 'img') row.addComponents(linkButton(page, t));
    return row;
  }
  if (page === member.expected)    row.addComponents(button(mid(kindFor('done', view), page, userId), t.finished, 'done', ButtonStyle.Success));
  else if (page < member.expected) row.addComponents(button(mid(kindFor('done', view), page, userId), t.alreadyRead, 'done').setDisabled(true));
  if (page !== member.expected)    row.addComponents(button(mid(kindFor('mine', view), userId), t.myPage(member.expected), 'pin', ButtonStyle.Primary));
  if (view.mode !== 'img') row.addComponents(linkButton(page, t));
  return row;
}

/** Text view, row 3: open the picture of this page — one button per riwaya that has images. */
function imageRow(page, userId, riwayat, t, plain = false) {
  return new ActionRowBuilder().addComponents(
    ...riwayat.map(r => button(mid(kindFor('p', imageView(r, plain)), page, userId), t.imageBtn(t.riwayaShort[r]), null))
  );
}

/**
 * @param {{ page:number, data:{juz:number|null, ayahs:object[]}, userId:string, member:null|{expected:number, today:number, perDay:number}, note?:string|null }} o
 */
export function renderPage({ page, data, userId, member, note = null, lang = 'ar', images = [], plain = false }) {
  const t = mushafText(lang);
  const { body, surahs } = layoutPage(data.ayahs);
  const foot = [t.footPage(page, TOTAL_PAGES)];
  if (data.juz) foot.push(t.footJuz(data.juz));
  if (member) foot.push(t.footToday(member.today, member.perDay));
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(pageTitle(surahs, lang))
    .setDescription(body)
    .setFooter({ text: foot.join(' · ') });
  const view = plain ? PLAIN_TEXT : TEXT_VIEW;
  const rows = [navRow(page, userId, t, view), actionRow(page, userId, member, t, view)];
  if (images.length) rows.push(imageRow(page, userId, images, t, plain));          // optional: the page as a picture (Hafs / Warsh)
  return { content: note, embeds: [embed], components: rows.filter(r => r.components?.length !== 0) };
}

/**
 * The same page as a picture, in one riwaya. Page numbers are shared by the two riwayat (see services/mushafImages.js), so
 * navigation, the wird ("I finished this page") and the jump box work exactly as in the text view.
 * @param {{ page:number, riwaya:'hafs'|'warsh', image:{buffer:Buffer, name:string}, userId:string, member:object, images:string[], note?:string|null }} o
 */
export function renderImagePage({ page, riwaya, image, userId, member, note = null, lang = 'ar', images = [], plain = false }) {
  const t = mushafText(lang);
  const view = imageView(riwaya, plain);
  const foot = [t.footPage(page, TOTAL_PAGES)];
  if (member) foot.push(t.footToday(member.today, member.perDay));
  foot.push(t.imageCredit);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(t.imageTitle(t.riwaya[riwaya]))
    .setImage(`attachment://${image.name}`)
    .setFooter({ text: foot.join(' · ') });
  const switcher = new ActionRowBuilder().addComponents(
    ...images.map(r => button(mid(kindFor('p', imageView(r, plain)), page, userId), t.riwayaShort[r], null, r === riwaya ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(r === riwaya)),
    button(mid(kindFor('p', plain ? PLAIN_TEXT : TEXT_VIEW), page, userId), t.textBtn, 'read')
  );
  return {
    content: note, embeds: [embed], files: [new AttachmentBuilder(image.buffer, { name: image.name })],
    components: [navRow(page, userId, t, view), switcher, actionRow(page, userId, member, t, view)].filter(r => r.components?.length !== 0)
  };
}

/** The text could not be loaded: reading must never dead-end, so offer a retry and the web Mushaf. */
export function renderUnavailable({ page, userId, note = null, lang = 'ar' }) {
  const t = mushafText(lang);
  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle(t.unavailableTitle(page))
    .setDescription(t.unavailableDesc);
  const row = new ActionRowBuilder().addComponents(button(mid('p', page, userId), t.retry, 'renew', ButtonStyle.Primary), linkButton(page, t));
  return { content: note, embeds: [embed], components: [row] };
}

/** After the member's last page of a khatma: celebrate and offer to start the next one. */
export function renderKhatmaDone({ khatmaEmbeds, userId, lang = 'ar', view = TEXT_VIEW }) {
  const row = new ActionRowBuilder().addComponents(button(mid(kindFor('p', view), 1, userId), mushafText(lang).newKhatma, 'read', ButtonStyle.Success));
  return { content: null, embeds: khatmaEmbeds, components: [row] };
}

/** The member just finished today's wird: celebrate, say when the next pages arrive, and let them keep reading if they wish. */
export function renderDayDone({ userId, nextPage, perDay, streak = 0, lang = 'ar', view = TEXT_VIEW }) {
  const t = mushafText(lang);
  const lines = [t.dayDoneDesc(t.pagesLabel(perDay), nextPage)];
  if (streak > 1) lines.push('', t.dayDoneStreak(streak));
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(t.dayDoneTitle).setDescription(lines.join('\n'));
  const row = new ActionRowBuilder().addComponents(button(mid(kindFor('p', view), nextPage, userId), t.keepReading, 'next'));
  return { content: null, embeds: [embed], components: [row] };
}

export const jumpModal = (userId, lang = 'ar', view = TEXT_VIEW) => {
  const t = mushafText(lang);
  return new ModalBuilder()
    .setCustomId(`${view.mode === 'img' || isPlain(view) ? `mushaf:${kindFor('jumpm', view)}` : MODAL_JUMP}:${userId}`)
    .setTitle(t.jumpTitle)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('target').setLabel(t.jumpLabel)
        .setPlaceholder(t.jumpPlaceholder).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)
    ));
};

/**
 * The reader is for wird subscribers (free). Anyone else — never subscribed, paused or expired — gets this card with
 * one button: subscribe (new) or renew (had a subscription). Reading and the wird are one feature: the page the member
 * finishes is the page the wird records.
 */
export function renderGate({ hasSub, lang = 'ar', note = null }) {
  const t = mushafText(lang);
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(t.gateTitle).setDescription(hasSub ? t.gateLapsed : t.gateNew);
  const row = new ActionRowBuilder().addComponents(hasSub
    ? button('wird:renew', t.gateRenew, 'renew', ButtonStyle.Success)
    : button('wird:subscribe', t.gateJoin, 'subscribe', ButtonStyle.Success));
  return { content: note, embeds: [embed], components: [row] };
}
