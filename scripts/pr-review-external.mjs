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

import { execFileSync } from 'node:child_process';
import { runProvider, PROVIDERS } from './lib/pr-review-providers.mjs';

// Marker on the posted comment. Used to find-and-update rather than append a
// new comment on every push, so a long-lived PR doesn't accumulate a wall of
// stale reviews. Must stay byte-stable — changing it orphans existing comments.
const COMMENT_MARKER = '<!-- external-pr-review -->';

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

function parseArgs(argv) {
  const args = { providers: ['gemini', 'openai'], dryRun: false, pr: null, base: 'origin/main' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
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
 * Render one provider's result as a markdown section.
 *
 * Errors and skips are rendered explicitly rather than omitted. A reviewer
 * that failed must never be indistinguishable from a reviewer that passed —
 * that is the exact failure mode this whole workflow exists to fix.
 */
function renderSection(result) {
  if (result.status === 'skipped') {
    return `### ${result.label}\n\n_Skipped — ${result.reason}._`;
  }
  if (result.status === 'error') {
    return `### ${result.label}\n\n⚠️ **Reviewer failed to run** — ${result.reason}\n\nTreat this as "not reviewed", not as a clean pass.`;
  }
  const truncNote = result.truncated
    ? '\n\n_Note: the diff was truncated — coverage is partial._'
    : '';
  return `### ${result.label}\n\n<sub>\`${result.model}\`</sub>\n\n${result.text}${truncNote}`;
}

function buildComment(results) {
  const body = results.map(renderSection).join('\n\n---\n\n');
  return `${COMMENT_MARKER}
## External review

Independent reviewers running outside the Claude session, so coverage doesn't depend on which machine \`/live\` was launched from.

${body}

<sub>Posted by \`.github/workflows/pr-external-review.yml\`. Severity headings are parsed by \`/live\`.</sub>`;
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

  const existing = JSON.parse(
    sh('gh', ['api', `repos/${repo}/issues/${pr}/comments`, '--paginate'])
  ).find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER));

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

  const diff = collectDiff(args.base);
  if (!diff.trim()) {
    console.log('No reviewable diff (all changes excluded or branch is empty). Nothing to do.');
    return;
  }
  console.log(`Diff: ${diff.length} bytes across providers: ${args.providers.join(', ')}`);

  const context =
    'This repo has strict guard tests. Pay particular attention to: hardcoded league ids ' +
    "(must come from the league registry), absolute URLs built by string concatenation (must use leagueUrl()), " +
    'CSS var() references to tokens that are never defined, and tests that assert on source text rather than behavior.';

  // Providers run concurrently and independently — neither can suppress the other.
  const results = await Promise.all(
    args.providers.map((name) => runProvider(name, { diff, context }))
  );

  for (const r of results) {
    console.log(`  ${r.label}: ${r.status}${r.reason ? ` — ${r.reason}` : ''}`);
  }

  const comment = buildComment(results);

  if (args.dryRun || !args.pr) {
    console.log('\n--- comment body (dry run) ---\n');
    console.log(comment);
    return;
  }

  postComment(args.pr, comment);

  // Exit non-zero only if EVERY provider failed outright — a partial outage
  // shouldn't fail the check and block an otherwise-reviewable PR.
  if (results.every((r) => r.status === 'error')) {
    console.error('\nAll review providers failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
