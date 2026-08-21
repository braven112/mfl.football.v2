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
 * a 200KB diff is almost always dominated by lockfiles and generated data
 * feeds, and reviewers get worse — not better — when the real change is
 * buried. Callers should pre-filter generated paths; this is the backstop.
 */
export const MAX_DIFF_BYTES = 200_000;

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
- You are ADVISORY. Your findings are adjudicated by a reviewer who owns this codebase and may reject them with reasons. Argue your case in the finding; don't hedge to seem agreeable.`;
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
            // 8000, not 4000: the first live review truncated mid-sentence on
            // its second finding. Flash models spend part of this budget on
            // reasoning before emitting text, so the visible output is well
            // short of the cap.
            generationConfig: { temperature: 0.2, maxOutputTokens: 8000 },
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
          throw new Error(
            `Gemini API 404 for model "${model}": ${body}\n\nModels available to this key: ${available}`
          );
        }
        throw new Error(`Gemini API ${res.status}: ${body}`);
      }

      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts) ? parts.map((p) => p.text ?? '').join('') : '';
      if (!text.trim()) {
        // A blocked or empty candidate is not the same as a clean review, and
        // must not be reported as one.
        throw new Error(
          `Gemini returned no text (finishReason: ${data.candidates?.[0]?.finishReason ?? 'unknown'})`
        );
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
          max_completion_tokens: 4000,
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 500)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text.trim()) {
        throw new Error(
          `OpenAI returned no text (finish_reason: ${data.choices?.[0]?.finish_reason ?? 'unknown'})`
        );
      }
      return text.trim();
    },
  },
};

/**
 * Truncate a diff to MAX_DIFF_BYTES, annotating that it happened.
 *
 * Silent truncation would read to the reviewer as "this is the whole change",
 * so it says so inline — the model should know its coverage is partial.
 */
export function capDiff(diff, maxBytes = MAX_DIFF_BYTES) {
  // Measure BYTES, not string length: .length counts UTF-16 code units, so a
  // diff full of non-ASCII (this repo carries team names and emoji) would sail
  // past a cap that is documented in bytes.
  if (Buffer.byteLength(diff, 'utf8') <= maxBytes) return { diff, truncated: false };
  return {
    diff:
      diff.slice(0, maxBytes) +
      `\n\n[... diff truncated at ${maxBytes} bytes — review the above only ...]`,
    truncated: true,
  };
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
  const { diff: capped, truncated } = capDiff(diff);

  // Repo context goes only to lenses that need it. See the LENSES comment:
  // the cross-cutting lens is unanswerable without knowing the conventions,
  // while the correctness lens is deliberately kept naive so one reviewer can
  // still question a premise the rest of us take for granted.
  const wantsContext = Boolean(lens?.usesRepoContext);
  const preamble = wantsContext && context ? `${context}\n\n` : '';
  const user = `${preamble}Diff under review:\n\n\`\`\`diff\n${capped}\n\`\`\``;

  try {
    const text = await provider.call({
      apiKey,
      model,
      system: buildSystemPrompt(lens),
      user,
    });
    return {
      name,
      label: provider.label,
      status: 'ok',
      model,
      truncated,
      text,
      focus: lens?.focus,
    };
  } catch (error) {
    return {
      name,
      label: provider.label,
      status: 'error',
      model,
      reason: error.message,
    };
  }
}

/**
 * Marker on the sticky PR comment posted by the Actions workflow. Used to
 * find-and-update rather than append a new comment on every push, so a
 * long-lived PR doesn't accumulate a wall of stale reviews. Must stay
 * byte-stable — changing it orphans existing comments.
 *
 * It lives here, next to the renderers, because `renderSections()` is defined
 * by NOT carrying it. See that function.
 */
export const COMMENT_MARKER = '<!-- external-pr-review -->';

/**
 * Prefix of the machine-readable status line every run prints before exiting.
 *
 * `/live` reads this instead of interpreting prose. Without it the caller has
 * to guess from stdout whether a reviewer ran, and "no key configured" exits
 * 0 with a friendly sentence — which is precisely the shape that gets read as
 * a clean pass. One greppable token, three values: ok | degraded | skipped.
 */
export const STATUS_PREFIX = 'EXTERNAL_REVIEW_STATUS:';

/**
 * Collapse per-provider results into one status for the caller.
 *
 * `degraded` exists so a partial run can never round up to `ok`: if two
 * providers were asked for and one 429'd, the lens it held was not covered
 * by anyone, and `/live` has to say so.
 */
export function overallStatus(results) {
  if (!results.length) return 'skipped';
  if (results.every((r) => r.status === 'ok')) return 'ok';
  if (results.some((r) => r.status === 'ok')) return 'degraded';
  return 'skipped';
}

/**
 * Render one provider's result as a markdown section.
 *
 * Errors and skips are rendered explicitly rather than omitted. A reviewer
 * that failed must never be indistinguishable from a reviewer that passed —
 * that is the exact failure mode this whole pipeline exists to fix.
 */
export function renderSection(result) {
  if (result.status === 'skipped') {
    return `### ${result.label}\n\n_Skipped — ${result.reason}._`;
  }
  if (result.status === 'error') {
    return `### ${result.label}\n\n⚠️ **Reviewer failed to run** — ${result.reason}\n\nTreat this as "not reviewed", not as a clean pass.`;
  }
  const truncNote = result.truncated
    ? '\n\n_Note: the diff was truncated — coverage is partial._'
    : '';
  const focus = result.focus ? ` · lens: **${result.focus}**` : '';
  return `### ${result.label}\n\n<sub>\`${result.model}\`${focus}</sub>\n\n${result.text}${truncNote}`;
}

/**
 * The sections alone — no sticky-comment wrapper, and deliberately no
 * COMMENT_MARKER.
 *
 * This is what an in-session run prints (`--section-only`), and the missing
 * marker is the point. The sticky comment belongs to the workflow: an
 * in-session run that carried the marker would be PATCHed over CI's next
 * review — or worse, would itself PATCH CI's comment and replace Gemini's
 * cross-cutting findings with an openai-only body. Two reviewers, one slot,
 * last writer wins. Keep the marker on exactly one producer.
 */
export function renderSections(results) {
  return results.map(renderSection).join('\n\n---\n\n');
}

export function buildComment(results) {
  return `${COMMENT_MARKER}
## External review

Independent reviewers running outside the Claude session, so coverage doesn't depend on which machine \`/live\` was launched from.

${renderSections(results)}

<sub>Posted by \`.github/workflows/pr-external-review.yml\`. Severity headings are parsed by \`/live\`.</sub>`;
}
