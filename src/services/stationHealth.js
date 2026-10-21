/**
 * Which radio stations are on the air right now? Pure logic with an injected probe (no network or database imports → unit-testable).
 *
 * A station list is long and many of them are silent at any moment, so /live must only offer the ones that answer. Probing
 * everything on every keystroke would be far too slow, so results are cached (a live station is trusted for a few minutes, a dead
 * one is retried sooner) and one pass has a time budget: whatever has not answered by then is left out of THIS answer — its probe
 * keeps running and is cached, so the next keystroke already knows.
 */
export function createHealth({ probe, ttlLiveMs = 5 * 60_000, ttlDeadMs = 2 * 60_000, maxEntries = 1000, now = () => Date.now() }) {
  const status = new Map();     // url → { live, ts }
  const inflight = new Map();   // url → Promise<boolean>

  const fresh = (e) => !!e && now() - e.ts < (e.live ? ttlLiveMs : ttlDeadMs);

  /** true / false when known and recent, undefined when unknown or stale. */
  const cached = (url) => { const e = status.get(url); return fresh(e) ? e.live : undefined; };

  /** Probe once (never twice at the same time for one url); never throws. */
  function check(url) {
    const known = cached(url);
    if (known !== undefined) return Promise.resolve(known);
    if (inflight.has(url)) return inflight.get(url);
    const p = Promise.resolve().then(() => probe(url)).then(() => true, () => false).then((live) => {
      status.delete(url); status.set(url, { live, ts: now() });
      while (status.size > maxEntries) status.delete(status.keys().next().value);
      inflight.delete(url);
      return live;
    });
    inflight.set(url, p);
    return p;
  }

  /**
   * The items (`{ url }`) that are on the air, in their original order, at most `limit`.
   * Stops early once `limit` live ones are found in order, and at `budgetMs` otherwise (slow ones are simply not in this answer).
   */
  async function liveOnly(items, { limit = 25, budgetMs = 2200, concurrency = 8 } = {}) {
    const results = new Array(items.length);            // undefined = not decided yet
    let next = 0;
    let stop = false;
    const decided = () => {                              // the live ones forming an unbroken prefix of decisions, so order is stable
      const out = [];
      for (let i = 0; i < items.length; i++) { if (results[i] === undefined) break; if (results[i]) out.push(items[i]); }
      return out;
    };
    const worker = async () => {
      while (!stop && next < items.length) {
        const i = next++;
        results[i] = await check(items[i].url);
        if (decided().length >= limit) stop = true;
      }
    };
    const work = Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    let timer;
    await Promise.race([work, new Promise((r) => { timer = setTimeout(r, budgetMs); })]);
    clearTimeout(timer);
    stop = true;
    // Whatever is decided and live — also beyond the first undecided one, so a slow station does not hide the fast ones after it.
    return items.filter((_, i) => results[i] === true).slice(0, limit);
  }

  /** Fill the cache in the background (never awaited by anyone, never throws). */
  function warm(urls, concurrency = 6) {
    const list = [...new Set(urls)].filter((u) => cached(u) === undefined);
    let i = 0;
    const worker = async () => { while (i < list.length) await check(list[i++]); };
    void Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker)).catch(() => {});
  }

  return { check, cached, liveOnly, warm, _status: status };
}
