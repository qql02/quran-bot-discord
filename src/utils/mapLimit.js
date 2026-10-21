/**
 * Run `fn` over `items` with at most `limit` running at once; resolves with the results in input order.
 * `fn` must not throw (callers catch inside) — one failing item should never stop the rest.
 */
export async function mapLimit(items, limit, fn) {
  const list = [...items];
  const out  = new Array(list.length);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}
