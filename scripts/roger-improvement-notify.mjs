#!/usr/bin/env node
/**
 * Tell a human when the Ask Roger improvement loop finds something.
 *
 * scripts/roger-improvement-loop.ts grades real owner Q&As and writes three
 * files under data/roger-improvement/. Until this script existed it stopped
 * there: the loop correctly caught the August 2026 taxi-squad ruling on
 * 2026-07-27 and the finding sat unreviewed for 17 days, because committing a
 * report to the repo notifies nobody. Detection worked; delivery didn't.
 *
 * Runs AFTER the audit step, and reads STATE rather than the run's result —
 * whatever is unreviewed right now is what a human owes a decision on, so a
 * finding that survived last week is still surfaced this week.
 *
 * Two channels with different audiences:
 *   - A GitHub issue per unreviewed proposal (deduped by title, with a weekly
 *     aging comment) — the durable record, for whoever closes it out. An open
 *     issue is the only artifact here still visibly open on day 17.
 *   - A GroupMe post to the league — the heads-up, for owners. Nothing ever
 *     regenerates a stored answer, so a wrong one keeps getting served to
 *     anyone who scrolls past it; the league's stake is "don't rely on that
 *     answer yet". Narrower than the issue on purpose: only findings NEW this
 *     run (the weekly nag stays on the issue rather than buzzing 12 phones),
 *     and never operational errors like a wedged API key.
 *
 * No-ops silently when nothing is pending. A weekly "all good" ping trains
 * people to ignore the channel.
 *
 * Usage:
 *   node scripts/roger-improvement-notify.mjs              # notify
 *   node scripts/roger-improvement-notify.mjs --dry-run    # print, send nothing
 *
 * Env:
 *   GH_TOKEN               required for issues (set by the workflow)
 *   GROUPME_ROGER_BOT_ID   league-chat bot; unset skips GroupMe silently
 *
 * Every channel is best-effort and independent: a missing bot id still files
 * the issue, a `gh` failure still posts to GroupMe. Only losing BOTH while
 * something needs review fails the step — that case is the original bug.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postToGroupMe } from './lib/groupme.mjs';
import {
  pendingProposals,
  recentJudgeErrors,
  hasSomethingToReport,
  buildIssueTitle,
  buildIssueBody,
  buildBumpComment,
  buildGroupPostText,
  ageInDays,
  describeAge,
} from './lib/roger-notify.mjs';

const TAG = '[roger-notify]';
const ISSUE_LABEL = 'roger-improvement';
const LABEL_COLOR = 'B60205';
const LABEL_DESCRIPTION = 'Ask Roger improvement loop — a finding needs human review';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const DATA_DIR = join(repoRoot, 'data', 'roger-improvement');
const PROPOSALS_PATH = join(DATA_DIR, 'proposed-cases.json');
const LEDGER_PATH = join(DATA_DIR, 'audit-ledger.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

/**
 * Read a JSON state file. A missing file is normal (the loop has never run
 * here) and yields the fallback. A CORRUPT file throws — the same reasoning
 * as readJson in roger-improvement-loop.ts: silently treating an unparseable
 * proposals file as "nothing pending" would turn a merge conflict into
 * permanent silence, which is the failure mode this script exists to remove.
 */
