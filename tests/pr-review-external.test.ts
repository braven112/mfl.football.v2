import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ProviderHttpError,
  callWithRetry,
  parseRetryAfter,
  backoffMs,
  MAX_ATTEMPTS,
} from '../scripts/lib/pr-review-providers.mjs';

/**
 * Guards for the external PR reviewer (Gemini), Aug 2026.
 *
 * The bug: the reviewer ran on every PR push, fired exactly ONE request, and
 * Google answered `503 — this model is currently experiencing high demand`.
 * PRs #639, #644 and #646 all came back "Reviewer failed to run" inside four
 * hours. A reviewer that fails on most PRs is worse than no reviewer, because
 * everyone learns to skim past its comment — including the honest "did not
 * run" line that is the whole reason the comment exists.
 *
 * The fix has two halves, and this file pins both:
 *
 *  1. Retry transient failures. A 503 explicitly means "try again later", so
 *     treating one as fatal threw away a review we could have had.
 *  2. Stop running per-push. Gemini is dispatch-only, and Claude owns the
 *     cross-cutting lens on every PR (`/live` step 5b) so the SCOPE does not
 *     go with it.
 *
 * Half 2 is the one that rots silently: re-adding `synchronize` to the
 * workflow, or dropping step 5b from `live.md`, both restore the old failure
 * without anything going red. Hence the file-content assertions below.
 */

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Retry behaviour
// ---------------------------------------------------------------------------

/** A call that fails with `status` for the first `failures` attempts, then succeeds. */
function flakyCall(failures: number, status: number, retryable: boolean) {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls <= failures) {
      throw new ProviderHttpError(`API ${status}`, { status, retryable });
    }
    return 'NO FINDINGS';
  };
  return { fn, calls: () => calls };
}

// Never actually sleep — the backoff is seconds long by design.
const noWait = async () => {};

describe('callWithRetry', () => {
  it('retries a 503 and returns the review it would otherwise have thrown away', async () => {
    // The exact production failure: one busy minute on Google's side.
    const { fn, calls } = flakyCall(1, 503, true);

    const result = await callWithRetry(fn, {}, { wait: noWait });

    expect(result.text).toBe('NO FINDINGS');
    expect(result.attempts).toBe(2);
    expect(calls()).toBe(2);
  });

  it('survives a run of transient failures up to the attempt budget', async () => {
    const { fn } = flakyCall(MAX_ATTEMPTS - 1, 503, true);
    const result = await callWithRetry(fn, {}, { wait: noWait });
    expect(result.attempts).toBe(MAX_ATTEMPTS);
  });

  it('gives up after MAX_ATTEMPTS rather than retrying forever', async () => {
    const { fn, calls } = flakyCall(Infinity, 503, true);

    await expect(callWithRetry(fn, {}, { wait: noWait })).rejects.toThrow('API 503');
    expect(calls()).toBe(MAX_ATTEMPTS);
  });

  it('does NOT retry a permanent failure — a dead model id is dead on attempt four too', async () => {
    // 404 means the model id needs bumping. Backing off three times turns an
    // instantly-actionable error into a slow one and tells us nothing new.
    const { fn, calls } = flakyCall(Infinity, 404, false);

    await expect(callWithRetry(fn, {}, { wait: noWait })).rejects.toThrow('API 404');
    expect(calls()).toBe(1);
  });

  it('retries a non-HTTP throw — a socket or DNS failure is transient by nature', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return 'ok';
    };

    const result = await callWithRetry(fn, {}, { wait: noWait });
    expect(result.attempts).toBe(2);
  });

  it('does not re-roll a successful review', async () => {
    // Retrying the transport is fine; retrying the JUDGEMENT would be shopping
    // for an opinion we like until the model gives us one.
    let calls = 0;
    const fn = async () => {
      calls++;
      return '## Critical\nSomething is wrong.';
    };

    await callWithRetry(fn, {}, { wait: noWait });
    expect(calls).toBe(1);
  });

  it('reports the attempt count on the error it gives up with', async () => {
    // runProvider renders "after N attempts" from this. It used to infer N
    // from `retryable`, which is only correct while every transient path
    // happens to exhaust the budget.
    const { fn } = flakyCall(Infinity, 503, true);
    await callWithRetry(fn, {}, { wait: noWait }).catch((e) => {
      expect(e.attempts).toBe(MAX_ATTEMPTS);
    });

    const permanent = flakyCall(Infinity, 404, false);
    await callWithRetry(permanent.fn, {}, { wait: noWait }).catch((e) => {
      expect(e.attempts).toBe(1);
    });

    expect.assertions(2);
  });

  it('waits between attempts rather than hammering a model that just said it was busy', async () => {
    const waits: number[] = [];
    const { fn } = flakyCall(2, 503, true);

    await callWithRetry(fn, {}, { wait: async (ms: number) => void waits.push(ms) });

    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThan(0);
    expect(waits[1]).toBeGreaterThan(waits[0]); // exponential, not flat
  });
});

