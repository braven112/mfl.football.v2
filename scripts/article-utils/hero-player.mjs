/**
 * Hero-player selection for Schefter article composites.
 *
 * The composite article hero (ArticleHero.astro) casts the player an article
 * most prominently features — an ESPN cutout over that player's NFL team
 * gradient. This helper picks that player deterministically from the players
 * the article already grades/scores, so the face on the hero matches the story
 * in the body (never a random/stock face).
 *
 * Reusable across every article type: pass a scored candidate list plus a
 * lookup of the raw MFL feed records, and get back the winning MFL player id.
 */

/**
 * Pick the MFL player id an article should feature on its composite hero.
 *
 * Selection order (each stage only narrows if it leaves candidates):
 *   1. Drop candidates with no id or no matching feed record.
 *   2. Prefer non-DEF players (team defenses have no ESPN cutout).
 *   3. Prefer players with an `espn_id` (a real headshot to composite over the
 *      gradient). If none qualify, the top-ranked player is still returned so
 *      `heroPlayerId` names the genuinely-featured player and the hero falls
 *      back to the team logo at render time.
 *   4. Highest score wins; ties break by ascending id so output is stable
 *      across runs (no Date/random dependence).
 *
 * @param {Array<{ id?: string, score?: number }>} candidates
 *   Scored players the article features (e.g. by fantasy points, bid, or
 *   projection). Order does not matter — the max is chosen explicitly.
 * @param {Map<string, { position?: string, espn_id?: string }>} playerMeta
 *   MFL player id → raw feed record (needs `position` and `espn_id`).
 * @returns {string | null} MFL player id, or null when no candidate qualifies.
 */
export function pickHeroPlayer(candidates, playerMeta) {
  const scored = (candidates || [])
    .filter((c) => c && c.id && playerMeta.has(c.id))
    .map((c) => ({
      id: String(c.id),
      score: Number.isFinite(c.score) ? c.score : 0,
      meta: playerMeta.get(c.id),
    }));
  if (scored.length === 0) return null;

  const nonDef = scored.filter((c) => (c.meta.position || '').toUpperCase() !== 'DEF');
  const positionPool = nonDef.length > 0 ? nonDef : scored;

  const withHeadshot = positionPool.filter((c) => c.meta.espn_id);
  const pool = withHeadshot.length > 0 ? withHeadshot : positionPool;

  const winner = pool.reduce((best, c) =>
    c.score > best.score || (c.score === best.score && c.id < best.id) ? c : best,
  );
  return winner.id;
}