function readJson(path, fallback) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON (${err.message}). Refusing to continue — treating this as ` +
        '"nothing to report" would silence every pending review. Fix the file (check for an ' +
        'unresolved merge conflict) and re-run.'
    );
  }
}

/** Run `gh`, returning stdout. Throws with stderr attached so callers can log a real reason. */
function gh(argv) {
  try {
    return execFileSync('gh', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = err?.stderr?.toString().trim() || err?.message || 'unknown error';
    throw new Error(detail);
  }
}

function runUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const id = process.env.GITHUB_RUN_ID;
  return server && repo && id ? `${server}/${repo}/actions/runs/${id}` : null;
}

/**
 * Create the issue label if it isn't there yet. `gh issue create --label` hard
 * fails on an unknown label, which would drop the whole notification on a
 * fresh repo or after someone tidies labels.
 */
function ensureLabel() {
  try {
    gh(['label', 'create', ISSUE_LABEL, '--color', LABEL_COLOR, '--description', LABEL_DESCRIPTION]);
    console.log(`${TAG} created label "${ISSUE_LABEL}".`);
  } catch (err) {
    // "already exists" is the overwhelmingly common path — not worth logging.
    if (!/already exists/i.test(err.message)) {
      console.warn(`${TAG} could not ensure label "${ISSUE_LABEL}": ${err.message}`);
    }
  }
}

/**
 * Open issues carrying our label, as title -> number.
 *
 * Deduping on the exact title rather than `gh issue list --search` is
 * deliberate: GitHub's search index is eventually consistent, so a search
 * moments after filing can miss the issue it just created and file a second.
 */
function openIssuesByTitle() {
  const raw = gh([
    'issue', 'list',
    '--label', ISSUE_LABEL,
    '--state', 'open',
    '--limit', '100',
    '--json', 'number,title',
  ]);
  const map = new Map();
  for (const issue of JSON.parse(raw || '[]')) map.set(issue.title, issue.number);
  return map;
}

/**
 * File-or-bump one issue per pending proposal.
 *
 * `newlyFiled` is what gates the league-chat post: an issue we had to CREATE
 * is a finding the league hasn't heard about, an issue we merely bumped is one
 * they have. That makes the GitHub issue itself the "already announced"
 * record, so no extra state file is needed to keep the weekly nag off 12
 * phones. When `gh` is unavailable we can't tell new from old, so nothing is
 * marked new and the group post is skipped rather than re-announced.
 */
function syncIssues(pending, now) {
  const outcomes = [];
  const newlyFiled = [];
  if (dryRun) {
    for (const p of pending) {
      outcomes.push(`would file/bump: ${buildIssueTitle(p)}`);
      console.log(`\n--- issue body for ${p.id} ---\n${buildIssueBody(p, { runUrl: runUrl(), now })}\n`);
    }
    // Can't know which are new without querying, so preview the loudest case.
    return { outcomes, newlyFiled: pending };
  }

  ensureLabel();

  let existing;
  try {
    existing = openIssuesByTitle();
  } catch (err) {
    console.warn(`${TAG} could not list issues (${err.message}) — skipping the issue channel.`);
    return { outcomes, newlyFiled };
  }

  for (const proposal of pending) {
    const title = buildIssueTitle(proposal);
    const number = existing.get(title);
    try {
      if (number) {
        gh(['issue', 'comment', String(number), '--body', buildBumpComment(proposal, { runUrl: runUrl(), now })]);
        outcomes.push(`bumped #${number} (${proposal.id}, ${describeAge(ageInDays(proposal.proposedAt, now))})`);
      } else {
        const url = gh([
          'issue', 'create',
          '--title', title,
          '--label', ISSUE_LABEL,
          '--body', buildIssueBody(proposal, { runUrl: runUrl(), now }),
        ]).trim();
        outcomes.push(`filed ${url || title}`);
        newlyFiled.push(proposal);
      }
    } catch (err) {
      // One proposal's issue failing must not drop the rest, or the group post.
      console.warn(`${TAG} issue sync failed for ${proposal.id}: ${err.message}`);
    }
  }
  return { outcomes, newlyFiled };
}

async function main() {
  const now = new Date();
  const proposalsFile = readJson(PROPOSALS_PATH, { proposals: [] });
  const ledger = readJson(LEDGER_PATH, { audited: {} });

  const pending = pendingProposals(proposalsFile.proposals);
  const judgeErrors = recentJudgeErrors(ledger, now);

  if (!hasSomethingToReport(pending, judgeErrors)) {
    console.log(`${TAG} nothing pending review and no judge errors — no notification sent.`);
    return;
  }

  console.log(
    `${TAG} ${pending.length} proposal(s) awaiting review` +
      `${judgeErrors.length > 0 ? `, ${judgeErrors.length} judge error(s) this run` : ''}.`
  );
  if (judgeErrors.length > 0) {
    console.log(`::warning::Ask Roger judge errored on ${judgeErrors.length} answer(s): ${judgeErrors.join(', ')}`);
  }

  const { outcomes, newlyFiled } = syncIssues(pending, now);
  for (const outcome of outcomes) console.log(`${TAG} ${outcome}`);
  const issuesDelivered = outcomes.length > 0;

  // Only NEW findings reach the league chat. A proposal that merely aged
  // another week is already announced; its nag belongs on the issue.
  const text = buildGroupPostText(newlyFiled, { now });
  let posted = false;

  if (!text) {
    console.log(
      `${TAG} nothing newly found this run — league chat not posted (${pending.length} still pending on GitHub).`
    );
  } else {
    // Never claim the issue landed — a `gh` failure above is exactly when this
    // reassurance would be false, and a false "it was still filed" is how a
    // finding goes unreported while the log looks fine.
    const issueFallback = issuesDelivered
      ? 'The GitHub issue was still filed.'
      : 'The GitHub issue did NOT land either.';

    ({ posted } = await postToGroupMe({
      botId: process.env.GROUPME_ROGER_BOT_ID,
      text,
      dryRun,
      checkStatus: true,
      onDryRun: () => console.log(`\n--- league post (not sent, --dry-run) ---\n${text}\n`),
      onMissingBotId: () =>
        console.log(
          `::warning::GroupMe post skipped — GROUPME_ROGER_BOT_ID not set. ${issueFallback}`
        ),
      onPosted: () => console.log(`${TAG} posted ${newlyFiled.length} new finding(s) to the league chat.`),
      onHttpError: (status) => console.warn(`${TAG} GroupMe post failed: HTTP ${status}`),
      onFetchError: (err) => console.warn(`${TAG} GroupMe post failed: ${err.message}`),
    }));
  }

  // Both channels down while something needs review is the ORIGINAL bug —
  // a finding that reaches nobody. Fail the step so it is at least red in
  // the Actions tab instead of silently succeeding.
  if (!dryRun && !issuesDelivered && !posted) {
    console.error(
      '::error::Ask Roger has findings awaiting review and NO notification channel worked ' +
        '(no GitHub issue, no league post). The finding is currently unreported — see ' +
        'data/roger-improvement/proposed-cases.json.'
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`${TAG} fatal:`, err.message ?? err);
  process.exitCode = 1;
});
