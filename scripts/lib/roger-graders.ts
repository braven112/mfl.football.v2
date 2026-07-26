/**
 * Shared deterministic graders for Ask Roger answers.
 *
 * Used by BOTH the golden-dataset eval (tests/eval/roger.eval.ts) and the
 * production-traffic improvement loop (scripts/roger-improvement-loop.ts),
 * so the format contract is defined exactly once.
 */

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// The prompt's 300-word contract, with a small grace margin so borderline
// counts don't produce flaky failures.
export const WORD_LIMIT = 320;

/**
 * The two link forms the prompt permits, anchored to the WHOLE last line —
 * the contract is "a rulebook link on its own line", so trailing prose or a
 * sentence wrapped around the link is a violation, not a pass.
 *
 * The two forms are not interchangeable: a section link must carry an anchor
 * ("Read the full rule"), and the no-match fallback must not ("Read the full
 * rulebook"). An unanchored `[Read the full rule](/theleague/rules)` is
 * neither and fails.
 */
export const SECTION_LINK_RE = /^\[Read the full rule\]\(\/theleague\/rules(#[a-z0-9-]+)\)$/;
export const FALLBACK_LINK_RE = /^\[Read the full rulebook\]\(\/theleague\/rules\)$/;

/**
 * Format-contract checks every Roger answer must satisfy: rulebook link on
 * the last line, anchor from the whitelist, word budget. `expectedAnchor`
 * additionally pins the anchor (golden-dataset cases only).
 */
export function runFormatChecks(
  answer: string,
  anchors: readonly string[],
  expectedAnchor?: string
): CheckResult[] {
  const checks: CheckResult[] = [];

  const lines = answer.trim().split('\n');
  const lastLine = (lines[lines.length - 1] ?? '').trim();
  const sectionMatch = lastLine.match(SECTION_LINK_RE);
  const isFallback = FALLBACK_LINK_RE.test(lastLine);
  checks.push({
    name: 'format:link-on-last-line',
    pass: Boolean(sectionMatch) || isFallback,
    detail:
      sectionMatch || isFallback ? undefined : `last line was: ${JSON.stringify(lastLine)}`,
  });

  const anchor = sectionMatch?.[1];
  if (anchor) {
    checks.push({
      name: 'format:anchor-in-whitelist',
      pass: anchors.includes(anchor),
      detail: `anchor: ${anchor}`,
    });
  }
  if (expectedAnchor) {
    checks.push({
      name: 'format:expected-anchor',
      pass: anchor === expectedAnchor,
      detail: `expected ${expectedAnchor}, got ${anchor ?? '(none)'}`,
    });
  }

  // `''.split(/\s+/)` yields [''] — length 1 — so count words explicitly or an
  // empty answer looks like a 1-word answer that passes the budget.
  const trimmed = answer.trim();
  const wordCount = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
  checks.push({
    name: 'format:non-empty',
    pass: wordCount > 0,
  });
  checks.push({
    name: 'format:word-budget',
    pass: wordCount <= WORD_LIMIT,
    detail: `${wordCount} words (limit ${WORD_LIMIT})`,
  });

  return checks;
}

/** Case-insensitive multiline regex expectations from a golden-dataset case. */
export function runRegexChecks(
  answer: string,
  mustMatch?: string[],
  mustNotMatch?: string[]
): CheckResult[] {
  const checks: CheckResult[] = [];
  for (const pattern of mustMatch ?? []) {
    checks.push({
      name: `mustMatch:${pattern}`,
      pass: new RegExp(pattern, 'im').test(answer),
    });
  }
  for (const pattern of mustNotMatch ?? []) {
    checks.push({
      name: `mustNotMatch:${pattern}`,
      pass: !new RegExp(pattern, 'im').test(answer),
    });
  }
  return checks;
}

/**
 * Parse a model's JSON verdict, tolerating a wrapping code fence and any
 * prose the model put around it. Null on failure.
 *
 * Anchored to the whole string (no `m` flag) so a fence appearing *inside* a
 * field can't be stripped mid-payload, then falls back to the outermost
 * {...} span so leading prose ("Here's my verdict:") still parses.
 */
export function parseJudgeJson<T>(raw: string): T | null {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(unfenced) as T;
  } catch {
    // Fall through to the brace-span heuristic.
  }

  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
