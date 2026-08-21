#!/usr/bin/env node
// Run the external (non-Claude) PR reviewers and post their findings to the PR.
//
// WHY THIS IS A WORKFLOW AND NOT AN AGENT CALL: `/live` used to spawn the
// Codex reviewer as an in-session subagent. That depends on the `codex` CLI
// existing and being authenticated in whatever sandbox the agent happens to
// run in — true on a laptop, frequently false in the Claude cloud workflow,
// where it silently no-ops and review coverage quietly drops to Claude alone.
// Running in Actions makes the reviewers a property of the PR rather than of
// the machine that launched `/live`, so coverage is identical either way.
//
// `/live` then just reads the findings off the PR, exactly as it already does
// for GitHub Copilot.
//
// Usage:
//   node scripts/pr-review-external.mjs --pr <number> [--providers gemini,openai] [--dry-run]
//   node scripts/pr-review-external.mjs --providers openai --section-only
//
// The second form is the in-session fallback `/live` uses when the local
// `codex` CLI is missing (the Claude cloud sandbox). It prints the reviewer's
// findings to stdout for in-session adjudication and posts nothing — see
// `renderSections()` for why an in-session run must not touch the PR comment.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  runProvider,
  PROVIDERS,
  COMMENT_MARKER,
  STATUS_PREFIX,
  buildComment,
  renderSections,
  overallStatus,
} from './lib/pr-review-providers.mjs';

// Paths whose diffs are noise for a reviewer: generated feeds, lockfiles and
// committed data snapshots written by cron. Dropping them keeps the real
// change from being buried (and keeps token spend off machine-written JSON).
const EXCLUDED_PATHS = [
  ':(exclude)pnpm-lock.yaml',
  ':(exclude)data/**',
  ':(exclude)src/data/**/mfl-feeds/**',
  ':(exclude)src/data/**/*-feed.json',
  ':(exclude)src/data/salary-history/**',
  ':(exclude)public/assets/**',
];

/**
 * Repo conventions handed to context-using lenses only.
 *
 * Sourced from GEMINI.md's "Landmines" section rather than restated here, so
 * there is one place to maintain it and the reviewers can't drift from what
 * the repo actually tells its assistants.
 *
 * Deliberately NOT the whole of CLAUDE.md. Two reasons. The mechanical rules
 * below make a reviewer catch MORE (a leagueUrl() violation flagged is a
 * violation that's real). The rationale-for-oddities sections would make it
 * catch LESS — a reviewer told "preserveFeedOrder is deliberate" will never
 * ask whether it should be. Suppressing findings is the expensive direction
 * to be wrong in, so it stays out.
 */
function loadRepoContext() {
  const geminiMd = new URL('../GEMINI.md', import.meta.url);
  let text;
  try {
    text = readFileSync(geminiMd, 'utf8');
  } catch {
    console.warn('GEMINI.md not readable — reviewers run without repo context.');
    return '';
  }

  // Slice the Landmines section: from its heading to the next h2.
  const start = text.indexOf('## Landmines');
  if (start === -1) {
    console.warn('GEMINI.md has no "## Landmines" section — reviewers run without repo context.');
    return '';
  }
  const rest = text.slice(start);
  const nextHeading = rest.indexOf('\n## ', 1);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return `Repo conventions you should assume are intentional and enforced by CI guard tests. A change that violates one of these is a real finding:\n\n${section.trim()}`;
}

// Gemini only by default. OpenAI has NO free tier — it is pay-as-you-go only,
// and a ChatGPT subscription grants no API credit — so including it by default
// guarantees a permanently-failing reviewer. It stays in the registry so
// `--providers gemini,openai` works if a funded key ever exists.
function parseArgs(argv) {
  const args = {
    providers: ['gemini'],
    dryRun: false,
    sectionOnly: false,
    pr: null,
    base: 'origin/main',
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--section-only') args.sectionOnly = true;
    else if (arg === '--pr') args.pr = argv[++i];
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--providers') args.providers = argv[++i].split(',').map((s) => s.trim());
  }
  return args;
}

