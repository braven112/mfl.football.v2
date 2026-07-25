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

export const LINK_RE = /\[Read the full rule(?:book)?\]\(\/theleague\/rules(#[a-z0-9-]+)?\)/;

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
  const linkMatch = lastLine.match(LINK_RE);
  checks.push({
    name: 'format:link-on-last-line',
    pass: Boolean(linkMatch),
    detail: linkMatch ? undefined : `last line was: ${JSON.stringify(lastLine)}`,
  });

  const anchor = linkMatch?.[1];
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

  const wordCount = answer.trim().split(/\s+/).length;
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

/** Parse a model's JSON verdict, tolerating stray code fences. Null on failure. */
export function parseJudgeJson<T>(raw: string): T | null {
  try {
    const jsonText = raw
      .trim()
      .replace(/^```(?:json)?/m, '')
      .replace(/```$/m, '')
      .trim();
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}
