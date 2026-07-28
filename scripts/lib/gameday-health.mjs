/**
 * Pure logic for the gameday health check (scripts/gameday-health-check.mjs).
 *
 * Split out so the interesting decisions — what counts as a healthy JSON
 * payload, how the week number is clamped, and how failures are summarized
 * for the Actions log / GroupMe — are unit-testable without any network
 * traffic. See tests/gameday-health-check.test.ts.
 */

/**
 * Clamp a week number to the range the live-scoring API accepts (1-18).
 *
 * `getCurrentNFLWeek` (scripts/article-utils/week-resolver.mjs) returns 0
 * before kickoff and already caps at 18 after the regular season, but the
 * health check can fire in early September before Thursday night Week 1 —
 * probing week 1 in that window is the honest "next thing owners will hit".
 *
 * @param {number} week
 * @returns {number}
 */
export function clampHealthCheckWeek(week) {
  if (!Number.isFinite(week) || week < 1) return 1;
  return Math.min(Math.floor(week), 18);
}

/**
 * Judge an already-parsed JSON value as a healthy API payload.
 *
 * Healthy = a non-empty object or non-empty array whose top level does not
 * carry an `error` key. Both the app endpoints and MFL's export gateway
 * report failures as 200s with `{ "error": "..." }` bodies, so a bare
 * status check is not enough.
 *
 * @param {unknown} value
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluateJsonValue(value) {
  if (value === null || typeof value !== 'object') {
    return { ok: false, reason: `not a JSON object/array (got ${value === null ? 'null' : typeof value})` };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { ok: false, reason: 'empty JSON array' };
    return { ok: true };
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return { ok: false, reason: 'empty JSON object' };
  if ('error' in value) {
    const detail = typeof value.error === 'string' ? value.error : JSON.stringify(value.error);
    return { ok: false, reason: `payload carries an error field: ${detail}` };
  }
  return { ok: true };
}

/**
 * Judge a raw HTTP response body as a healthy JSON payload.
 *
 * @param {string} text
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluateJsonText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'empty response body' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: `response is not valid JSON: ${text.slice(0, 120)}` };
  }
  return evaluateJsonValue(parsed);
}

/**
 * @typedef {{ name: string, ok: boolean, detail?: string }} CheckResult
 */

/**
 * Build the short, admin-oriented failure summary posted to GroupMe and
 * printed at the bottom of the Actions log. Returns null when every check
 * passed (nothing to post).
 *
 * @param {CheckResult[]} results
 * @param {{ week: number, year: number }} context
 * @returns {string | null}
 */
export function buildFailureSummary(results, { week, year }) {
  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) return null;
  const lines = [
    `Gameday health check FAILED (${year} week ${week}): ${failures.length}/${results.length} checks failing.`,
    ...failures.map((f) => `- ${f.name}: ${f.detail ?? 'failed'}`),
    'Live-game surfaces may be broken for owners — see the gameday-health-check run in GitHub Actions.',
  ];
  return lines.join('\n');
}
