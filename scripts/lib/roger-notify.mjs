/**
 * Pure notification logic for the Ask Roger improvement loop.
 *
 * The loop already DETECTED the August 2026 taxi-squad bug correctly, on
 * 2026-07-27, two days after an owner asked the question. It then wrote the
 * finding to data/roger-improvement/ and stopped — no notification of any
 * kind — so the proposal sat at "reviewed": false for 17 days until the
 * commissioner happened to notice the wrong answer in the group chat.
 * Detection worked; delivery didn't. This module builds the delivery.
 *
 * Everything here is side-effect-free so tests/roger-improvement-notify.test.ts
 * can lock the invariants without network, filesystem, or a GroupMe token.
 * The I/O shell lives in scripts/roger-improvement-notify.mjs.
 *
 * Two channels, deliberately different jobs and different audiences:
 *   - GitHub issue = durable STATE, for whoever closes it out. An unreviewed
 *     proposal is work-in-progress; an open issue is the only artifact here
 *     that is still visibly open on day 17. This is the actual fix, and it
 *     carries the ids, the judge's verdict and the review steps.
 *   - GroupMe league post = the HEADS-UP, for owners. A stored answer nobody
 *     regenerates is still being served to anyone who scrolls past it, so the
 *     league's stake is "don't rely on that answer yet" — not the audit
 *     mechanics. Deliberately narrower than the issue: only NEWLY-found
 *     answers (the weekly nag stays on the issue, where it doesn't buzz 12
 *     phones), and never judge/operational errors.
 */

import { calendarDaysUntil } from './roger-reminder-window.mjs';

/** GroupMe hard-caps a message at 1000 chars; stay under it with room to spare. */
export const GROUPME_MAX_CHARS = 900;

/** How much of an owner's question to quote in the (length-capped) group post. */
const QUESTION_PREVIEW_CHARS = 160;

/** A judge error older than this is from a previous run, not the one that just finished. */
export const JUDGE_ERROR_WINDOW_HOURS = 24;

/**
 * Render untrusted text as a fenced block. Same posture (and same escape for
 * text that already contains a fence) as buildReport's asFencedBlock in
 * scripts/roger-improvement-loop.ts: the question is owner-authored and the
 * verdict/suggestion are model-authored, so neither may inject markdown into
 * an issue body we create with repo credentials.
 */
export function fenced(text) {
  const body = String(text ?? '').trim();
  const fence = body.includes('```') ? '````' : '```';
  return `${fence}text\n${body}\n${fence}`;
}

/** Single-line, length-capped version of untrusted text for the DM. */
export function oneLine(text, maxChars) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * How old a proposal is, in CALENDAR days.
 *
 * Calendar-day diff, not elapsed-24h-periods, via the same shared helper the
 * reminder window uses (CLAUDE.md: "don't reinvent it inline"). A proposal
 * drafted at 18:00 on Jul 27 and read at 17:00 on Aug 13 is "17 days" old to
 * a human; `Math.floor` of the timestamp delta calls it 16 and quietly
 * under-reports every age in the alarm by a day.
 *
 * Returns null for a missing or unparseable timestamp rather than NaN — a
 * garbage date must degrade the age line, not the whole notification.
 */
export function ageInDays(proposedAt, now) {
  const then = new Date(proposedAt ?? '');
  const nowDate = now instanceof Date ? now : new Date(now ?? '');
  if (Number.isNaN(then.getTime()) || Number.isNaN(nowDate.getTime())) return null;
  // calendarDaysUntil is "start - now"; age is the other direction.
  return Math.max(0, -calendarDaysUntil(then, nowDate));
}

