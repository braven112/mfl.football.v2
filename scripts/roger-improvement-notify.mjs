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
 * Two channels, on purpose:
 *   - A GitHub issue per unreviewed proposal (deduped by title, with a weekly
 *     aging comment) — the durable record. An open issue is the only artifact
 *     here that is still visibly open on day 17.
 *   - One GroupMe DM to the commissioner — the alarm. Never the league chat:
 *     the audit has a real false-positive rate (in the very report this was
 *     built from, one of two "failures" was an answer the judge itself called
 *     correct that tripped a link-formatting check), and owners who can't act
 *     on it shouldn't absorb that.
 *
 * No-ops silently when nothing is pending. A weekly "all good" ping trains
 * people to ignore the channel.
 *
 * Usage:
 *   node scripts/roger-improvement-notify.mjs              # notify
 *   node scripts/roger-improvement-notify.mjs --dry-run    # print, send nothing
 *   node scripts/roger-improvement-notify.mjs --list-members
 *
 * Env:
 *   GH_TOKEN                       required for issues (set by the workflow)
 *   GROUPME_SERVICE_TOKEN          user token that can DM (bots cannot)
 *   GROUPME_COMMISSIONER_USER_ID   DM recipient; --list-members finds it
 *   GROUPME_GROUP_ID               only used by --list-members
 *
 * Every channel is best-effort and independent: a missing GroupMe token still
 * files the issue, a `gh` failure still sends the DM, and neither failure
 * fails the workflow. The audit's own committed output remains the backstop.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendGroupMeDirectMessage } from './lib/groupme.mjs';
import {
  pendingProposals,
  recentJudgeErrors,
  hasSomethingToReport,
  buildIssueTitle,
  buildIssueBody,
  buildBumpComment,
  buildDmText,
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
const listMembers = args.includes('--list-members');

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

function issuesUrl() {
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  return `${server}/${repo}/issues?q=${encodeURIComponent(`is:open label:${ISSUE_LABEL}`)}`;
}

/**
 * Print the GroupMe group roster so the commissioner's user id can be copied
 * into GROUPME_COMMISSIONER_USER_ID. Resolving that id automatically (reverse
 * lookup through the groupme:user:* Redis map) was the alternative, and it was
 * rejected on purpose: it depends on the account having been linked through
 * the site's flow, and unverifiable alerting plumbing is exactly the failure
 * this task exists to remove. One explicit id, set once.
 */
async function printGroupMembers() {
  const token = process.env.GROUPME_SERVICE_TOKEN || process.env.GROUPME_ACCESS_TOKEN;
  const groupId = process.env.GROUPME_GROUP_ID;
  if (!token || !groupId) {
    console.error(`${TAG} --list-members needs GROUPME_SERVICE_TOKEN and GROUPME_GROUP_ID.`);
    process.exitCode = 1;
    return;
  }
  const res = await fetch(
    `https://api.groupme.com/v3/groups/${encodeURIComponent(groupId)}?token=${encodeURIComponent(token)}`
  );
  if (!res.ok) {
    console.error(`${TAG} GroupMe group fetch failed: HTTP ${res.status}`);
    process.exitCode = 1;
    return;
  }
  const data = await res.json();
  const members = data?.response?.members ?? [];
  console.log(`${TAG} ${members.length} member(s) — set GROUPME_COMMISSIONER_USER_ID to a user_id:\n`);
  for (const m of members) console.log(`  ${m.user_id}\t${m.nickname ?? m.name ?? '(no name)'}`);
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

/** File-or-bump one issue per pending proposal. Returns a short outcome log. */
function syncIssues(pending, now) {
  const outcomes = [];
  if (dryRun) {
    for (const p of pending) {
      outcomes.push(`would file/bump: ${buildIssueTitle(p)}`);
      console.log(`\n--- issue body for ${p.id} ---\n${buildIssueBody(p, { runUrl: runUrl(), now })}\n`);
    }
    return outcomes;
  }

  ensureLabel();

  let existing;
  try {
    existing = openIssuesByTitle();
  } catch (err) {
    console.warn(`${TAG} could not list issues (${err.message}) — skipping the issue channel.`);
    return outcomes;
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
      }
    } catch (err) {
      // One proposal's issue failing must not drop the rest, or the DM.
      console.warn(`${TAG} issue sync failed for ${proposal.id}: ${err.message}`);
    }
  }
  return outcomes;
}

async function main() {
  if (listMembers) return printGroupMembers();

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

  const issueOutcomes = syncIssues(pending, now);
  for (const outcome of issueOutcomes) console.log(`${TAG} ${outcome}`);
  const issuesDelivered = issueOutcomes.length > 0;

  const text = buildDmText(pending, { issuesUrl: issuesUrl(), judgeErrors, now });
  // Stable per-day guid: a workflow re-run on the same day collapses into the
  // original DM instead of pinging twice.
  const sourceGuid = `roger-notify-${now.toISOString().slice(0, 10)}-${pending.length}-${judgeErrors.length}`;

  // Never claim the issue landed — a `gh` failure above is exactly when this
  // reassurance would be false, and a false "it was still filed" is how a
  // finding goes unreported while the log looks fine.
  const issueFallback = issuesDelivered
    ? 'The GitHub issue was still filed.'
    : 'The GitHub issue did NOT land either.';

  const { sent } = await sendGroupMeDirectMessage({
    token: process.env.GROUPME_SERVICE_TOKEN || process.env.GROUPME_ACCESS_TOKEN,
    recipientId: process.env.GROUPME_COMMISSIONER_USER_ID,
    text,
    sourceGuid,
    dryRun,
    onDryRun: () => console.log(`\n--- DM (not sent, --dry-run) ---\n${text}\n`),
    onMissingConfig: (missing) =>
      console.log(
        `::warning::GroupMe DM skipped — ${missing.join(' and ')} not set. ${issueFallback} ` +
          'To enable the DM: add GROUPME_SERVICE_TOKEN (already a repo secret) and ' +
          'GROUPME_COMMISSIONER_USER_ID, which you can find with ' +
          '`node scripts/roger-improvement-notify.mjs --list-members`.'
      ),
    onSent: () => console.log(`${TAG} commissioner DM sent.`),
    onHttpError: (status, body) =>
      console.warn(`${TAG} GroupMe DM failed: HTTP ${status} ${body.slice(0, 200)}`),
    onFetchError: (err) => console.warn(`${TAG} GroupMe DM failed: ${err.message}`),
  });

  // Both channels down while something needs review is the ORIGINAL bug —
  // a finding that reaches nobody. Fail the step so it is at least red in
  // the Actions tab instead of silently succeeding.
  if (!dryRun && !issuesDelivered && !sent) {
    console.error(
      '::error::Ask Roger has findings awaiting review and NO notification channel worked ' +
        '(no GitHub issue, no DM). The finding is currently unreported — see ' +
        'data/roger-improvement/proposed-cases.json.'
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`${TAG} fatal:`, err.message ?? err);
  process.exitCode = 1;
});
