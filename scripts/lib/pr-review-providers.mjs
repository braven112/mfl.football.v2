// External PR reviewers (Gemini, OpenAI) as raw fetch calls.
//
// WHY NOT THE CLIs: the `gemini` and `codex` CLIs authenticate interactively
// (OAuth against a personal subscription). That works on a laptop and cannot
// work anywhere headless — no browser, no ~/.gemini/oauth_creds.json, and in
// the Claude cloud sandbox the binaries aren't installed at all. That's the
// reason the in-session Codex reviewer no-ops unpredictably. Raw fetch + an
// API key from repo secrets is the only auth that behaves identically in CI,
// on a laptop, and in a cloud agent session.
//
// Consequence worth stating plainly: API-key usage is BILLED per token and is
// NOT covered by a Gemini or ChatGPT subscription. Different meter entirely.
//
// Same shape as scripts/article-utils/ai-client.mjs — raw fetch, no SDK.

/**
 * Diff bytes beyond this are dropped before the prompt is built.
 *
 * Both models accept far more than this. The cap is about cost and signal:
 * a huge diff is often dominated by lockfiles and generated data feeds, and
 * reviewers get worse — not better — when the real change is buried. Callers
 * should pre-filter generated paths; this is the backstop.
 *
 * Raised from 200KB after PR #761. That PR's filtered diff was 276KB across 32
 * files, so the cap dropped ten whole files and cut an eleventh mid-hunk — and
 * because `git diff` emits paths in sorted order, the tail it dropped was
 * `src/pages/api/mock-draft/*`, `src/utils/mock-draft-scope.ts`,
 * `page-directory.json` and `nav-config.json`. Those are the registry and
 * call-site files the cross-cutting lens exists to check, so the truncation
 * removed exactly the evidence the reviewer was asked for. 400KB is roughly
 * 100k input tokens, still inside a single free-tier request.
 */
export const MAX_DIFF_BYTES = 400_000;

/**
 * HTTP statuses worth a second attempt.
 *
 * 503 is the one that matters here. Google returns it as "This model is
 * currently experiencing high demand" — an explicit *try again later*, not a
 * quota wall — and with a single-shot request it rendered as "Reviewer failed
 * to run" on PRs #639, #644 and #646 inside four hours. Three consecutive
 * no-reviews is what made the reviewer look permanently broken when the actual
 * fault was one busy minute on Google's side.
 *
 * 429 is retried too but is a different animal: a per-minute rate limit clears
 * in seconds, while an exhausted daily quota will not clear within any backoff
 * we are willing to hold a CI job for. Retrying costs one extra request and
 * fixes the first case, so it is in.
 *
 * NOT retried: 400 (malformed request), 401/403 (bad key), 404 (dead model id).
 * Those are the same on attempt five as on attempt one, and a backoff turns an
 * instant actionable error into a slow one.
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** Total attempts per provider call (1 initial + 3 retries). */
export const MAX_ATTEMPTS = 4;

/** Base backoff in ms; attempt N waits BASE * 2^(N-1) plus jitter. */
const BACKOFF_BASE_MS = 2_000;

/**
 * An HTTP failure that carries whether it is worth retrying.
 *
 * The distinction survives all the way to the PR comment: a transient failure
 * says the reviewer was unlucky, a permanent one says something is misconfigured
 * and a human should look. Collapsing both into "failed to run" is what left a
 * dead model id and a busy minute looking identical.
 */
export class ProviderHttpError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, retryable: boolean, retryAfterMs?: number | null }} options
   */
  constructor(message, { status, retryable, retryAfterMs = null }) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parse `Retry-After` (delta-seconds or HTTP-date) into ms, or null.
 *
 * @param {string | null | undefined} headerValue
 * @param {number} [now]
 * @returns {number | null}
 */
export function parseRetryAfter(headerValue, now = Date.now()) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(headerValue);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Delay before attempt `attempt` (1-indexed retry count).
 *
 * Jitter is not decoration: the workflow's concurrency group cancels in-flight
 * runs, but two PRs pushed together produce two jobs whose retries would
 * otherwise land on the same millisecond and re-collide on the same busy model.
 *
 * Capped at 30s. The whole job is advisory and holds no merge, but a reviewer
 * that reports back after the PR has already merged has reviewed nothing.
 *
 * @param {number} attempt 1-indexed retry number.
 * @param {{ retryAfterMs?: number | null, jitter?: () => number }} [options]
 * @returns {number}
 */
