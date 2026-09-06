/**
 * The group chat as a FALLBACK channel for deadline reminders.
 *
 * The model, as of the notification migration (Sep 2026):
 *
 *   1. Every deadline reminder goes to web push, to every owner it concerns.
 *   2. The group chat then carries the message ONLY for the owners push did
 *      not reach — @-mentioned by name, with a link to turn notifications on.
 *   3. Nobody unreached, no chat post at all.
 *
 * So the chat volume is a direct function of how many owners have subscribed,
 * and it goes to zero on its own as they do. That is the whole migration
 * strategy: no announced cutover date, no flag to flip later. Subscribing is
 * how an owner stops being tagged in front of the league, which is a stronger
 * incentive than any amount of asking.
 *
 * WHY MENTION RATHER THAN JUST NAME. This post exists precisely because these
 * owners get no notifications from us. A line of plain text in a chat they are
 * not watching reaches them no better than the push did. A GroupMe @-mention
 * fires GroupMe's own notification, which is the one channel we know still
 * works for them.
 *
 * "UNREACHED" IS A DELIVERY FACT, NOT A SUBSCRIPTION ONE. It comes from the
 * fan-out's real per-franchise result (`undelivered` from push-fanout), so a
 * muted category, a dead endpoint and a browser that never granted permission
 * all count the same — because they mean the same thing to an owner about to
 * miss a deadline. The corollary is the safety property: when push does not
 * run at all, the fan-out reports EVERYONE unreached and this composes the
 * broadcast the chat always got. Degrading toward a redundant message is
 * correct; degrading toward silence is not.
 *
 * Pure — no network, no Redis, no clock. tests/reminder-fallback.test.ts owns
 * the invariants.
 */

import { buildMentionAttachment } from './groupme.mjs';
import { locateMentions } from './groupme-mentions.mjs';

/** GroupMe truncates past 1000 characters; leave room rather than race it. */
export const MAX_CHARS = 950;

/**
 * Past this many named owners the post is a wall rather than a callout, and
 * the mention list stops reading as "you specifically". The remainder is
 * summarized instead.
 */
export const MAX_NAMED = 10;

/**
 * The one place the "turn these on" ask is worded. Every reminder that reaches
 * the chat carries it — that is the only category that does, deliberately: the
 * columns and the poll are not what we are migrating, and a CTA on every bot
 * post goes stale and stops being read within a week.
 */
export function buildCta(notificationsUrl, { tagged = true } = {}) {
  const ask = tagged
    ? "You're getting tagged here because your phone isn't. Turn notifications on and I'll stop doing this in front of everyone"
    : 'Get these on your phone instead of in here';
  // The URL goes LAST and takes no trailing period. GroupMe autolinks
  // punctuation glued to a URL and ships a 404 to every owner who taps it —
  // see docs/claude/rules/league-urls.md. The send path sanitizes this anyway,
  // but that sanitizer's call sites are pinned by test (it corrupts structured
  // text, so it must not spread), and composing chat copy that depends on being
  // rescued downstream is not a habit worth having.
  return `${ask}: ${notificationsUrl}`;
}

/**
 * Compose the fallback chat post.
 *
 * @param {object} args
 * @param {string} args.headline First line — what the deadline is.
 * @param {string} [args.body] Optional paragraph under the headline.
 * @param {Array<{franchiseId: string, name: string, detail?: string}>} args.unreached
 *   The owners push did not reach. An empty array yields `null`: no unreached
 *   owner means the chat has nothing to add, and returning a post anyway is
 *   how this lane would quietly become the broadcast it replaced.
 * @param {Map<string, {userId: string}>} [args.mentions] franchiseId → GroupMe
 *   user. A franchise missing from it is named in plain text — degrading to a
 *   weaker callout beats dropping the owner from the post.
 * @param {string} args.notificationsUrl Absolute, built with `league.url()`.
 * @returns {{text: string, attachments: Array<object>, named: string[]} | null}
 */
export function buildFallbackPost({
  headline,
  body = '',
  unreached,
  mentions = new Map(),
  notificationsUrl,
}) {
  const rows = (unreached ?? []).filter((r) => r && r.franchiseId && r.name);
  if (rows.length === 0) return null;

  const named = rows.slice(0, MAX_NAMED);
  const overflow = rows.length - named.length;

  // Built twice at most: once with each owner's specific problem, and — only
  // if that overruns GroupMe's limit — once with bare names. Dropping the
  // detail is the right thing to lose, because the push already carried it and
  // the site has all of it; the mention is what this post is for.
  const render = (withDetail) => {
    const tokens = [];
    const lines = named.map((r) => {
      const mention = mentions.get(r.franchiseId);
      const token = mention ? `@${r.name}` : r.name;
      if (mention) tokens.push({ userId: mention.userId, token });
      const detail = withDetail && r.detail ? `: ${r.detail}` : '';
      return `${token}${detail}`;
    });
    if (overflow > 0) {
      lines.push(`…and ${overflow} more`);
    }
    const parts = [headline];
    if (body) parts.push(body);
    parts.push(lines.join('\n'));
    parts.push(buildCta(notificationsUrl));
    return { text: parts.join('\n\n'), tokens };
  };

  let { text, tokens } = render(true);
  if (text.length > MAX_CHARS) ({ text, tokens } = render(false));

  // Loci are offsets into the FINAL bytes, so they are located after the text
  // is settled — computing them against a draft that later shrank would
  // highlight the wrong words, or run off the end of the message.
  const located = locateMentions(text, tokens);
  // The attachment SHAPE has one implementation, in the post primitive itself
  // — it also drops any malformed entry, which is the behaviour we want if a
  // locus ever comes back wrong rather than shipping GroupMe a bad payload.
  const attachment = buildMentionAttachment(located);

  return {
    text,
    attachments: attachment ? [attachment] : [],
    named: named.map((r) => r.franchiseId),
  };
}
