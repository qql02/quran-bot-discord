import { fetchMushafPage } from './mushafService.js';
import { pagesToday, TOTAL_PAGES, DEFAULT_PAGES, isFriday } from '../utils/wird.js';
import { todayFor, reminderMessage } from '../utils/wirdUi.js';
import { renderPage } from '../utils/mushafUi.js';
import { mushafText } from '../utils/mushafText.js';
import { logger } from '../utils/logger.js';

const FETCH_BUDGET_MS = 4000;     // the scheduler is sequential: a slow text service must never hold up everyone else's reminder

/**
 * What the member receives in their DMs at wird time: today's NEXT page itself (text + "I finished this page" button).
 * Finishing it sends the next page, until the daily goal is reached; the next day the next pages arrive.
 * Whatever goes wrong (text service down or slow, anything unexpected) falls back to the classic text reminder,
 * so a reminder is never lost because of the reader.
 */
export async function buildDailyDelivery(sub, now = new Date(), fetchPage = fetchMushafPage) {
  try {
    const expected = Math.min(TOTAL_PAGES, (sub.currentPage ?? 0) + 1);
    let timer;
    const data = await Promise.race([fetchPage(expected), new Promise(r => { timer = setTimeout(() => r(null), FETCH_BUDGET_MS); })]).finally(() => clearTimeout(timer));
    if (!data) return reminderMessage(sub, now);
    const member = { expected, today: pagesToday(sub, todayFor(sub, now)), perDay: sub.pagesPerDay ?? DEFAULT_PAGES };
    const lang = sub.lang ?? 'ar';
    const mt = mushafText(lang);
    const note = isFriday(todayFor(sub, now)) ? `${mt.dailyIntro}\n${mt.fridayNote}` : mt.dailyIntro;      // Friday: Al-Kahf + salawat
    return renderPage({ page: expected, data, userId: sub.userId, member, lang, note });
  } catch (err) {
    logger.warn(`[wird:${sub.userId}] page delivery fell back to the text reminder: ${err?.message}`);
    return reminderMessage(sub, now);
  }
}