export function backoffMs(attempt, { retryAfterMs = null, jitter = Math.random } = {}) {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, 30_000);
  const exponential = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return Math.min(exponential + Math.floor(jitter() * 1_000), 30_000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call a provider with retries on transient failures.
 *
 * Retries the TRANSPORT, never the judgement: a provider that answers with an
 * empty candidate gets one more go (it is a content-filter or truncation blip
 * on Google's side, not a considered "no findings"), but a provider that
 * returns real text is done — re-rolling until we like the review would be
 * shopping for an opinion, not reviewing.
 */
export async function callWithRetry(call, args, { maxAttempts = MAX_ATTEMPTS, onRetry = () => {}, wait = sleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return { text: await call(args), attempts: attempt };
    } catch (thrown) {
      // Normalize before touching it. `throw 'boom'` and `throw null` are both
      // legal — a future provider, or a test stub, can do either — and this
      // loop WRITES a property (`.attempts`) and READS `.message`. Against a
      // primitive in module strict mode that write throws a TypeError of its
      // own, which escapes the loop and replaces the provider's real failure
      // with a confusing one. (Copilot, PR #648.)
      const error = thrown instanceof Error ? thrown : new Error(String(thrown));
      lastError = error;

      // Report the real count on the error rather than making the caller infer
      // it from `retryable`. The inference happens to be right while every
      // transient path exhausts the budget, and would go quietly wrong the
      // first time one didn't.
      error.attempts = attempt;

      // A non-HTTP throw is a fetch/DNS/socket failure — transient by nature.
      const retryable = error instanceof ProviderHttpError ? error.retryable : true;
      if (!retryable || attempt === maxAttempts) break;

      const delay = backoffMs(attempt, {
        retryAfterMs: error instanceof ProviderHttpError ? error.retryAfterMs : null,
      });
      onRetry({ attempt, maxAttempts, delay, reason: error.message });
      await wait(delay);
    }
  }
  throw lastError;
}

/**
 * Per-provider review lenses.
 *
 * WHY LENSES: three models given one identical prompt produce heavily
 * correlated findings — you pay N times for close to 1x coverage. Distinct
 * mandates guarantee distinct coverage even if the models are equally
 * capable, so this is a decorrelation play first and a capability play second.
 *
 * The assignment does lean on a real asymmetry, though:
 *
 * - Gemini gets the cross-cutting lens because it has the context budget to
 *   hold the diff AND the repo's conventions at once. That lens is the one
 *   that NEEDS repo context to work — "you missed a call site" is unanswerable
 *   without knowing what the call sites are.
 *
 * - Codex gets the correctness/security lens and is deliberately kept
 *   context-free. The whole value of an outside reviewer is that it doesn't
 *   share this repo's priors; feed it CLAUDE.md and it starts reviewing for
 *   conformance to documented intent instead of asking whether the intent is
 *   right. Several of this repo's worst bugs were rules that were themselves
 *   wrong (the AFL draft window three rulebook surfaces agreed on, describing
 *   a window the league had never drafted in). Keep one reviewer able to see
 *   that.
 */
export const LENSES = {
  gemini: {
    focus: 'cross-cutting consistency',
    usesRepoContext: true,
    instructions: `Your assigned lens is CROSS-CUTTING CONSISTENCY. Other reviewers cover line-level correctness and security — do not duplicate them.

Look for:
- Call sites the change missed. If a function's signature, contract, or return shape changed, are ALL callers updated?
- Half-applied refactors — a pattern introduced in one file but not its siblings.
- Contradictions with conventions visible elsewhere in the diff or stated below.
- Changes that will silently diverge from a parallel implementation (this codebase runs two leagues with near-identical page pairs; a fix applied to one and not the other is a real and recurring bug here).
- Docs, tests, or registries that should have been updated alongside the code.`,
  },
  openai: {
    focus: 'correctness & security',
    usesRepoContext: false,
    instructions: `Your assigned lens is CORRECTNESS AND SECURITY. Another reviewer covers architectural consistency — do not duplicate it.

Look for:
- Null/undefined dereferences, off-by-one errors, wrong operators, inverted conditions.
- Unhandled promise rejections, swallowed errors, error paths that report success.
- Injection (shell, SQL, path traversal), unsafe interpolation, SSRF, auth bypass.
- Race conditions, TOCTOU, concurrent-write clobbering.
- Edge cases: empty input, single-element collections, unicode, very large input.

You have deliberately NOT been given this repo's conventions document. If something looks wrong, say so even if it looks intentional — an outside perspective that questions the premise is exactly what you are here for.`,
  },
};

/**
 * Build reviewer instructions for one lens.
 *
 * The severity vocabulary is load-bearing: `/live` tallies findings by these
 * three labels to decide whether to block the merge, so a provider that
 * invents its own severity words silently reads as a clean pass.
 */
export function buildSystemPrompt(lens) {
  return `You are a senior code reviewer on a production Astro + React + TypeScript codebase.

Review the supplied diff for problems.

${lens?.instructions ?? ''}

Output format — use these EXACT headings, and omit a heading entirely if it has no findings:

## Critical
(blocks ship — data loss, security holes, crashes, user-visible breakage)

## Important
(should fix soon — wrong-but-recoverable behavior, missing error handling)

## Suggestions
(optional polish)

Rules:
- Cite \`path:line\` for every finding.
- Do NOT comment on formatting or code style. Automated tooling and other reviewers cover it.
- Do NOT restate what the diff does. Only report problems.
- If you find nothing, reply with exactly: NO FINDINGS
- Be direct and specific. A vague concern is worse than no concern.
- You are ADVISORY. Your findings are adjudicated by a reviewer who owns this codebase and may reject them with reasons. Argue your case in the finding; don't hedge to seem agreeable.

OUTPUT CONTRACT — your reply is parsed by a machine, not just read by a human:
- Emit ONLY the finished findings. Your reasoning, deliberation and working notes are NOT part of the answer.
- Never narrate your thinking. No "wait", no "let me check", no "why did the author...", no correcting yourself mid-sentence, no walking back an earlier guess. Do that work before you write, then write only the conclusion.
- The FIRST characters of your reply must be either a \`##\` severity heading above or the exact string NO FINDINGS. Nothing may precede it — no preamble, no summary, no restatement of the task.
- Reply with the severity headings verbatim: \`## Critical\`, \`## Important\`, \`## Suggestions\`. Invented severity words are dropped on the floor and your review counts as never having run.
- Budget your length so the reply finishes. A trailing, half-written finding is worth less than one finding fewer.`;
}

/**
 * System prompt for the salvage pass.
 *
 * Fires only when a reviewer answered with prose instead of the contract. It
 * gets the model's OWN output back and reformats it — no diff, so it is a
 * cheap call, and it cannot invent a finding because it never sees the code.
 *
 * A reformat rather than a re-roll on purpose. Re-rolling the review would
 * spend a full diff-sized request AND throw away whatever the first pass
 * found — and the first pass is not usually wrong, just badly packaged. On
 * PR #761 the unusable prose contained a real TDZ bug that no other reviewer
 * caught; losing that to a formatting failure is the expensive mistake here.
 */
export function buildReformatPrompt() {
  return `You are a formatting pass, not a reviewer. You will be given the raw working notes of a code reviewer who failed to follow their output format.

Re-emit the findings those notes contain, using these EXACT headings, omitting any heading with no findings:

## Critical
## Important
## Suggestions

Rules:
- Do NOT add findings. Do NOT drop findings. Do NOT re-judge them. You cannot see the code, so you are in no position to.
- Strip all reasoning, deliberation and self-correction. Keep only what the notes concluded.
- Where the notes reached a conclusion but were cut off before finishing, state the conclusion they reached and mark it \`(truncated — the reviewer was cut off here)\`.
- Keep every \`path:line\` citation the notes give.
- If the notes contain no actual finding, reply with exactly: NO FINDINGS
- Your FIRST characters must be a \`##\` heading or NO FINDINGS. No preamble.`;
}

/** A `## Critical` / `## Important` / `## Suggestions` heading on its own line. */
const SEVERITY_HEADING = /^[ \t]*#{2,3}[ \t]*(Critical|Important|Suggestions?)\b/im;

/** "NO FINDINGS", allowing the markdown emphasis and trailing period models add. */
const NO_FINDINGS = /^[*_`\s]*NO[ \t]+FINDINGS[*_`.\s]*$/i;

/**
 * Decide whether a reviewer's reply honours the output contract.
 *
 * This is the guard that stops PR #761 from happening again. That review came
 * back as a raw reasoning trace — "wait, why did the author name the
 * variable..." — with no severity heading anywhere in it. `/live` tallies
 * findings BY those headings, so an unparseable reply and a clean review were
 * indistinguishable to it: a reviewer that had actually found a shipping bug
 * read as a reviewer with nothing to say.
 *
 * @param {string} text
 * @returns {'empty' | 'no-findings' | 'structured' | 'unstructured'}
 */
export function classifyReviewOutput(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return 'empty';
  if (NO_FINDINGS.test(trimmed)) return 'no-findings';
  if (SEVERITY_HEADING.test(trimmed)) return 'structured';
  return 'unstructured';
}

/**
 * List model ids this API key can call, newest-looking first.
 *
 * Only used to turn a 404 into an actionable error message. Filtered to models
 * that actually support generateContent — the list also carries embedding and
 * legacy models that would 400 on a review request.
 */
async function listGeminiModels(apiKey) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) throw new Error(`ListModels ${res.status}`);
  const data = await res.json();
  const usable = (data.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => !/embedding|aqa|vision-latest/.test(n));
  return usable.length ? usable.join(', ') : '(none support generateContent)';
}

