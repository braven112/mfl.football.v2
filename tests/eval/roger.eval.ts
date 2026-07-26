/**
 * Ask Roger live eval — grades the production Q&A pipeline against the golden
 * dataset in tests/fixtures/roger-eval-cases.json.
 *
 * Run with `pnpm eval:roger` (requires ANTHROPIC_API_KEY — `pnpm dlx vercel
 * env pull` locally). Never runs in `pnpm test:unit`: it costs real API money
 * and answers are sampled at temperature 0.3, so results are advisory rather
 * than perfectly reproducible.
 *
 * Two grading layers per case:
 *   1. Deterministic (free): rulebook-link format contract, anchor whitelist,
 *      word budget, mustMatch / mustNotMatch regexes.
 *   2. LLM judge (opt-in per case): Claude Opus grades the answer against the
 *      case's reference ground truth + the full constitution.
 *
 * The answer generation goes through the EXACT production path —
 * generateRulesAnswer with the exported production system prompt and date
 * suffix — so a prompt regression here is a prompt regression in prod.
 *
 * Output: per-case pass/fail via vitest, plus a per-category summary table
 * and a JSON report at tests/eval/report-latest.json (gitignored) for
 * run-over-run comparison.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fixture from '../fixtures/roger-eval-cases.json';
import { generateRulesAnswer } from '../../src/utils/rules-qa-handlers';
import {
  THELEAGUE_RULES_QA_SYSTEM_PROMPT,
  THELEAGUE_RULES_QA_DATE_SUFFIX,
  RULEBOOK_ANCHORS,
} from '../../src/data/rules-qa-system-prompt';
import { LEAGUE_CONSTITUTION } from '../../src/data/league-constitution';
import {
  runFormatChecks,
  runRegexChecks,
  parseJudgeJson,
  type CheckResult,
} from '../../scripts/lib/roger-graders';

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

interface CaseResult {
  id: string;
  category: string;
  question: string;
  answer: string;
  checks: CheckResult[];
  pass: boolean;
}

const cases = fixture.cases as EvalCase[];
const results: CaseResult[] = [];

const JUDGE_MODEL = 'claude-opus-5';

/** 20:00 UTC = noon PST / 1pm PDT — safely mid-day on the intended PT calendar date. */
function ptNoon(isoDate: string): Date {
  return new Date(`${isoDate}T20:00:00Z`);
}

function runDeterministicChecks(c: EvalCase, answer: string): CheckResult[] {
  return [
    ...runFormatChecks(answer, RULEBOOK_ANCHORS, c.expectedAnchor),
    ...runRegexChecks(answer, c.mustMatch, c.mustNotMatch),
  ];
}

const JUDGE_SYSTEM = `You are a strict grader for "Roger", a rules Q&A chatbot for a fantasy football dynasty league. You will be given the league constitution, an owner's question, Roger's answer, and a REFERENCE describing what a correct answer must (and must not) do.

Grade ONLY factual correctness and behavioral compliance against the constitution and the reference — not style, humor, or verbosity. The reference is the ground truth; where it describes required behavior (refusing strategy advice, declining to do math, admitting something isn't in the constitution, resisting prompt injection), non-compliance is a failure even if the answer is otherwise accurate. Minor paraphrasing, extra correct detail, and personality are all fine.

Respond with ONLY a JSON object, no code fences, in this exact shape:
{"pass": true/false, "reason": "<one or two sentences>"}

THE LEAGUE CONSTITUTION:
${LEAGUE_CONSTITUTION}`;

async function judgeAnswer(c: EvalCase, answer: string): Promise<CheckResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { name: 'judge', pass: false, detail: 'ANTHROPIC_API_KEY not set' };

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const dateNote = c.now
    ? `\nFor date-sensitive grading, "today" for Roger was ${c.now} (Pacific Time).`
    : '';

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 4096,
    system: [
      { type: 'text', text: JUDGE_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `QUESTION FROM OWNER:\n${c.question}\n${dateNote}\nREFERENCE (ground truth for a correct answer):\n${c.reference}\n\nROGER'S ANSWER TO GRADE:\n${answer}`,
      },
    ],
  } as Parameters<typeof client.messages.create>[0]);

  const block = 'content' in response ? response.content.find((b) => b.type === 'text') : undefined;
  const raw = block && 'text' in block ? block.text.trim() : '';
  const verdict = parseJudgeJson<{ pass: boolean; reason: string }>(raw);
  if (!verdict) {
    return { name: 'judge', pass: false, detail: `unparseable judge output: ${raw.slice(0, 200)}` };
  }
  return { name: 'judge', pass: verdict.pass === true, detail: verdict.reason };
}

