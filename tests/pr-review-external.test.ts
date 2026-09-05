import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ProviderHttpError,
  callWithRetry,
  parseRetryAfter,
  backoffMs,
  capDiff,
  splitDiffByFile,
  classifyReviewOutput,
  buildSystemPrompt,
  buildReformatPrompt,
  LENSES,
  MAX_ATTEMPTS,
  MAX_DIFF_BYTES,
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

  it('survives a provider that throws a non-Error, instead of masking it', async () => {
    // The loop writes `.attempts` and reads `.message`. Against a primitive in
    // module strict mode the write throws a TypeError that would escape and
    // replace the provider's real failure with a confusing one.
    for (const junk of ['boom', null, undefined, 42]) {
      let calls = 0;
      const fn = async () => {
        calls++;
        throw junk;
      };

      const error = await callWithRetry(fn, {}, { wait: noWait }).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(String(junk));
      expect(error.attempts).toBe(MAX_ATTEMPTS); // treated as transient, so retried
      expect(calls).toBe(MAX_ATTEMPTS);
    }
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
  // Real `Headers.get()` is case-insensitive, so normalize the map rather than
  // only the lookup key — otherwise a test passing `Retry-After` (the casing
  // the spec and every real response actually use) silently reads as absent,
  // and the stub quietly stops modelling production. (Copilot, PR #648.)
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
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

  it('reads the header off a response regardless of its casing', () => {
    // `Retry-After` is the casing the spec and real responses use; the lookup
    // in the provider asks for `retry-after`. Both must resolve.
    const res = fakeResponse(429, '{}', { 'Retry-After': '7' });
    expect(parseRetryAfter(res.headers.get('retry-after'))).toBe(7_000);
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
    expect(LIVE).toContain('never "Gemini: clean"');
  });

  it('distinguishes "ran but unparseable" from "did not run"', () => {
    // These are different states and the response to them differs: a reviewer
    // that failed to run found nothing because it never looked, while one that
    // answered with prose HAS looked and may be sitting on a real bug. #761's
    // unusable output was the only place that PR's TDZ bug was caught, so
    // collapsing the two loses findings.
    expect(LIVE).toMatch(/output unparseable/i);
    expect(LIVE).toMatch(/Do not collapse/i);
  });

  it('tells the reader which files a partial-coverage review never saw', () => {
    expect(LIVE).toMatch(/Coverage is partial/i);
  });

  it('tells the reader a permanent failure is a bug to fix, not weather', () => {
    expect(LIVE).toMatch(/permanent/i);
    expect(LIVE).toMatch(/misconfigured/i);
  });
});

// ---------------------------------------------------------------------------
// The output contract, Sep 2026 (PR #761)
// ---------------------------------------------------------------------------

/**
 * The bug: Gemini's review of PR #761 came back as a raw reasoning trace —
 * "wait, why did the author name the variable…" — with no severity heading in
 * it, cut off mid-sentence, and flagged only as "coverage is partial".
 *
 * Two independent failures, and this block pins both fixes:
 *
 *  1. `/live` tallies findings BY severity heading, so prose with no heading
 *     tallies as zero findings — identical to a clean review. An unparseable
 *     reviewer must never render like a reviewer with nothing to say.
 *  2. The diff was byte-sliced at 200KB, which cut mid-hunk and silently
 *     dropped whichever files sorted last. On #761 the dropped tail was the
 *     registry and API files the cross-cutting lens exists to check, so the
 *     truncation removed exactly the evidence the reviewer was asked for.
 */
describe('classifyReviewOutput refuses to read prose as a clean review', () => {
  it('rejects the actual PR #761 output', () => {
    const real = [
      'inner `const defaultRankingSource` which is currently in TDZ!',
      'Wait, why did the author name the variable `const defaultRankingSource = ...`?',
      'The author refactored it to use the prop, but wrote:',
    ].join('\n');
    expect(classifyReviewOutput(real)).toBe('unstructured');
  });

  it('accepts the three severity headings the contract names', () => {
    for (const heading of ['## Critical', '## Important', '## Suggestions']) {
      expect(classifyReviewOutput(`${heading}\n- something at foo.ts:1`)).toBe('structured');
    }
  });

  it('accepts NO FINDINGS, including the emphasis models like to add', () => {
    for (const reply of ['NO FINDINGS', '**NO FINDINGS**', 'no findings.', '`NO FINDINGS`']) {
      expect(classifyReviewOutput(reply)).toBe('no-findings');
    }
  });

  it('separates empty from unstructured — one is a failed call, the other a failed format', () => {
    expect(classifyReviewOutput('')).toBe('empty');
    expect(classifyReviewOutput('   \n  ')).toBe('empty');
  });

  it('does not accept an invented severity word as structure', () => {
    // The whole point of the contract: `/live` counts these three labels and
    // nothing else, so a reviewer that invents "## Blocker" reads as zero.
    expect(classifyReviewOutput('## Blocker\n- bad thing at foo.ts:1')).toBe('unstructured');
  });
});