// ---------------------------------------------------------------------------
// The Gemini provider itself — the wiring between fetch and callWithRetry
// ---------------------------------------------------------------------------

const OVERLOADED = JSON.stringify({
  error: { code: 503, message: 'This model is currently experiencing high demand.' },
});

function fakeResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

const geminiOk = (text: string) =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });

const geminiEmpty = (finishReason: string) =>
  JSON.stringify({ candidates: [{ finishReason, content: { parts: [] } }] });

/** Import lazily so each test can install its own fetch stub first. */
async function runGemini() {
  const { runProvider } = await import('../scripts/lib/pr-review-providers.mjs');
  return runProvider('gemini', { diff: 'diff --git a b', env: { GEMINI_API_KEY: 'k' } });
}

describe('the Gemini provider recovers from the failure that started all this', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('turns the production 503 into a delivered review', async () => {
    // Reproduces PRs #639 / #644 / #646 exactly: Google says "high demand",
    // then serves the review. This used to render as "Reviewer failed to run".
    let n = 0;
    vi.spyOn(globalThis, 'setTimeout' as never).mockImplementation(((fn: () => void) => {
      fn();
      return 0 as never;
    }) as never);
    globalThis.fetch = (async () =>
      ++n <= 2 ? fakeResponse(503, OVERLOADED) : fakeResponse(200, geminiOk('NO FINDINGS'))) as never;

    const result = await runGemini();

    expect(result.status).toBe('ok');
    expect(result.text).toBe('NO FINDINGS');
    expect(result.attempts).toBe(3);
  });

  it('flags a dead model id as permanent, and only tries once', async () => {
    let calls = 0;
    globalThis.fetch = (async (url: string) => {
      calls++;
      return String(url).includes('models?')
        ? fakeResponse(200, JSON.stringify({ models: [] }))
        : fakeResponse(404, '{"error":"model not found"}');
    }) as never;

    const result = await runGemini();

    expect(result.status).toBe('error');
    expect(result.transient).toBe(false);
    expect(result.attempts).toBe(1);
    expect(calls).toBe(2); // the review call, plus the ListModels lookup
  });

  it('does not retry a SAFETY block — the same diff gets the same verdict', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return fakeResponse(200, geminiEmpty('SAFETY'));
    }) as never;

    const result = await runGemini();

    expect(result.status).toBe('error');
    expect(result.transient).toBe(false);
    expect(calls).toBe(1);
  });

  it('never reports an empty candidate as a clean review', async () => {
    globalThis.fetch = (async () => fakeResponse(200, geminiEmpty('SAFETY'))) as never;
    const result = await runGemini();
    // The whole point: absent must never be indistinguishable from clean.
    expect(result.status).not.toBe('ok');
    expect(result.text).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Backoff arithmetic
// ---------------------------------------------------------------------------

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('reads an HTTP-date', () => {
    const now = Date.parse('2026-08-28T00:00:00Z');
    expect(parseRetryAfter('Fri, 28 Aug 2026 00:00:10 GMT', now)).toBe(10_000);
  });

  it('never returns a negative wait for a date already in the past', () => {
    const now = Date.parse('2026-08-28T00:01:00Z');
    expect(parseRetryAfter('Fri, 28 Aug 2026 00:00:00 GMT', now)).toBe(0);
  });

  it('returns null for a missing or unparseable header', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('backoffMs', () => {
  const noJitter = () => 0;

  it('grows exponentially', () => {
    expect(backoffMs(1, { jitter: noJitter })).toBe(2_000);
    expect(backoffMs(2, { jitter: noJitter })).toBe(4_000);
    expect(backoffMs(3, { jitter: noJitter })).toBe(8_000);
  });

  it('honours Retry-After over its own schedule', () => {
    expect(backoffMs(1, { retryAfterMs: 12_000, jitter: noJitter })).toBe(12_000);
  });

  it('caps the wait — a review that lands after the merge reviewed nothing', () => {
    expect(backoffMs(9, { jitter: noJitter })).toBe(30_000);
    expect(backoffMs(1, { retryAfterMs: 600_000, jitter: noJitter })).toBe(30_000);
  });

  it('adds jitter so two PRs pushed together do not re-collide on the same busy model', () => {
    expect(backoffMs(1, { jitter: () => 0.5 })).toBeGreaterThan(backoffMs(1, { jitter: noJitter }));
  });
});

// ---------------------------------------------------------------------------
// The reviewer stays opt-in, and the lens stays covered
// ---------------------------------------------------------------------------

const WORKFLOW = readFileSync(
  join(ROOT, '.github/workflows/pr-external-review.yml'),
  'utf8'
);

describe('pr-external-review.yml stays opt-in', () => {
  it('does not run on every push — that is what made the reviewer fail on most PRs', () => {
    // `pull_request: types:` must not carry the per-push events. If you are
    // here because you re-added one: the free tier 503'd on three consecutive
    // PRs in four hours. Read the header comment in the workflow first.
    const triggers = WORKFLOW.slice(
      WORKFLOW.indexOf('\non:'),
      WORKFLOW.indexOf('concurrency:')
    );
    expect(triggers).not.toMatch(/types:.*\bsynchronize\b/);
    expect(triggers).not.toMatch(/types:.*\bopened\b/);
    expect(triggers).not.toMatch(/types:.*\breopened\b/);
  });

  it('runs on the external-review label or a manual dispatch', () => {
    expect(WORKFLOW).toMatch(/types:\s*\[labeled\]/);
    expect(WORKFLOW).toContain('workflow_dispatch:');
  });

  it('gates on the label NAME, so an unrelated label does not spend a review', () => {
    expect(WORKFLOW).toContain("github.event.label.name == 'external-review'");
  });

  it('still refuses forked PRs, which cannot see the API key', () => {
    expect(WORKFLOW).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository'
    );
  });
});

const LIVE = readFileSync(join(ROOT, '.claude/commands/live.md'), 'utf8');

describe('/live keeps the cross-cutting lens covered', () => {
  it('has a dedicated, mandatory cross-cutting pass', () => {
    // Making Gemini optional is only safe because Claude picked up its lens.
    // If this step is ever deleted, the reviewer stops running AND the scope
    // it covered quietly vanishes — the exact silent-coverage-drop this whole
    // workflow was built to prevent.
    expect(LIVE).toMatch(/###\s*5b\..*cross-cutting pass/i);
    expect(LIVE).toContain('mandatory');
  });

  it('names the checks that lens owns', () => {
    for (const check of ['Call sites', 'Half-applied refactors', 'two-league page pairs']) {
      expect(LIVE).toContain(check);
    }
  });

  it('never lets an absent reviewer read as a clean one', () => {
    expect(LIVE).toContain('"Gemini: did not run", never "Gemini: clean"');
  });

  it('tells the reader a permanent failure is a bug to fix, not weather', () => {
    expect(LIVE).toMatch(/permanent/i);
    expect(LIVE).toMatch(/misconfigured/i);
  });
});
