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
 * Shared reviewer instructions.
 *
 * The severity vocabulary is load-bearing: `/live` tallies findings by these
 * three labels to decide whether to block the merge, so a provider that
 * invents its own severity words silently reads as a clean pass.
 */
export const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer on a production Astro + React + TypeScript codebase.

Review the supplied diff for bugs, logic errors, security issues, and missed edge cases.

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
- Be direct and specific. A vague concern is worse than no concern.`;

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
    defaultModel: 'gemini-2.5-pro',
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
            generationConfig: { temperature: 0.2, maxOutputTokens: 4000 },
          }),
        }
      );

      if (!res.ok) {
        throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 500)}`);
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
  if (diff.length <= maxBytes) return { diff, truncated: false };
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
  const { diff: capped, truncated } = capDiff(diff);
  const user = `${context ? `${context}\n\n` : ''}Diff under review:\n\n\`\`\`diff\n${capped}\n\`\`\``;

  try {
    const text = await provider.call({
      apiKey,
      model,
      system: REVIEW_SYSTEM_PROMPT,
      user,
    });
    return { name, label: provider.label, status: 'ok', model, truncated, text };
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
