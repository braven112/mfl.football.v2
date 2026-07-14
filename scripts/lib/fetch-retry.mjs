/**
 * Shared fetch-with-retry helper for node scripts.
 *
 * Consolidates the generic "fetch, retry with linear backoff on any
 * failure" shape duplicated in scripts/fetch-adp.mjs,
 * scripts/fetch-mfl-feeds.mjs, and scripts/fetch-def-spotlight-players.mjs
 * (`getJson`). Each caller supplies `onRetry`/`formatHttpError` to
 * reproduce its own original log wording and error message exactly.
 *
 * Deliberately NOT migrated (kept as-is — see CLAUDE.md-style rationale
 * inline at each call site):
 *  - scripts/commit-feed-and-push.mjs `fetchWithRetry` retries a `git
 *    fetch` subprocess synchronously (SharedArrayBuffer/Atomics sleep),
 *    not an HTTP request — unrelated semantics despite the name.
 *  - scripts/fetch-espn-college-ids.mjs `fetchJSON` has no retry loop at
 *    all (a single attempt) — nothing to consolidate.
 *  - scripts/update-salary-averages.mjs `fetchExport` is MFL-specific:
 *    it only retries transient statuses (429/5xx), honors a
 *    `Retry-After` response header, uses exponential (not linear)
 *    backoff, and inspects the parsed payload for an embedded MFL error
 *    field. Forcing it through this generic helper would risk changing
 *    that gating behavior.
 *  - scripts/fetch-def-spotlight-players.mjs `headOk` is a HEAD-request
 *    boolean check (short-circuits false on 404, never throws) — an
 *    explicitly different semantic per the refactor plan.
 */

/**
 * @param {string} url
 * @param {{
 *   attempts?: number,
 *   baseDelayMs?: number,
 *   fetchOptions?: RequestInit,
 *   parse?: 'json' | 'text' | 'response' | ((res: Response) => Promise<unknown>),
 *   formatHttpError?: (res: Response, url: string) => string,
 *   onRetry?: (err: Error, attempt: number, waitMs: number) => void,
 * }} [options]
 *   - attempts: total attempts including the first (default 1 — no retry).
 *   - baseDelayMs: base delay before retry N, multiplied by (attempt + 1)
 *     for linear backoff (default 0 — no delay).
 */
export async function fetchWithRetry(url, options = {}) {
  const {
    attempts = 1,
    baseDelayMs = 0,
    fetchOptions,
    parse = 'json',
    formatHttpError = (res) => `HTTP ${res.status}`,
    onRetry,
  } = options;

  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, fetchOptions);
      if (!res.ok) throw new Error(formatHttpError(res, url));
      if (parse === 'json') return await res.json();
      if (parse === 'text') return await res.text();
      if (parse === 'response') return res;
      if (typeof parse === 'function') return await parse(res);
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1) throw err;
      const wait = baseDelayMs * (attempt + 1);
      onRetry?.(err, attempt, wait);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastErr;
}
