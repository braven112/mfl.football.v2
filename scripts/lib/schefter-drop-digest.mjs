/**
 * Drop digest — collapse a scan's pure-drop posts into ONE GroupMe message.
 *
 * Every drop already lands on the league feed as its own post. Leagues with
 * features.groupMeDropDigest additionally announce drops in the GroupMe chat,
 * but a post-deadline cut day can produce a dozen drops in a single scan — so
 * the scan's non-big drops collapse into a single digest entry that rides the
 * same pending queue (quiet hours / spacing / staleness / quality gate) as
 * big-name drops. Big drops (post.bigDrop) keep their own individual pings
 * and are NOT part of the digest.
 *
 * Templates here are deterministic on purpose — tests/schefter-drop-digest.test.ts
 * pins the output shape.
 */

// GroupMe messages cap out around 1000 characters; keep digests scannable.
export const MAX_DIGEST_LINES = 10;

function formatNameList(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * Build the digest headline/body for a scan's drop posts.
 *
 * @param {Array<{ headline: string, body: string, team: string, playerNames: string[] }>} drops
 *   One entry per pure-drop post, oldest first.
 * @returns {{ headline: string, body: string } | null} null when there is nothing to say.
 */
export function buildDropDigest(drops) {
  if (!Array.isArray(drops) || drops.length === 0) return null;

  if (drops.length === 1) {
    const [d] = drops;
    const names = (d.playerNames ?? []).filter(Boolean);
    // A single bulk-drop transaction: the feed post features one player, but
    // the chat ping should name everyone who hit the wire.
    if (names.length > 1) {
      return {
        headline: `${d.team} cut ${names.length} players`,
        body: `${d.team} cut ${formatNameList(names)}. All free agents now.`,
      };
    }
    // Single player — the feed post's own copy is already the right message.
    return { headline: d.headline, body: d.body };
  }

  const lines = drops.slice(0, MAX_DIGEST_LINES).map(d => {
    const names = (d.playerNames ?? []).filter(Boolean);
    if (names.length > 1) return `• ${d.team} cut ${formatNameList(names)}`;
    return `• ${d.headline}`;
  });
  const overflow = drops.length - MAX_DIGEST_LINES;
  if (overflow > 0) {
    lines.push(`…plus ${overflow} more cut${overflow === 1 ? '' : 's'}.`);
  }

  const totalPlayers = drops.reduce(
    (n, d) => n + Math.max(1, (d.playerNames ?? []).filter(Boolean).length),
    0,
  );

  return {
    headline: `Roster cuts: ${totalPlayers} players hit the wire`,
    body: `${lines.join('\n')}\n\nAll free agents now — first come, first served.`,
  };
}