/**
 * Provider registry.
 *
 * Each entry owns its endpoint shape and response unwrapping. Model ids are
 * injected by the caller (from the workflow env) rather than hardcoded here,
 * because model ids churn faster than this code does — a 404 from either API
 * almost always means the id needs bumping, and the workflow is the one
 * obvious place to bump it.
 */
export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    envKey: 'GEMINI_API_KEY',
    // Must stay in sync with GEMINI_REVIEW_MODEL in pr-external-review.yml.
    // This is the value a LOCAL run gets with no env override, so a stale id
    // here fails only off-CI — which is exactly how it went unnoticed: the
    // workflow was updated off gemini-2.5-pro and this was not. (Caught by
    // the Gemini reviewer's own cross-cutting lens on PR #544.)
    defaultModel: 'gemini-flash-latest',
    async call({ apiKey, model, system, user }) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            // 16000, not 8000: PR #761 still ran out, and stopped mid-sentence
            // on "The author refactored it to use the prop, but wrote:". Flash
            // models spend part of this budget on reasoning before emitting
            // text, so the visible output is well short of the cap — and a
            // review cut off before its conclusion is a review of nothing.
            generationConfig: { temperature: 0.2, maxOutputTokens: 16000 },
          }),
        }
      );

      if (!res.ok) {
        const body = (await res.text()).slice(0, 500);
        // Model ids churn — Google retires them for new API consumers with no
        // warning, and a hardcoded guess goes stale silently. On a 404, ask the
        // API which models this key can actually use and put the answer in the
        // error, so fixing it is a copy-paste rather than another guess.
        if (res.status === 404) {
          const available = await listGeminiModels(apiKey).catch((e) => `(lookup failed: ${e.message})`);
          throw new ProviderHttpError(
            `Gemini API 404 for model "${model}": ${body}\n\nModels available to this key: ${available}`,
            { status: 404, retryable: false }
          );
        }
        throw new ProviderHttpError(`Gemini API ${res.status}: ${body}`, {
          status: res.status,
          retryable: RETRYABLE_STATUSES.has(res.status),
          retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
        });
      }

      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts;
      // Drop thought parts. Gemini marks its reasoning with `thought: true` in
      // the SAME parts array as the answer, so joining the array blindly
      // concatenates the model's deliberation onto the front of its review.
      // That is one of the two ways PR #761's comment became a wall of "wait,
      // why did the author…" instead of findings.
      const text = Array.isArray(parts)
        ? parts.filter((part) => part?.thought !== true).map((p) => p.text ?? '').join('')
        : '';
      if (!text.trim()) {
        // A blocked or empty candidate is not the same as a clean review, and
        // must not be reported as one.
        //
        // Whether to retry depends on WHY it was empty. SAFETY and RECITATION
        // are verdicts on the diff itself — the same bytes get the same answer
        // every time, so retrying just spends four calls of a quota we made
        // scarce on purpose. MAX_TOKENS and the rest are blips (the model can
        // spend its whole budget on reasoning and emit nothing) and a second
        // roll at temperature 0.2 usually comes back with real text.
        const finishReason = data.candidates?.[0]?.finishReason ?? 'unknown';
        const deterministic = finishReason === 'SAFETY' || finishReason === 'RECITATION';
        throw new ProviderHttpError(`Gemini returned no text (finishReason: ${finishReason})`, {
          status: 200,
          retryable: !deterministic,
        });
      }
      return text.trim();
    },
  },

  openai: {
    label: 'Codex (OpenAI)',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5',
    async call({ apiKey, model, system, user }) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          // Matches Gemini's budget. Reasoning models spend part of it before
          // emitting any text, so a tight cap buys a review that stops
          // mid-finding — see the note on maxOutputTokens above.
          max_completion_tokens: 16000,
        }),
      });

      if (!res.ok) {
        throw new ProviderHttpError(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 500)}`, {
          status: res.status,
          retryable: RETRYABLE_STATUSES.has(res.status),
          retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
        });
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) {
        throw new ProviderHttpError(
          `OpenAI returned no text (finish_reason: ${data.choices?.[0]?.finish_reason ?? 'unknown'})`,
          { status: 200, retryable: true }
        );
      }
      return text.trim();
    },
  },
};

/**
 * Split a unified diff into one chunk per file, preserving order.
 *
 * Anything before the first `diff --git` header (git emits nothing there, but
 * a caller could paste a preamble) is kept as a leading chunk with no path, so
 * splitting never silently eats bytes.
 *
 * @param {string} diff
 * @returns {Array<{ path: string | null, text: string }>}
 */
export function splitDiffByFile(diff) {
  const chunks = [];
  let current = null;
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      if (current) chunks.push(current);
      // Prefer the b/ path: for a rename, that is where the code lives now.
      current = { path: header[2], lines: [] };
    } else if (!current) {
      current = { path: null, lines: [] };
    }
    current.lines.push(line);
  }
  if (current) chunks.push(current);
  return chunks
    .map((c) => ({ path: c.path, text: c.lines.join('\n') }))
    .filter((c) => c.text.length > 0);
}

/**
 * Cap a diff at `maxBytes`, dropping WHOLE FILES rather than cutting mid-hunk.
 *
 * The old implementation was a raw `diff.slice(0, maxBytes)`. Two things were
 * wrong with that, and PR #761 hit both:
 *
 *  1. It cut inside a file, handing the model half a hunk. A reviewer reading a
 *     truncated hunk cannot tell an incomplete change from a broken one.
 *  2. It never said WHICH files it dropped. `git diff` emits paths in sorted
 *     order, so "truncated" always means "everything after src/p… is gone" —
 *     and nobody reading the PR comment could know that. Coverage was partial
 *     in a way neither the model nor the human could locate.
 *
 * Now the omitted files are named, both in the prompt (so the model knows the
 * boundary of what it may claim) and in the returned metadata (so the PR
 * comment can tell the human exactly which files went unreviewed).
 *
 * @param {string} diff
 * @param {number} [maxBytes]
 * @returns {{ diff: string, truncated: boolean, omittedFiles: string[] }}
 */
export function capDiff(diff, maxBytes = MAX_DIFF_BYTES) {
  // Measure BYTES, not string length: .length counts UTF-16 code units, so a
  // diff full of non-ASCII (this repo carries team names and emoji) would sail
  // past a cap that is documented in bytes.
  if (Buffer.byteLength(diff, 'utf8') <= maxBytes) {
    return { diff, truncated: false, omittedFiles: [] };
  }

  const files = splitDiffByFile(diff);
  const kept = [];
  const omitted = [];
  let used = 0;

  for (const file of files) {
    const size = Buffer.byteLength(file.text, 'utf8');
    if (used + size <= maxBytes) {
      kept.push(file.text);
      used += size;
    } else {
      omitted.push(file.path ?? '(diff preamble)');
    }
  }

  // A single file larger than the whole budget would otherwise omit everything
  // and send the model an empty diff — a "clean review" of nothing. Byte-cut
  // that one file instead: partial coverage of the real change beats none.
  if (kept.length === 0 && files.length > 0) {
    kept.push(`${files[0].text.slice(0, maxBytes)}\n[... this file's diff was cut at ${maxBytes} bytes ...]`);
    omitted.shift();
  }

  // A single over-budget file leaves nothing in `omitted`; it already carries
  // its own inline cut marker, so don't append an empty "0 files omitted" list.
  const note = omitted.length
    ? [
        '',
        '',
        `[... diff truncated: ${omitted.length} file(s) omitted entirely to fit ${maxBytes} bytes.`,
        'You have NOT seen these files. Do not claim a call site is unupdated if it lives in one of them:',
        ...omitted.map((path) => `  - ${path}`),
        '...]',
      ].join('\n')
    : '';

  return { diff: kept.join('\n') + note, truncated: true, omittedFiles: omitted };
}

