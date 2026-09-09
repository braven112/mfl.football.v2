/**
 * Draft-pick tokens inside MFL transaction payloads.
 *
 * Plain `.mjs` on purpose: `scripts/schefter-scan.mjs` runs as bare
 * `node scripts/schefter-scan.mjs` in CI and cannot import a `.ts` module,
 * while the transactions page needs the same parsing with types on top. Same
 * arrangement as `src/config/leagues-data.mjs` — the implementation lives
 * here, `src/utils/mfl-transactions.ts` re-exports it typed.
 *
 * MFL WRITES TWO NOTATIONS AND THE ARCHIVE USES BOTH:
 *
 *   FP_<franchise>_<year>_<round>   a pick in a draft not yet held.
 *                                   543 tokens across both leagues.
 *   DP_<round>_<pick>               a slot in the draft being conducted now.
 *                                   683 tokens, 2007–2026, both leagues.
 *                                   BOTH numbers are ZERO-BASED: `DP_0_11`
 *                                   is round 1, pick 12.
 *
 * `DP_` is the more common of the two, which is exactly why it mattered that
 * `schefter-scan.mjs` used to match only `FP_`: every `DP_` fell through to
 * the player-id branch and rendered as "Player DP_0_11" in a published post.
 */

/**
 * 1 → "1st", 2 → "2nd", 21 → "21st".
 *
 * A real suffix rule rather than a five-entry table with a `th` fallback. The
 * table was not WRONG for any round the archive holds — the deepest draft on
 * record is 9 rounds, and 11-13 take "th" anyway — but "21th" was one deeper
 * draft away, and the rule costs the same as the lookup.
 */
export function roundOrdinal(round) {
  const n = Number(round);
  if (!Number.isFinite(n)) return String(round);
  const mod100 = Math.abs(n) % 100;
  // 11, 12 and 13 take "th" despite ending in 1, 2, 3.
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[Math.abs(n) % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * Parse one traded-asset token.
 *
 * @param {string} token
 * @returns {{raw: string, scope: 'future'|'current', franchiseId: string|null,
 *   year: number|null, round: number, pick: number|null} | null}
 *   null when the token is a plain player id rather than a pick.
 */
export function parsePickToken(token) {
  const raw = String(token ?? '').trim();

  const future = raw.match(/^FP_(\d{4})_(\d{4})_(\d+)$/);
  if (future) {
    return {
      raw,
      scope: 'future',
      franchiseId: future[1],
      year: parseInt(future[2], 10),
      round: parseInt(future[3], 10),
      pick: null,
    };
  }

  const current = raw.match(/^DP_(\d+)_(\d+)$/);
  if (current) {
    return {
      raw,
      scope: 'current',
      franchiseId: null,
      year: null,
      round: parseInt(current[1], 10) + 1,
      pick: parseInt(current[2], 10) + 1,
    };
  }

  return null;
}

/**
 * Human label for a parsed pick.
 *
 * The `future` wording is unchanged from `schefter-scan.mjs`'s original
 * `parseDraftPick` — "Rebels' 2026 3rd" — so already-published posts and new
 * ones read the same. `current` picks had no wording at all before, because
 * they were never recognised as picks.
 *
 * @param {ReturnType<typeof parsePickToken>} pick
 * @param {(franchiseId: string) => string | undefined} [nameFor]
 *   Resolves a franchise id to a display name. Omitted or unresolved falls
 *   back to "Team 0005", matching the previous behaviour.
 */
export function formatPickLabel(pick, nameFor) {
  if (!pick) return '';
  if (pick.scope === 'future') {
    const name = (nameFor && nameFor(pick.franchiseId)) || `Team ${pick.franchiseId}`;
    return `${name}'s ${pick.year} ${roundOrdinal(pick.round)}`;
  }
  return `${roundOrdinal(pick.round)} round, pick ${pick.pick}`;
}

/**
 * Split one side of a trade into its player ids and its picks.
 *
 * @param {string | undefined | null} raw comma-delimited asset list
 * @returns {{players: string[], picks: Array<NonNullable<ReturnType<typeof parsePickToken>>>}}
 */
export function splitTradeAssets(raw) {
  const players = [];
  const picks = [];
  for (const token of String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const pick = parsePickToken(token);
    if (pick) picks.push(pick);
    else players.push(token);
  }
  return { players, picks };
}