describe('the system prompt states the output contract', () => {
  const prompt = buildSystemPrompt(LENSES.gemini);

  it('forbids the reasoning trace that broke #761', () => {
    expect(prompt).toMatch(/OUTPUT CONTRACT/);
    expect(prompt).toMatch(/Never narrate your thinking/i);
  });

  it('pins the exact severity vocabulary /live parses', () => {
    for (const heading of ['## Critical', '## Important', '## Suggestions']) {
      expect(prompt).toContain(heading);
    }
  });

  it('has a salvage prompt that reformats without re-judging', () => {
    const reformat = buildReformatPrompt();
    expect(reformat).toMatch(/Do NOT add findings\. Do NOT drop findings/);
    expect(reformat).toMatch(/formatting pass, not a reviewer/i);
  });
});

describe('capDiff drops whole files rather than cutting mid-hunk', () => {
  // Three files, ~120 bytes of body each.
  const file = (path: string, body: string) =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n+${body}\n`;
  const diff = file('a.ts', 'x'.repeat(200)) + file('b.ts', 'y'.repeat(200)) + file('z.ts', 'z'.repeat(200));

  it('leaves a diff under the cap completely alone', () => {
    const result = capDiff(diff, 10_000);
    expect(result.truncated).toBe(false);
    expect(result.diff).toBe(diff);
    expect(result.omittedFiles).toEqual([]);
  });

  it('names the files it omitted, so partial coverage is locatable', () => {
    const result = capDiff(diff, 300);
    expect(result.truncated).toBe(true);
    expect(result.omittedFiles.length).toBeGreaterThan(0);
    // Every omitted path is named in the prompt text too — the model must know
    // the boundary of what it is allowed to claim.
    for (const path of result.omittedFiles) {
      expect(result.diff).toContain(path);
    }
  });

  it('never emits a half-written hunk', () => {
    const result = capDiff(diff, 300);
    // Whatever survived is whole-file: each retained `diff --git` header has
    // its complete body, so the model never sees an incomplete change and
    // mistakes it for a broken one.
    const kept = result.diff.split('[... diff truncated')[0];
    const headers = kept.match(/^diff --git /gm) ?? [];
    expect(headers.length + result.omittedFiles.length).toBe(3);
  });

  it('still sends something when one file is bigger than the whole budget', () => {
    // Degenerate case: file-granular packing would otherwise omit everything
    // and hand the model an empty diff — a "clean review" of nothing.
    const huge = file('huge.ts', 'q'.repeat(5_000));
    const result = capDiff(huge, 500);
    expect(result.truncated).toBe(true);
    expect(result.diff).toContain('diff --git a/huge.ts');
    expect(result.diff.length).toBeGreaterThan(0);
  });

  it('measures bytes, not UTF-16 code units', () => {
    // This repo carries team names and emoji; a cap documented in bytes that
    // counted .length would let a non-ASCII diff sail past it.
    const emoji = file('e.ts', '🏈'.repeat(100));
    expect(Buffer.byteLength(emoji, 'utf8')).toBeGreaterThan(emoji.length);
    expect(capDiff(emoji, emoji.length).truncated).toBe(true);
  });

  it('parses every file out of a real multi-file diff', () => {
    expect(splitDiffByFile(diff).map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'z.ts']);
  });

  it('carries a cap large enough for the diffs /live actually sends it', () => {
    // PR #761's filtered diff was 276KB. A cap below that guarantees partial
    // coverage on exactly the large cross-cutting diffs this reviewer is
    // dispatched for.
    expect(MAX_DIFF_BYTES).toBeGreaterThanOrEqual(276_000);
  });
});

describe('an unparseable review does not render like a clean one', () => {
  const SCRIPT = readFileSync(join(ROOT, 'scripts/pr-review-external.mjs'), 'utf8');

  it('renders a malformed result as its own flagged state', () => {
    expect(SCRIPT).toMatch(/result\.malformed/);
    expect(SCRIPT).toMatch(/did not follow the review format/i);
    expect(SCRIPT).toMatch(/Do not count this as a clean pass/i);
  });

  it('preserves the raw output instead of discarding the findings in it', () => {
    // #761's unusable prose held a real TDZ bug no other reviewer caught.
    // Throwing it away to enforce a format would be a worse bug than the one
    // being fixed.
    expect(SCRIPT).toMatch(/<details><summary>Raw reviewer output/);
  });

  it('fences the raw output so the finding tally cannot read it as findings', () => {
    expect(SCRIPT).toMatch(/not machine-parseable/i);
  });

  it('names the omitted files in the truncation note', () => {
    expect(SCRIPT).toMatch(/omittedFiles/);
    expect(SCRIPT).toMatch(/Coverage is partial/i);
  });
});

describe('the salvage pass rescues a review that broke its own format', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  // Trimmed from the comment Gemini actually posted on PR #761.
  const TRACE = [
    'inner `const defaultRankingSource` which is currently in TDZ!',
    'Wait, why did the author name the variable that?',
    'The author refactored it to use the prop, but wrote:',
  ].join('\n');

  it('reformats unstructured prose into the contract, keeping the finding', async () => {
    const bodies = [
      geminiOk(TRACE),
      geminiOk('## Critical\n- TDZ self-reference at DraftMockLobby.astro:1'),
    ];
    globalThis.fetch = (async () => fakeResponse(200, bodies.shift()!)) as never;

    const result = await runGemini();

    expect(result.status).toBe('ok');
    expect(result.salvaged).toBe(true);
    expect(result.malformed).toBe(false);
    expect(result.text).toContain('## Critical');
    // The finding itself survives the reformat — that is the whole point.
    expect(result.text).toContain('DraftMockLobby.astro');
  });

  it('keeps the ORIGINAL notes when the reformat also fails the contract', async () => {
    // Losing #761's prose would have lost the only report of a real shipping
    // bug. Enforcing a format must never cost a finding.
    globalThis.fetch = (async () => fakeResponse(200, geminiOk(TRACE))) as never;

    const result = await runGemini();

    expect(result.status).toBe('ok');
    expect(result.malformed).toBe(true);
    expect(result.salvaged).toBe(false);
    expect(result.text).toBe(TRACE);
  });

  it('survives a reformat pass that throws, rather than losing the review to it', async () => {
    let n = 0;
    vi.spyOn(globalThis, 'setTimeout' as never).mockImplementation(((fn: () => void) => {
      fn();
      return 0 as never;
    }) as never);
    globalThis.fetch = (async () =>
      ++n === 1 ? fakeResponse(200, geminiOk(TRACE)) : fakeResponse(500, '{"error":"boom"}')) as never;

    const result = await runGemini();

    expect(result.status).toBe('ok');
    expect(result.malformed).toBe(true);
    expect(result.text).toBe(TRACE);
  });

  it('spends no extra quota on a review that already followed the contract', async () => {
    // The salvage pass is a second API call on a shared free tier. It must
    // fire only on the failure it exists for.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return fakeResponse(200, geminiOk('## Important\n- something at foo.ts:1'));
    }) as never;

    const result = await runGemini();

    expect(calls).toBe(1);
    expect(result.malformed).toBe(false);
    expect(result.salvaged).toBe(false);
  });

  it('does not fire on NO FINDINGS — that is a conforming answer, not prose', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return fakeResponse(200, geminiOk('NO FINDINGS'));
    }) as never;

    await runGemini();
    expect(calls).toBe(1);
  });

  it('drops the thinking parts Gemini returns alongside the answer', async () => {
    // Gemini marks reasoning with `thought: true` in the SAME parts array as
    // the answer, so joining the array blindly prepends the model's
    // deliberation to its review — one of the two ways #761's comment became
    // a wall of "wait, why did the author…".
    globalThis.fetch = (async () =>
      fakeResponse(
        200,
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Wait, let me reconsider that...', thought: true },
                  { text: '## Critical\n- real finding at foo.ts:1' },
                ],
              },
            },
          ],
        })
      )) as never;

    const result = await runGemini();

    expect(result.text).not.toContain('Wait, let me reconsider');
    expect(result.text).toBe('## Critical\n- real finding at foo.ts:1');
  });
});
