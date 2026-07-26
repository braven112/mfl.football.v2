/**
 * Cut Watch live generation eval — regression gate for the July 2026 bug
 * where a shipped article described the deadline auto-cut as value-based
 * ("the system picks the weakest combined-value players first"). Real rule:
 * marked players first, then newest waiver/FA/auction pickup first; trades
 * are long-held; value plays no role (august-cut-selection-core.mjs).
 *
 * Run with `pnpm eval:cutwatch` (requires ANTHROPIC_API_KEY — `pnpm dlx
 * vercel env pull` locally). Never part of `pnpm test:unit`: real API money,
 * nondeterministic output. Deterministic pre-release cousins live in
 * tests/cut-watch-auto-cut-rule.test.ts (detector + prompt + fact sheet).
 *
 * Generation goes through the EXACT production path — buildFactSheet →
 * getSystemPrompt/getUserPrompt → callAnthropic (same model constant the
 * article runner uses) — so a pass here is a pass for the shipped surface.
 *
 * Two grading layers, both must hold (the bug was category confusion, so a
 * one-sided suite is worthless):
 *   Layer 1 — the article never describes the auto-cut as value-based.
 *     Deterministic detector: per-sentence ACTION+VALUE+MECHANISM lexicon
 *     co-occurrence (NOT a cut-verb regex — the shipped bad string has no
 *     cut verb). Plus an Opus judge for phrasings the lexicons miss.
 *   Layer 2 — the value-ranked advisory recommendations still exist and are
 *     clearly editorial. A model that stops recommending entirely "passes"
 *     Layer 1 while breaking the feature — that is a fail here.
 *
 * Variance: CUTWATCH_EVAL_RUNS controls how many fixture generations the
 * Layer-1 detector sweeps (default 3 for iteration; run 20 before shipping
 * prompt/model changes — target is 100% clean, this was a shipped factual
 * error). Pass rate lands in tests/eval/cut-watch-report-latest.json.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain .mjs module without type declarations
import { buildFactSheet, getSystemPrompt, getUserPrompt } from '../../scripts/article-types/cut-watch.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { callAnthropic } from '../../scripts/article-utils/ai-client.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { findValueBasedAutoCutClaimsInPost } from '../../scripts/lib/cut-watch-graders.mjs';
import { parseJudgeJson } from '../../scripts/lib/roger-graders';
import { fixtureData, fixtureAdp } from '../fixtures/cut-watch-fixture';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const JUDGE_MODEL = 'claude-opus-5';
const RUNS = Math.max(1, parseInt(process.env.CUTWATCH_EVAL_RUNS ?? '3', 10) || 3);

interface Article {
  headline: string;
  excerpt: string;
  content: string[];
}

interface CaseResult {
  id: string;
  pass: boolean;
  detail: string;
  article?: Article;
}

const results: CaseResult[] = [];

async function generateFromFixture(): Promise<{ article: Article; factSheet: string }> {
  const { factSheet } = await buildFactSheet(fixtureData(), 0, 2026, repoRoot, {
    league: 'theleague',
    adp: fixtureAdp(),
    // NONE ON FILE — the exact branch the bug shipped under.
    cutdownPlans: new Map([['9901', 0]]),
  });
  const article = await callAnthropic(getSystemPrompt(), getUserPrompt(factSheet));
  return { article, factSheet };
}

/** The real committed feeds — the shipped surface (CUT-03 analog). */
async function generateFromRealData(): Promise<{ article: Article; factSheet: string }> {
  const dir = join(repoRoot, 'data/theleague/mfl-feeds/2026');
  const load = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const data = {
    rosters: load('rosters'),
    players: load('players'),
    league: load('league'),
    transactions: load('transactions'),
  };
  const { factSheet } = await buildFactSheet(data, 0, 2026, repoRoot, {
    league: 'theleague',
    cutdownPlans: null, // no Redis in the eval — plan intel omitted
  });
  const article = await callAnthropic(getSystemPrompt(), getUserPrompt(factSheet));
  return { article, factSheet };
}

const JUDGE_SYSTEM = `You are a strict grader for "Claude Schefter" Cut Watch articles in a dynasty fantasy football league. Teams over the 22-man roster limit are cut down automatically at an August deadline.

GROUND TRUTH — the deadline auto-cut mechanic:
1. Rookies are moved to open practice-squad spots FIRST (3 spots, rookies only). A taxied rookie is KEPT, not cut — an article calling a taxi move a cut or a loss is wrong.
2. Players the owner marked in their cutdown plan are cut next, in the owner's order.
3. Remaining cuts are auto-picked NEWEST PICKUP FIRST: the most recent waiver/free-agent/auction acquisition goes first. Player value, salary, and rankings play NO role in the system's selection.
4. Trades never count as pickups — a player acquired by trade is treated as long-held and is reached only after every waiver/FA/auction pickup is gone.
5. Exactly the overage is resolved (taxi moves + cuts), never more.

The article ALSO intentionally publishes value-ranked cut RECOMMENDATIONS (editorial advice about who an owner SHOULD cut). That advisory framing is correct and required — the failure mode being graded is collapsing the advisory ranking into the mechanical rule (e.g. "the system picks the weakest players first"), or the overcorrection of dropping recommendations entirely.

You will be given the FACT SHEET the article was generated from (its "What the SYSTEM will cut" lists are the mechanical ground truth) and the ARTICLE. Grade:

- "mechanic_correct": true unless the article states or implies the SYSTEM/auto-cut selects by value, weakness, salary, rankings, or "dead weight". Describing the real mechanic (newest pickups first, trades protected as long-held, marked players first) is correct. An article that never explains the mechanic also passes this check. If the article names specific players as what the system will take, the names must come from the fact sheet's "What the SYSTEM will cut" list for that team.
- "advisory_preserved": true only if the article still gives cut recommendations grounded in the value/ADP data, framed as editorial judgment (should/recommend/candidates/columnist voice) rather than as the system's behavior.
- "framings_separate": true only if no sentence fuses the automatic mechanism and a value judgment into one causal claim, and the advisory names are never presented as the system's picks (or vice versa).

Respond with ONLY a JSON object, no code fences:
{"mechanic_correct": true/false, "advisory_preserved": true/false, "framings_separate": true/false, "reason": "<one or two sentences>"}`;

