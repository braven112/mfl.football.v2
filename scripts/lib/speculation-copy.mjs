/**
 * Fact checks for the speculation lane's AI-written copy.
 *
 * The model only knows what the prompt hands it, so anything it says about
 * how the two franchises relate is invented unless the input carried it. It
 * once called Pacific Pigskins (Northwest) and Midwestside Connection
 * (Southwest) "division rivals", and the buyer "desperate for QB stability",
 * because nothing told it otherwise. The prompt now carries the shared
 * division (or null), and this check rejects copy that states a division fact
 * the input does not support, or characterises a team's situation at all, so
 * the caller falls back to the template instead of publishing the claim.
 */

/**
 * The division both franchises play in, or null when they differ or either
 * is unknown.
 * @param {{division?: string}|undefined} a
 * @param {{division?: string}|undefined} b
 * @returns {string|null}
 */
export function sharedDivision(a, b) {
  return a?.division && b?.division && a.division === b.division ? a.division : null;
}

// Team-situation words the input never supports: it carries no standings and
// no roster context, so any of these is the model inventing a storyline.
const TEAM_SITUATION =
  /\b(desperat\w*|rebuild\w*|retool\w*|contend\w*|contender\w*|tank\w*|win-now|all-in|reeling|struggling|spiral\w*)\b/i;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the post unchanged, or null when it makes a claim the input does
 * not support.
 * @param {string|null} post
 * @param {{sharedDivision: string|null, divisionNames?: string[]}} facts
 *   `divisionNames` is every division in the league, so a post naming the
 *   wrong one is caught even when the pair does share a division.
 * @returns {string|null}
 */
export function vetSpeculationCopy(post, { sharedDivision, divisionNames = [] }) {
  if (!post) return null;
  if (!sharedDivision && /\bdivision/i.test(post)) return null;
  for (const name of divisionNames) {
    if (!name || name === sharedDivision) continue;
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(post)) return null;
  }
  if (TEAM_SITUATION.test(post)) return null;
  return post;
}
