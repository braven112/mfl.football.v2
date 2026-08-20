/**
 * Bounded-concurrency fan-out.
 *
 * A live route that expands one upstream call into ~16 more has to bound both
 * how many run at once and what a single failure costs. `Promise.all` over the
 * whole set does neither: it opens every socket at once and rejects the batch
 * on the first failure, which turns one hung game into a blank board.
 *
 * Results come back in INPUT ORDER as `PromiseSettledResult`s, so the caller
 * can pair each outcome with the item that produced it and keep the ones that
 * worked. Partial results are the point.
 */
export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<Array<PromiseSettledResult<O>>> {
  const results: Array<PromiseSettledResult<O>> = new Array(items.length);
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;

  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = { status: 'fulfilled', value: await worker(items[i], i) };
        } catch (reason) {
          results[i] = { status: 'rejected', reason };
        }
      }
    }),
  );

  return results;
}
