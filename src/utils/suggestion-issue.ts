/**
 * Turn a Board idea into a GitHub issue an agent can actually work.
 *
 * Pure functions, no I/O — the network half lives in `./github-issues`. Split
 * that way so the body can be asserted in a test without a token, which is the
 * half that rots: a field added to the composer and not to the body means the
 * issue silently loses the thing the owner typed.
 *
 * The shape is deliberate. An issue that only says "the standings page is
 * confusing" costs a round-trip back to the owner, and by then the owner has
 * moved on — which is precisely the MFL-suggestion-void failure mode this
 * feature exists to avoid. So every structured field the composer collected is
 * carried across under its own heading, verbatim, and a link back to the
 * original thread is always the last line.
 */

import type { Idea } from '../types/suggestions';
import { getLeagueBySlug, leagueUrl } from '../config/leagues';

/**
 * Labels applied at filing time. `suggestion-box` is the provenance marker —
 * it is what makes "everything the league asked for" one issue search — and
 * the second label routes by kind.
 */
export function issueLabels(idea: Idea): string[] {
  const labels = ['suggestion-box'];
  if (idea.category === 'website') {
    labels.push(idea.websiteFields?.type === 'bug' ? 'bug' : 'enhancement');
  } else if (idea.category === 'rule-change') {
    labels.push('rule-change');
  }
  return labels;
}

/**
 * Issue title. Prefixed with the kind so the tracker list is skimmable, and
 * NOT prefixed with the idea id — the id is in the body, and a title full of
 * `idea_k3j2h1` is unreadable in a notification email.
 */
export function buildIssueTitle(idea: Idea): string {
  const kind =
    idea.category === 'website'
      ? idea.websiteFields?.type === 'bug'
        ? 'Bug'
        : 'Feature'
      : idea.category === 'rule-change'
        ? 'Rule change'
        : 'Idea';
  return `[${kind}] ${idea.title}`;
}

/**
 * Issue body.
 *
 * `leagueSlug` decides which site the "discussed on The Board" link points at,
 * and it comes from the caller's session rather than from the idea, because an
 * idea carries no league of its own — the BOARD it lives on is its league.
 */
export function buildIssueBody(idea: Idea, leagueSlug: string): string {
  const league = getLeagueBySlug(leagueSlug);
  const lines: string[] = [];

  lines.push(`> Filed from the Suggestion Box by **${idea.author.teamName}**.`);
  lines.push('');

  const ws = idea.websiteFields;
  if (idea.category === 'website' && ws) {
    lines.push(`**Page / feature:** ${ws.pageOrFeature}`);
    lines.push('');
    lines.push('### The problem');
    lines.push(ws.problem);
    lines.push('');
    lines.push('### What should happen instead');
    lines.push(ws.desiredBehavior);
    if (idea.body.trim()) {
      lines.push('');
      lines.push('### Additional context');
      lines.push(idea.body.trim());
    }
  } else {
    lines.push('### The ask');
    lines.push(idea.body.trim() || '_(no description given)_');
  }

  if (idea.images.length) {
    lines.push('');
    lines.push('### Screenshots');
    // Markdown image embeds — the URLs are Vercel Blob and publicly readable,
    // which is what lets the issue show the screenshot rather than link it.
    for (const img of idea.images) {
      lines.push(`![${img.alt ?? 'screenshot'}](${img.url})`);
    }
  }

  // Reactions are the league's rough vote on whether this matters. Worth
  // carrying: an idea with nine 🔥 is not the same priority as one with none.
  const reactionSummary = Object.entries(idea.reactions)
    .filter(([, ids]) => ids.length > 0)
    .map(([emoji, ids]) => `${emoji} ${ids.length}`)
    .join('  ');
  if (reactionSummary) {
    lines.push('');
    lines.push(`**League reaction:** ${reactionSummary}`);
  }

  lines.push('');
  lines.push('---');
  // `leagueUrl` rather than string concatenation — CLAUDE.md's league-urls rule.
  // A league missing from the registry still produces a usable issue; it just
  // loses the backlink, which beats throwing inside a button handler.
  const backlink = league
    ? `[the Board thread](${leagueUrl(league, `/suggestions#idea-${idea.id}`)})`
    : `the Board thread (idea \`${idea.id}\`)`;
  lines.push(
    `Discussed on ${backlink}${league ? ` in ${league.name}` : ''} · posted ${formatDate(idea.createdAt)}`,
  );

  return lines.join('\n');
}

/** `2026-09-06` → `Sep 6, 2026`. UTC so the string is stable across runners. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
