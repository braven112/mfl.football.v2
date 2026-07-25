/**
 * Deterministic guard for the Ask Roger eval fixture. Runs in the normal unit
 * suite (no API key, no network) so a malformed case or a prompt/anchor drift
 * fails CI long before anyone burns tokens on a live eval run.
 *
 * The live eval itself is tests/eval/roger.eval.ts, run via `pnpm eval:roger`.
 */

import { describe, it, expect } from 'vitest';
import fixture from './fixtures/roger-eval-cases.json';
import {
  THELEAGUE_RULES_QA_SYSTEM_PROMPT,
  RULEBOOK_ANCHORS,
} from '../src/data/rules-qa-system-prompt';

const CATEGORIES = [
  'fact-lookup',
  'multi-rule',
  'date-sensitive',
  'strategy-refusal',
  'calc-redirect',
  'not-in-constitution',
  'injection',
] as const;

interface EvalCase {
  id: string;
  category: string;
  question: string;
  mustMatch?: string[];
  mustNotMatch?: string[];
  expectedAnchor?: string;
  judge?: boolean;
  reference?: string;
  now?: string;
}

const cases = fixture.cases as EvalCase[];

describe('roger eval fixture', () => {
  it('has a healthy number of cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
  });

  it('has unique ids', () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every category with at least 3 cases', () => {
    for (const category of CATEGORIES) {
      const count = cases.filter((c) => c.category === category).length;
      expect(count, `category ${category}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(cases.map((c) => [c.id, c] as const))('case %s is well-formed', (_id, c) => {
    expect(CATEGORIES).toContain(c.category);
    // Mirrors the production POST handler's question constraints.
    expect(c.question.trim().length).toBeGreaterThanOrEqual(10);
    expect(c.question.length).toBeLessThanOrEqual(500);
    expect(typeof c.judge).toBe('boolean');

    // Every regex must compile — a bad pattern should fail here, not mid-eval.
    for (const pattern of [...(c.mustMatch ?? []), ...(c.mustNotMatch ?? [])]) {
      expect(() => new RegExp(pattern, 'im')).not.toThrow();
    }

    if (c.expectedAnchor) {
      expect(RULEBOOK_ANCHORS).toContain(c.expectedAnchor);
    }

    if (c.judge) {
      expect(c.reference, `judged case ${c.id} needs a reference answer`).toBeTruthy();
    }

    if (c.now) {
      expect(c.now).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(`${c.now}T12:00:00-08:00`).getTime())).toBe(false);
    }
    if (c.category === 'date-sensitive') {
      expect(c.now, `date-sensitive case ${c.id} needs an injected date`).toBeTruthy();
    }
  });

  it('every deterministic-only case has at least one grader beyond format checks', () => {
    for (const c of cases) {
      if (!c.judge) {
        const graders = (c.mustMatch?.length ?? 0) + (c.mustNotMatch?.length ?? 0);
        expect(graders, `case ${c.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('anchor whitelist stays in sync with the system prompt', () => {
  it('every whitelisted anchor appears in the prompt', () => {
    for (const anchor of RULEBOOK_ANCHORS) {
      expect(THELEAGUE_RULES_QA_SYSTEM_PROMPT).toContain(`${anchor} —`);
    }
  });

  it('every anchor the prompt offers is whitelisted', () => {
    const promptAnchors = [
      ...THELEAGUE_RULES_QA_SYSTEM_PROMPT.matchAll(/^ {2}(#[a-z0-9-]+) —/gm),
    ].map((m) => m[1]);
    expect(promptAnchors.length).toBeGreaterThan(0);
    for (const anchor of promptAnchors) {
      expect(RULEBOOK_ANCHORS).toContain(anchor);
    }
  });
});