if (!process.env.ANTHROPIC_API_KEY) {
  describe('roger eval', () => {
    it('requires ANTHROPIC_API_KEY', () => {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Run `pnpm dlx vercel env pull` in the repo root ' +
          '(or export the key) before `pnpm eval:roger`. The eval makes real API calls.'
      );
    });
  });
} else {
  describe('roger eval', () => {
    for (const c of cases) {
      it.concurrent(`${c.category} › ${c.id}`, async () => {
        // Record an API/judge failure as a failed case instead of letting the
        // throw skip the push below — otherwise the case vanishes from
        // `results` and the summary divides by a shrunken denominator,
        // printing e.g. 36/36 (100%) when 10 of 46 cases never ran.
        let answer: string;
        try {
          answer = await generateRulesAnswer(c.question, {
            systemPrompt: THELEAGUE_RULES_QA_SYSTEM_PROMPT,
            dateBlockSuffix: THELEAGUE_RULES_QA_DATE_SUFFIX,
            now: c.now ? ptNoon(c.now) : undefined,
          });
        } catch (err) {
          results.push({
            id: c.id,
            category: c.category,
            question: c.question,
            answer: '',
            checks: [{ name: 'answer:generation', pass: false, detail: (err as Error).message }],
            pass: false,
          });
          throw err;
        }

        const checks = runDeterministicChecks(c, answer);
        if (c.judge) checks.push(await judgeAnswer(c, answer));

        // Record before asserting so failed cases still appear in the report.
        const result: CaseResult = {
          id: c.id,
          category: c.category,
          question: c.question,
          answer,
          checks,
          pass: checks.every((k) => k.pass),
        };
        results.push(result);

        const failures = checks.filter((k) => !k.pass);
        expect(
          failures,
          `\nQ: ${c.question}\nA: ${answer}\n\nFailed checks:\n${failures
            .map((f) => `  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
            .join('\n')}`
        ).toEqual([]);
      });
    }

    afterAll(() => {
      if (results.length === 0) return;

      // Seed every category from the fixture so a case that never reported
      // (vitest timeout, worker crash) still counts against its denominator.
      const byCategory = new Map<string, { pass: number; total: number }>();
      for (const c of cases) {
        const row = byCategory.get(c.category) ?? { pass: 0, total: 0 };
        row.total += 1;
        byCategory.set(c.category, row);
      }
      for (const r of results) {
        const row = byCategory.get(r.category);
        if (row && r.pass) row.pass += 1;
      }
      const unreported = cases.length - results.length;

      const summary = [...byCategory.entries()].map(([category, { pass, total }]) => ({
        category,
        passRate: `${pass}/${total}`,
        pct: `${Math.round((pass / total) * 100)}%`,
      }));
      const overall = results.filter((r) => r.pass).length;

      // eslint-disable-next-line no-console
      console.log('\n=== Ask Roger eval summary ===');
      // eslint-disable-next-line no-console
      console.table(summary);
      // eslint-disable-next-line no-console
      console.log(`Overall: ${overall}/${cases.length} (${Math.round((overall / cases.length) * 100)}%)`);
      if (unreported > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `WARNING: ${unreported} case(s) never reported a result and are counted as failures. ` +
            'Pass rates are a floor, not a measurement — investigate before comparing runs.'
        );
      }

      const here = dirname(fileURLToPath(import.meta.url));
      const reportPath = join(here, 'report-latest.json');
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            model: 'claude-haiku-4-5-20251001',
            judgeModel: JUDGE_MODEL,
            overall: { pass: overall, total: cases.length, unreported },
            categories: Object.fromEntries(byCategory),
            results,
          },
          null,
          2
        )
      );
      // eslint-disable-next-line no-console
      console.log(`Report written to ${reportPath}`);
    });
  });
}