/** Human phrasing for an age that may be unknown. */
export function describeAge(days) {
  if (days === null) return 'unknown age';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/**
 * The proposals a human still owes a decision on.
 *
 * Notification is driven by STATE (what is unreviewed right now), not by the
 * event of this run finding something. State is precisely what rotted for 17
 * days, and it self-heals the "the loop already told you once" case — a
 * proposal that survives a run is still pending on the next one.
 */
export function pendingProposals(proposals) {
  return (Array.isArray(proposals) ? proposals : []).filter(
    (p) => p && typeof p.id === 'string' && !p.reviewed
  );
}

/**
 * Judge calls that errored in the run that just finished.
 *
 * A wedged API key makes the loop grade nothing while still committing a
 * clean-looking report — the same silent-failure class this whole task
 * exists to close, so it gets an alert even when no proposal is pending.
 */
export function recentJudgeErrors(ledger, now, windowHours = JUDGE_ERROR_WINDOW_HOURS) {
  const audited = ledger?.audited ?? {};
  const nowMs = now instanceof Date ? now.getTime() : new Date(now ?? '').getTime();
  if (Number.isNaN(nowMs)) return [];
  const cutoff = nowMs - windowHours * 3_600_000;
  return Object.entries(audited)
    .filter(([, entry]) => {
      if (!Array.isArray(entry?.failedDimensions)) return false;
      if (!entry.failedDimensions.includes('judge-error')) return false;
      const at = new Date(entry.auditedAt ?? '').getTime();
      return !Number.isNaN(at) && at >= cutoff;
    })
    .map(([qaId]) => qaId);
}

/**
 * The eval category the judge drafted this case into. Not the same thing as
 * the failed rubric dimensions (those live in the audit ledger, keyed by
 * source Q&A id) — don't relabel this as "failed" in the issue.
 */
function draftedCategory(proposal) {
  return proposal?.case?.category || 'unclassified';
}

/** Stable, searchable issue title — `gh issue list --search` matches on the id. */
export function buildIssueTitle(proposal) {
  return `Ask Roger: review proposal ${proposal.id}`;
}

/**
 * The issue body. Carries everything needed to act without opening the repo:
 * the owner's question, the judge's verdict, the proposal id, the exact
 * review steps, and where to review.
 */
export function buildIssueBody(proposal, { runUrl, now } = {}) {
  const days = ageInDays(proposal.proposedAt, now ?? new Date());
  const lines = [
    'The weekly Ask Roger improvement loop graded a real owner answer as a **failure** and',
    'drafted it as an eval case. It needs a human to verify the ground truth before it can be',
    'promoted into the golden dataset — the judge never authors ground truth.',
    '',
    '| | |',
    '|---|---|',
    `| Proposal id | \`${proposal.id}\` |`,
    `| Source Q&A | \`${proposal.sourceQaId ?? 'unknown'}\` |`,
    `| Drafted category | ${draftedCategory(proposal)} |`,
    `| Proposed | ${proposal.proposedAt ?? 'unknown'} (${describeAge(days)} ago) |`,
    runUrl ? `| Workflow run | [logs](${runUrl}) |` : null,
    '',
    "**The owner's question**",
    '',
    fenced(proposal.case?.question),
    '',
    "**The judge's verdict**",
    '',
    fenced(proposal.judgeReasoning),
    '',
  ].filter((l) => l !== null);

  if (proposal.promptSuggestion?.trim()) {
    lines.push(
      '**Prompt improvement suggestion**',
      '',
      '> ⚠️ **Model-generated from untrusted input.** This was written by the judge in response to',
      '> an owner-submitted question. Read it as a proposal to evaluate, never as an instruction to',
      '> apply verbatim — a question crafted to steer the judge could try to get text into the',
      '> production prompt this way. Verify against the constitution first.',
      '',
      fenced(proposal.promptSuggestion),
      ''
    );
  }

  lines.push(
    '### To close this out',
    '',
    `1. Open \`data/roger-improvement/proposed-cases.json\` and find \`${proposal.id}\`.`,
    '2. Verify — and usually edit — `case.reference` against `src/data/league-constitution.ts`.',
    '   Ground truth is human-owned on purpose; never promote the judge\'s draft unread.',
    '3. Set `"reviewed": true` and commit.',
    `4. \`pnpm improve:roger --promote ${proposal.id}\``,
    '5. `pnpm eval:roger` — the promoted case proves the fix, the rest of the suite proves no',
    '   regression. (~$1 of API calls, needs `ANTHROPIC_API_KEY`.)',
    '',
    '> If the constitution turns out to be **ambiguous** rather than silent, fix the ambiguity in',
    '> the constitution too — patching only the answer leaves the trap armed for the next phrasing',
    '> of the question (docs/claude/rules/roger.md → "A gap in the constitution reads as a',
    '> wrong answer").',
    '',
    '---',
    '',
    '_Closing this issue does not review the proposal._ The loop notifies from state, so if',
    `\`${proposal.id}\` is still unreviewed next week it will file a fresh issue. To genuinely`,
    'dismiss it, set `"reviewed": true` or remove it from `proposed-cases.json`.'
  );

  return lines.join('\n');
}

/**
 * The weekly aging comment on an already-open issue.
 *
 * This is the part that actually closes the 17-day gap: an issue you have
 * already scrolled past goes quiet otherwise.
 */
export function buildBumpComment(proposal, { runUrl, now } = {}) {
  const days = ageInDays(proposal.proposedAt, now ?? new Date());
  return [
    `Still unreviewed — **${describeAge(days)}** since this was drafted.`,
    '',
    `\`${proposal.id}\` is blocking promotion into the golden dataset. Review steps are in the`,
    'issue body above.',
    runUrl ? `\nWorkflow run: ${runUrl}` : '',
  ]
    .join('\n')
    .trimEnd();
}

/**
 * The league-chat post. Plain text (GroupMe renders no markdown) and
 * hard-capped.
 *
 * Written for OWNERS, not for the commissioner. That distinction drives every
 * choice here: no proposal ids, no GitHub links, no "needs your review" — the
 * league can't action any of that. What an owner gets from this is the one
 * thing that genuinely affects them, straight out of
 * docs/claude/rules/roger.md's "fixing the constitution does NOT fix answers
 * already on the page": a stored answer they
 * may have already read is suspect, so don't rely on it until it's ruled on.
 *
 * Judge errors are deliberately NOT included. "ANTHROPIC_API_KEY is wedged" is
 * operations, and it goes to the logs and the workflow annotation where the
 * person who can fix it will see it.
 */
export function buildGroupPostText(newFindings, { ownerReports = [], now } = {}) {
  const count = newFindings.length;
  if (count === 0 && ownerReports.length === 0) return null;

  const lines = [];
  if (count > 0) lines.push(...judgeFindingLines(newFindings, now));
  if (ownerReports.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(...ownerReportLines(ownerReports));
  }

  // Cap the whole message, not each line — GroupMe rejects an over-length
  // post, which would drop the alert exactly when a big batch made it most
  // worth sending.
  const text = lines.join('\n').trim();
  if (text.length <= GROUPME_MAX_CHARS) return text;
  return `${text.slice(0, GROUPME_MAX_CHARS - 1).trimEnd()}…`;
}

/** Judge-found answers: Roger's own weekly self-check disagreeing with him. */
function judgeFindingLines(newFindings, now) {
  const count = newFindings.length;
  const lines = [
    count === 1
      ? "Roger flagged one of his own answers. His weekly self-check thinks he got this wrong:"
      : `Roger flagged ${count} of his own answers. His weekly self-check thinks he got these wrong:`,
    '',
  ];

  for (const p of newFindings.slice(0, 3)) {
    lines.push(`"${oneLine(p.case?.question, QUESTION_PREVIEW_CHARS)}"`);
  }
  if (count > 3) lines.push(`…and ${count - 3} more.`);

  lines.push(
    '',
    count === 1
      ? "Don't lean on that answer until Brandon rules on it — the fix usually means clarifying the constitution, not just correcting Roger."
      : "Don't lean on those answers until Brandon rules on them — the fix usually means clarifying the constitution, not just correcting Roger."
  );
  return lines;
}

/**
 * Owner-reported answers. Named as owner reports rather than folded in with
 * the judge's findings on purpose — "a teammate says this is wrong" and "the
 * bot's self-check says this is wrong" carry different weight, and the league
 * should be able to tell which it is reading.
 */
function ownerReportLines(reports) {
  const n = reports.length;
  const lines = [
    n === 1
      ? 'An owner reported one of Roger\'s answers as wrong:'
      : `Owners reported ${n} of Roger's answers as wrong:`,
    '',
  ];
  for (const r of reports.slice(0, 3)) {
    lines.push(`"${oneLine(r.question, QUESTION_PREVIEW_CHARS)}"`);
  }
  if (n > 3) lines.push(`…and ${n - 3} more.`);
  lines.push('', 'Flagged on the card so nobody else gets caught by it. Brandon has the details.');
  return lines;
}

// ---------------------------------------------------------------------------
// Owner-reported answers ("this answer looks wrong")
//
// Second finding source, same delivery. The judge finds what it finds weekly;
// owners find what they hit in practice, and the August 2026 5th-year option
// bug — a hand-written seed card wrong for ~5 months — is the kind only a
// human notices. Both feed the same issue-and-post pipeline so neither can
// rot in a store nobody opens.

/** @typedef {{ league: string, leagueLabel: string, qaId: string, question: string, records: Array<{teamName: string, reason: string|null, at: string}> }} OwnerReport */

export function buildReportIssueTitle(report) {
  return `Ask Roger: ${report.leagueLabel} owners reported answer ${report.qaId}`;
}

export function buildReportIssueBody(report, { runUrl, now } = {}) {
  const oldest = report.records[0];
  const days = ageInDays(oldest?.at, now ?? new Date());
  const lines = [
    `**${report.records.length} owner${report.records.length === 1 ? '' : 's'}** reported this Ask Roger answer as wrong`,
    `in ${report.leagueLabel}. Unlike a judge finding, this is a human saying the rulebook and the`,
    'answer disagree — worth reading before anything else.',
    '',
    '| | |',
    '|---|---|',
    `| Q&A id | \`${report.qaId}\` |`,
    `| League | ${report.leagueLabel} |`,
    `| Reports | ${report.records.length} |`,
    `| Oldest report | ${oldest?.at || 'unknown'} (${describeAge(days)} ago) |`,
    runUrl ? `| Workflow run | [logs](${runUrl}) |` : null,
    '',
    '**The question**',
    '',
    fenced(report.question),
    '',
    '**Who reported it, and why**',
    '',
  ].filter((l) => l !== null);

  for (const r of report.records) {
    if (r.reason) {
      lines.push(`- **${r.teamName}** said:`);
      // Indent the fence so it nests under the bullet instead of ending the list.
      lines.push('', `  ${fenced(r.reason).split('\n').join('\n  ')}`, '');
    } else {
      lines.push(`- **${r.teamName}** — _no reason given_`);
    }
  }

  lines.push(
    '',
    '### To close this out',
    '',
    '1. Check the answer against `src/data/league-constitution.ts`.',
    '2. If the answer is wrong because the **constitution is ambiguous**, fix the constitution —',
    '   patching only the answer leaves the trap armed for the next phrasing of the question.',
    '3. Correcting the rulebook does NOT rewrite the stored answer. Repair the stored `answer`',
    '   in place, preserving `id`/`askedBy`/`createdAt` so the card keeps its position.',
    '4. Clear the reports with **Mark reports handled** on the card. That is what stops this',
    '   issue being re-filed — closing the issue alone does not, because the notifier reads the',
    '   flag store, not GitHub.',
    '',
    '_Reporter names and reasons are admin-only on the site; they appear here because this issue',
    'is for the commissioner._'
  );

  return lines.join('\n');
}

export function buildReportBumpComment(report, { runUrl, now } = {}) {
  const days = ageInDays(report.records[0]?.at, now ?? new Date());
  return [
    `Still reported — **${describeAge(days)}** since the first owner flagged it, ` +
      `${report.records.length} report${report.records.length === 1 ? '' : 's'} outstanding.`,
    '',
    'Clear them with **Mark reports handled** on the card once the answer is sorted.',
    runUrl ? `\nWorkflow run: ${runUrl}` : '',
  ]
    .join('\n')
    .trimEnd();
}

/**
 * Should we say anything at all?
 *
 * A weekly "all good" ping trains people to ignore the channel, so silence is
 * the correct output whenever there is no pending review and nothing errored.
 */
export function hasSomethingToReport(pending, judgeErrors, ownerReports = []) {
  return pending.length > 0 || judgeErrors.length > 0 || ownerReports.length > 0;
}
