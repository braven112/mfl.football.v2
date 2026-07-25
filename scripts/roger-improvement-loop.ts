/**
 * Ask Roger improvement loop — the flywheel that turns real owner questions
 * into a steadily better bot.
 *
 *   1. AUDIT (default): pull real Q&As from Redis (`rules-qa:all`), skip
 *      anything already audited (data/roger-improvement/audit-ledger.json),
 *      grade each answer with the deterministic format graders plus a
 *      rubric-driven Claude Opus judge (factual accuracy, grounding, scope
 *      discipline, date handling — graded against the CURRENT constitution).
 *   2. PROPOSE: every failure is drafted into a golden-dataset case in
 *      data/roger-improvement/proposed-cases.json (reviewed: false) and the
 *      judge's prompt-improvement suggestions are aggregated into
 *      data/roger-improvement/latest-report.md.
 *   3. HUMAN GATE: the commissioner verifies/edits each proposal's
 *      reference, flips "reviewed": true. Ground truth is never auto-authored.
 *   4. PROMOTE: `pnpm improve:roger --promote id1,id2` moves reviewed
 *      proposals into tests/fixtures/roger-eval-cases.json — the eval
 *      dataset compounds from real traffic.
 *   5. CLOSE THE LOOP: apply the suggested prompt fix, run `pnpm eval:roger`;
 *      the promoted cases prove the fix, the rest of the suite proves no
 *      regression.
 *
 * Usage:
 *   pnpm improve:roger                    # audit up to 20 new Q&As
 *   pnpm improve:roger --limit 50         # bigger batch
 *   pnpm improve:roger --dry-run          # audit + report, write nothing
 *   pnpm improve:roger --promote a,b      # promote reviewed proposals
 *
 * Requires ANTHROPIC_API_KEY + Upstash credentials (vercel env pull locally;
 * repo secrets in the weekly roger-improvement-loop.yml workflow). Run with
 * tsx — it imports the production TS modules directly.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { getRedis } from '../src/utils/redis-client';
import { LEAGUE_CONSTITUTION } from '../src/data/league-constitution';
import { RULEBOOK_ANCHORS } from '../src/data/rules-qa-system-prompt';
import type { RulesQA } from '../src/types/rules-qa';
import { runFormatChecks, parseJudgeJson, type CheckResult } from './lib/roger-graders';
import {
  selectAuditTargets,
  recordAudit,
  draftProposedCase,
  isDuplicateQuestion,
  promoteCases,
  ptDateOf,
  EVAL_CATEGORIES,
  RUBRIC_DIMENSIONS,
  type AuditLedger,
  type JudgeFinding,
  type ProposedCase,
  type FixtureCase,
} from './lib/roger-improvement';

// ---------------------------------------------------------------------------
// Env + paths

process.env.TZ = 'America/Los_Angeles';
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');
for (const [key, value] of Object.entries(fileEnv)) {
  process.env[key] ??= value;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const DATA_DIR = join(repoRoot, 'data', 'roger-improvement');
const LEDGER_PATH = join(DATA_DIR, 'audit-ledger.json');
const PROPOSALS_PATH = join(DATA_DIR, 'proposed-cases.json');
const REPORT_PATH = join(DATA_DIR, 'latest-report.md');
const FIXTURE_PATH = join(repoRoot, 'tests', 'fixtures', 'roger-eval-cases.json');

const REDIS_KEY = 'rules-qa:all';
const JUDGE_MODEL = 'claude-opus-5';
const DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------------------
// File helpers

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

interface ProposalsFile {
  $comment?: string;
  proposals: ProposedCase[];
}

interface FixtureFile {
  $comment?: string;
  cases: FixtureCase[];
}

// ---------------------------------------------------------------------------
// Rubric judge

const JUDGE_SYSTEM = `You audit answers produced by "Roger", a rules Q&A chatbot for a fantasy football dynasty league. You will be given the league constitution, an owner's question, the answer Roger gave, and the date the answer was generated.

Grade the answer against this rubric — fail a dimension only for a real violation:
- factual-accuracy: every factual claim matches the constitution.
- grounding: nothing invented. If the constitution doesn't cover the topic, the answer must say so rather than improvise. (Roger's required phrasing is along the lines of "I don't see that in the constitution.")
- scope-discipline: strategy questions (trade advice, start/sit, player value, draft targets) must be declined and redirected, not answered. Calculation questions must explain the rule but NOT perform the arithmetic.
- date-handling: any "today"/"upcoming"/deadline-status claim must be consistent with the generation date provided.

Style, humor, and verbosity are NOT graded. The constitution is the only source of truth for facts.

If the answer fails, also draft material for a regression-test case:
- suggestedCategory: one of ${JSON.stringify(EVAL_CATEGORIES)}
- suggestedReference: 2-4 sentences stating what a CORRECT answer must say or do, citing the relevant rule. This is a draft for human review, so be precise.
- promptSuggestion: if the failure suggests a fixable weakness in Roger's system prompt, one concrete sentence describing the prompt change; otherwise null.

Respond with ONLY a JSON object, no code fences:
{"verdict": "pass"|"fail", "failedDimensions": [...], "reasoning": "...", "suggestedCategory": "...", "suggestedReference": "...", "promptSuggestion": "..."|null}
For passing answers use empty/placeholder values for the last three fields.

THE LEAGUE CONSTITUTION (current version — audits grade against today's rules):
${LEAGUE_CONSTITUTION}`;

async function judgeQa(qa: RulesQA): Promise<JudgeFinding> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured — vercel env pull first.');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 4096,
    system: [{ type: 'text', text: JUDGE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `QUESTION FROM OWNER:\n${qa.question}\n\nDATE THE ANSWER WAS GENERATED (Pacific Time): ${ptDateOf(qa.createdAt)}\n\nROGER'S ANSWER TO AUDIT:\n${qa.answer}`,
      },
    ],
  } as Parameters<typeof client.messages.create>[0]);

  const block = 'content' in response ? response.content.find((b) => b.type === 'text') : undefined;
  const raw = block && 'text' in block ? block.text : '';
  const finding = parseJudgeJson<JudgeFinding>(raw);
  if (!finding || (finding.verdict !== 'pass' && finding.verdict !== 'fail')) {
    throw new Error(`Unparseable judge output for ${qa.id}: ${raw.slice(0, 200)}`);
  }
  finding.failedDimensions = (finding.failedDimensions ?? []).filter((d) =>
    (RUBRIC_DIMENSIONS as readonly string[]).includes(d)
  );
  return finding;
}

// ---------------------------------------------------------------------------
// Modes

interface AuditRow {
  qa: RulesQA;
  formatChecks: CheckResult[];
  finding: JudgeFinding;
  pass: boolean;
}

async function runAudit(limit: number, dryRun: boolean): Promise<void> {
  const redis = await getRedis();
  if (!redis) {
    console.error('Redis unavailable — check UPSTASH_REDIS_REST_URL/TOKEN (vercel env pull).');
    process.exitCode = 1;
    return;
  }

  const stored = (await redis.get<RulesQA[]>(REDIS_KEY)) ?? [];
  let ledger = readJson<AuditLedger>(LEDGER_PATH, { audited: {} });
  ledger.audited ??= {};
  const proposalsFile = readJson<ProposalsFile>(PROPOSALS_PATH, { proposals: [] });
  const fixture = readJson<FixtureFile>(FIXTURE_PATH, { cases: [] });

  const targets = selectAuditTargets(stored, ledger, limit);
  console.log(
    `${stored.length} stored Q&As, ${Object.keys(ledger.audited).length} already audited, auditing ${targets.length} (limit ${limit}).`
  );
  if (targets.length === 0) {
    console.log('Nothing new to audit.');
    return;
  }

  const rows: AuditRow[] = [];
  for (const qa of targets) {
    const formatChecks = runFormatChecks(qa.answer, RULEBOOK_ANCHORS);
    const finding = await judgeQa(qa);
    const pass = finding.verdict === 'pass' && formatChecks.every((c) => c.pass);
    rows.push({ qa, formatChecks, finding, pass });

    const failedDims = [
      ...finding.failedDimensions,
      ...formatChecks.filter((c) => !c.pass).map(() => 'format-contract'),
    ];
    ledger = recordAudit(
      ledger,
      qa.id,
      pass ? 'pass' : 'fail',
      [...new Set(failedDims)],
      new Date().toISOString()
    );
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${qa.id}  ${qa.question.slice(0, 70)}`);
  }

  const failures = rows.filter((r) => !r.pass);
  let proposedCount = 0;
  for (const row of failures) {
    if (isDuplicateQuestion(row.qa.question, fixture.cases, proposalsFile.proposals)) continue;
    proposalsFile.proposals.push(draftProposedCase(row.qa, row.finding, new Date().toISOString()));
    proposedCount += 1;
  }

  const report = buildReport(rows, proposalsFile.proposals);
  if (dryRun) {
    console.log('\n--dry-run: nothing written. Report preview:\n');
    console.log(report);
    return;
  }

  proposalsFile.$comment ??=
    'Failed live Q&As drafted as eval cases. A HUMAN verifies/edits each reference, sets "reviewed": true, then runs `pnpm improve:roger --promote <id,...>` to add them to tests/fixtures/roger-eval-cases.json.';
  ledger.$comment ??=
    'Which stored rules-qa answers have been rubric-audited (scripts/roger-improvement-loop.ts). Keyed by Q&A id so nothing is graded twice.';

  writeJson(LEDGER_PATH, ledger);
  writeJson(PROPOSALS_PATH, proposalsFile);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, report);

  console.log(
    `\nAudited ${rows.length}: ${rows.length - failures.length} pass, ${failures.length} fail. ` +
      `${proposedCount} new proposed case(s). Report: data/roger-improvement/latest-report.md`
  );
}

function buildReport(rows: AuditRow[], allProposals: ProposedCase[]): string {
  const failures = rows.filter((r) => !r.pass);
  const suggestions = [
    ...new Set(
      failures
        .map((r) => r.finding.promptSuggestion)
        .filter((s): s is string => Boolean(s && s.trim()))
    ),
  ];
  const pendingReview = allProposals.filter((p) => !p.reviewed);

  const lines: string[] = [
    '# Ask Roger improvement report',
    '',
    `Generated: ${new Date().toISOString()} · Judge: ${JUDGE_MODEL} · Audited this run: ${rows.length}`,
    '',
    `**${rows.length - failures.length} pass / ${failures.length} fail.** ` +
      `${pendingReview.length} proposal(s) awaiting human review in data/roger-improvement/proposed-cases.json.`,
    '',
  ];

  if (failures.length > 0) {
    lines.push('## Failures this run', '');
    for (const r of failures) {
      const dims = [
        ...r.finding.failedDimensions,
        ...r.formatChecks.filter((c) => !c.pass).map((c) => c.name),
      ];
      lines.push(
        `### ${r.qa.id} — ${dims.join(', ')}`,
        '',
        `**Q:** ${r.qa.question}`,
        '',
        `**Judge:** ${r.finding.reasoning}`,
        ''
      );
    }
  }

  if (suggestions.length > 0) {
    lines.push('## Prompt improvement suggestions', '');
    lines.push(
      '_Apply to src/data/rules-qa-system-prompt.ts, then run `pnpm eval:roger` to verify the fix and check for regressions._',
      ''
    );
    for (const s of suggestions) lines.push(`- ${s}`);
    lines.push('');
  }

  lines.push(
    '## Next steps',
    '',
    '1. Review each unreviewed proposal: verify/edit `case.reference` against the constitution, set `"reviewed": true`.',
    '2. `pnpm improve:roger --promote <id,...>` to grow the golden dataset.',
    '3. Apply any prompt suggestions, then `pnpm eval:roger` — promoted cases prove the fix, the rest prove no regression.',
    ''
  );

  return lines.join('\n');
}

function runPromote(ids: string[]): void {
  const proposalsFile = readJson<ProposalsFile>(PROPOSALS_PATH, { proposals: [] });
  const fixture = readJson<FixtureFile>(FIXTURE_PATH, { cases: [] });

  const { promoted, remainingProposals, errors } = promoteCases(
    proposalsFile.proposals,
    ids,
    fixture.cases
  );

  for (const e of errors) console.error(`SKIPPED ${e}`);
  if (promoted.length === 0) {
    console.log('Nothing promoted.');
    if (errors.length > 0) process.exitCode = 1;
    return;
  }

  fixture.cases.push(...promoted);
  proposalsFile.proposals = remainingProposals;
  writeJson(FIXTURE_PATH, fixture);
  writeJson(PROPOSALS_PATH, proposalsFile);

  console.log(`Promoted ${promoted.length} case(s) into tests/fixtures/roger-eval-cases.json:`);
  for (const c of promoted) console.log(`  - ${c.id} (${c.category})`);
  console.log('\nNow run: pnpm vitest run tests/roger-eval-cases.test.ts && pnpm eval:roger');
}

// ---------------------------------------------------------------------------
// CLI

const args = process.argv.slice(2);
const promoteIdx = args.indexOf('--promote');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || DEFAULT_LIMIT : DEFAULT_LIMIT;
const dryRun = args.includes('--dry-run');

if (promoteIdx >= 0) {
  const ids = (args[promoteIdx + 1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    console.error('Usage: pnpm improve:roger --promote <proposalId,proposalId,...>');
    process.exit(1);
  }
  runPromote(ids);
} else {
  runAudit(limit, dryRun).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