/**
 * Run one provider against a diff.
 *
 * Resolves to a result object rather than throwing, so one provider being
 * down (rate limit, bad model id, expired key) never suppresses the other's
 * findings — the orchestrator reports the error in the PR comment instead.
 */
export async function runProvider(name, { diff, context = '', env = process.env }) {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown review provider: ${name}`);

  const apiKey = env[provider.envKey];
  if (!apiKey) {
    return { name, label: provider.label, status: 'skipped', reason: `${provider.envKey} not set` };
  }

  const model = env[`${name.toUpperCase()}_REVIEW_MODEL`] || provider.defaultModel;
  const lens = LENSES[name];
  const { diff: capped, truncated, omittedFiles } = capDiff(diff);

  // Repo context goes only to lenses that need it. See the LENSES comment:
  // the cross-cutting lens is unanswerable without knowing the conventions,
  // while the correctness lens is deliberately kept naive so one reviewer can
  // still question a premise the rest of us take for granted.
  const wantsContext = Boolean(lens?.usesRepoContext);
  const preamble = wantsContext && context ? `${context}\n\n` : '';
  const user = `${preamble}Diff under review:\n\n\`\`\`diff\n${capped}\n\`\`\``;

  try {
    const { text, attempts } = await callWithRetry(
      provider.call,
      { apiKey, model, system: buildSystemPrompt(lens), user },
      {
        onRetry: ({ attempt, maxAttempts, delay, reason }) =>
          console.log(
            `  ${provider.label}: attempt ${attempt}/${maxAttempts} failed (${reason.split('\n')[0]}) — retrying in ${Math.round(delay / 1000)}s`
          ),
      }
    );
    // The transport succeeded — but "the model replied" is not "the model
    // reviewed". `/live` tallies findings by severity heading, so a reply with
    // no heading in it reads to the tally as zero findings, which is the same
    // thing a clean review reads as. Classify before returning, and never let
    // those two states render alike.
    const shape = classifyReviewOutput(text);
    let finalText = text;
    let malformed = false;
    let salvaged = false;

    if (shape === 'unstructured') {
      console.log(
        `  ${provider.label}: reply did not follow the output contract — attempting one reformat pass`
      );
      try {
        const reformatted = await provider.call({
          apiKey,
          model,
          system: buildReformatPrompt(),
          user: `Raw reviewer notes to reformat:\n\n${text}`,
        });
        if (classifyReviewOutput(reformatted) === 'unstructured') {
          // The salvage pass failed too. Keep the ORIGINAL notes rather than
          // the reformat's — they are the ones that actually saw the code.
          malformed = true;
        } else {
          finalText = reformatted;
          salvaged = true;
        }
      } catch (reformatError) {
        // Never let the salvage pass destroy the review it was meant to save.
        console.log(`  ${provider.label}: reformat pass failed (${reformatError.message.split('\n')[0]})`);
        malformed = true;
      }
    }

    return {
      name,
      label: provider.label,
      status: 'ok',
      model,
      truncated,
      omittedFiles,
      text: finalText,
      malformed,
      salvaged,
      attempts,
      focus: lens?.focus,
    };
  } catch (error) {
    // Transient vs permanent is the actionable half of the message. "Busy,
    // try again" and "your model id is dead" both used to render as the same
    // "Reviewer failed to run", so nobody could tell a bad hour from a
    // misconfiguration without opening the run log.
    const transient = !(error instanceof ProviderHttpError) || error.retryable;
    return {
      name,
      label: provider.label,
      status: 'error',
      model,
      transient,
      attempts: error.attempts ?? 1,
      reason: error.message,
    };
  }
}