interface JudgeVerdict {
  mechanic_correct: boolean;
  advisory_preserved: boolean;
  framings_separate: boolean;
  reason: string;
}

async function judgeArticle(factSheet: string, article: Article): Promise<JudgeVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 2048,
    system: [{ type: 'text', text: JUDGE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content:
          `FACT SHEET (ground truth):\n${factSheet}\n\n` +
          `ARTICLE TO GRADE:\nHeadline: ${article.headline}\nExcerpt: ${article.excerpt}\n` +
          article.content.join('\n'),
      },
    ],
  } as Parameters<typeof client.messages.create>[0]);

  const block = 'content' in response ? response.content.find((b) => b.type === 'text') : undefined;
  const raw = block && 'text' in block ? block.text.trim() : '';
  const verdict = parseJudgeJson<JudgeVerdict>(raw);
  if (!verdict) throw new Error(`unparseable judge output: ${raw.slice(0, 200)}`);
  return verdict;
}

if (!process.env.ANTHROPIC_API_KEY) {
  describe('cut-watch eval', () => {
    it('requires ANTHROPIC_API_KEY', () => {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Run `pnpm dlx vercel env pull` in the repo root ' +
          '(or export the key) before `pnpm eval:cutwatch`. The eval makes real API calls.'
      );
    });
  });
} else {
  describe('cut-watch eval', () => {
    it.concurrent(
      'fixture › full grade: Layer 1 detector + Opus judge (mechanic, advisory, separation)',
      async () => {
        const { article, factSheet } = await generateFromFixture();
        const violations = findValueBasedAutoCutClaimsInPost(article);
        const verdict = await judgeArticle(factSheet, article);
        const pass =
          violations.length === 0 &&
          verdict.mechanic_correct &&
          verdict.advisory_preserved &&
          verdict.framings_separate;
        results.push({
          id: 'fixture-full',
          pass,
          detail: `detector=${violations.length} judge=${JSON.stringify(verdict)}`,
          article,
        });
        expect(violations, JSON.stringify(violations, null, 2)).toHaveLength(0);
        expect(verdict.mechanic_correct, verdict.reason).toBe(true);
        expect(verdict.advisory_preserved, verdict.reason).toBe(true);
        expect(verdict.framings_separate, verdict.reason).toBe(true);
      }
    );

    it.concurrent(
      `fixture › Layer 1 variance sweep (${RUNS} runs at production temperature)`,
      async () => {
        const outcomes: { clean: boolean; detail: string }[] = [];
        for (let i = 0; i < RUNS; i++) {
          const { article } = await generateFromFixture();
          const violations = findValueBasedAutoCutClaimsInPost(article);
          outcomes.push({
            clean: violations.length === 0,
            detail: violations.map((v: { sentence: string }) => v.sentence).join(' | '),
          });
        }
        const cleanCount = outcomes.filter((o) => o.clean).length;
        results.push({
          id: 'fixture-variance',
          pass: cleanCount === RUNS,
          detail: `${cleanCount}/${RUNS} clean${
            cleanCount < RUNS ? ` — ${outcomes.filter((o) => !o.clean).map((o) => o.detail).join(' || ')}` : ''
          }`,
        });
        // This exact bug shipped. Target is 100% clean — one value-based
        // mechanic claim in N runs is a regression, not noise.
        expect(cleanCount, outcomes.map((o) => o.detail).join('\n')).toBe(RUNS);
      },
      RUNS * 90_000
    );

    it.concurrent(
      'real data › shipped surface stays clean (Layer 1 + judge on committed feeds)',
      async () => {
        const { article, factSheet } = await generateFromRealData();
        const violations = findValueBasedAutoCutClaimsInPost(article);
        const verdict = await judgeArticle(factSheet, article);
        results.push({
          id: 'real-data',
          pass: violations.length === 0 && verdict.mechanic_correct && verdict.framings_separate,
          detail: `detector=${violations.length} judge=${JSON.stringify(verdict)}`,
          article,
        });
        expect(violations, JSON.stringify(violations, null, 2)).toHaveLength(0);
        expect(verdict.mechanic_correct, verdict.reason).toBe(true);
        expect(verdict.framings_separate, verdict.reason).toBe(true);
      }
    );
  });

  afterAll(() => {
    const report = {
      generatedAt: new Date().toISOString(),
      runs: RUNS,
      results: results.map(({ article, ...rest }) => ({
        ...rest,
        headline: article?.headline,
      })),
    };
    const out = join(here, 'cut-watch-report-latest.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log(`\ncut-watch eval report → ${out}`);
    for (const r of report.results) {
      // eslint-disable-next-line no-console
      console.log(`  ${r.pass ? '✅' : '❌'} ${r.id}: ${r.detail}`);
    }
  });
}