function sh(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Three-dot diff: the branch's own changes, excluding whatever main did meanwhile. */
function collectDiff(base) {
  return sh('git', ['diff', `${base}...HEAD`, '--', '.', ...EXCLUDED_PATHS]);
}

/**
 * Upsert the sticky comment: update ours if present, otherwise create it.
 *
 * The body goes over stdin as JSON rather than as an `-f body=...` argv entry.
 * Review bodies are multi-KB of arbitrary markdown (backticks, quotes, newlines,
 * and diff snippets the model quoted back), which is exactly the shape that
 * breaks argv escaping and bumps into ARG_MAX.
 */
function postComment(pr, body) {
  const repo = sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();

  // --slurp is required with --paginate: without it gh concatenates one JSON
  // array PER PAGE, which JSON.parse rejects as soon as a PR passes 100
  // comments. The failure mode is nasty — the review would stop posting
  // entirely on exactly the long-running PRs that most need it. With --slurp
  // the result is an array of pages, hence the flat().
  const existing = JSON.parse(
    sh('gh', ['api', `repos/${repo}/issues/${pr}/comments`, '--paginate', '--slurp'])
  )
    .flat()
    .find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER));

  const [method, path, label] = existing
    ? ['PATCH', `repos/${repo}/issues/comments/${existing.id}`, `Updated existing review comment (${existing.id}).`]
    : ['POST', `repos/${repo}/issues/${pr}/comments`, 'Posted new review comment.'];

  execFileSync('gh', ['api', '--method', method, path, '--input', '-'], {
    input: JSON.stringify({ body }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  console.log(label);
}

async function main() {
  const args = parseArgs(process.argv);

  // Both of these arrive from workflow_dispatch inputs, i.e. free-form strings.
  // The PR number is interpolated into a `gh api` path and the provider names
  // index the registry, so validate rather than trust.
  const unknown = args.providers.filter((p) => !PROVIDERS[p]);
  if (unknown.length) {
    console.error(`Unknown provider(s): ${unknown.join(', ')}`);
    process.exit(1);
  }

  if (args.pr !== null && !/^\d+$/.test(args.pr)) {
    console.error(`Invalid --pr value: ${JSON.stringify(args.pr)} (expected digits only)`);
    process.exit(1);
  }

  // Nothing configured — exit clean and SILENT. This repo runs its external
  // reviewers on free-tier quota only, so "no key present" is the expected
  // steady state, not an error. Failing red or posting an "everything was
  // skipped" comment on every PR would train the user to ignore both signals,
  // which is worse than having no external reviewer at all.
  const configured = args.providers.filter((p) => process.env[PROVIDERS[p].envKey]);
  if (configured.length === 0) {
    console.log(
      `No API keys configured (${args.providers
        .map((p) => PROVIDERS[p].envKey)
        .join(', ')}). External review skipped — Claude and Copilot still review this PR.`
    );
    console.log(`${STATUS_PREFIX} skipped`);
    return;
  }

  const diff = collectDiff(args.base);
  if (!diff.trim()) {
    console.log('No reviewable diff (all changes excluded or branch is empty). Nothing to do.');
    console.log(`${STATUS_PREFIX} skipped`);
    return;
  }
  console.log(`Diff: ${diff.length} bytes across providers: ${args.providers.join(', ')}`);

  const context = loadRepoContext();

  // Providers run concurrently and independently — neither can suppress the other.
  const results = await Promise.all(
    args.providers.map((name) => runProvider(name, { diff, context }))
  );

  for (const r of results) {
    console.log(`  ${r.label}: ${r.status}${r.reason ? ` — ${r.reason}` : ''}`);
  }

  const status = overallStatus(results);

  // Print findings and stop. Checked BEFORE --pr on purpose: --section-only is
  // a promise not to write to the PR, and a caller that passes both should get
  // the promise, not the post.
  if (args.sectionOnly) {
    console.log(`\n${renderSections(results)}`);
    console.log(`\n${STATUS_PREFIX} ${status}`);
    return;
  }

  const comment = buildComment(results);

  if (args.dryRun || !args.pr) {
    console.log('\n--- comment body (dry run) ---\n');
    console.log(comment);
    console.log(`\n${STATUS_PREFIX} ${status}`);
    return;
  }

  postComment(args.pr, comment);
  console.log(`${STATUS_PREFIX} ${status}`);

  // Never exit non-zero on a provider failure. These reviewers are ADVISORY and
  // run on free-tier quota, so a 429 is an ordinary Tuesday — failing the check
  // would let an exhausted daily quota block shipping. The failure is already
  // visible where it matters: an annotation here, and a "Reviewer failed to
  // run" section in the PR comment that `/live` is required to surface rather
  // than count as a clean pass.
  const failed = results.filter((r) => r.status === 'error');
  if (failed.length) {
    console.log(`\n::warning::External review degraded — ${failed.map((r) => r.label).join(', ')} did not run.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
