/**
 * Fact checks for the speculation lane's AI-written copy.
 *
 * The model only knows what the prompt hands it, so anything it says about
 * how the two franchises relate is invented unless the input carried it. It
 * once called Pacific Pigskins (Northwest) and Midwestside Connection
 * (Southwest) "division rivals" because nothing told it otherwise. The prompt
 * now carries `sameDivision`, and this check rejects copy that mentions a
 * division when the pair does not share one, so the caller falls back to the
 * template instead of publishing the claim.
 */

/**
 * True only when both franchises have a known division and it is the same one.
 * @param {{division?: string}|undefined} a
 * @param {{division?: string}|undefined} b
 */
export function sharesDivision(a, b) {
  return !!a?.division && !!b?.division && a.division === b.division;
}

/**
 * Returns the post unchanged, or null when it makes a division claim the
 * input does not support.
 * @param {string|null} post
 * @param {{sameDivision: boolean}} facts
 * @returns {string|null}
 */
export function vetSpeculationCopy(post, { sameDivision }) {
  if (!post) return null;
  if (!sameDivision && /\bdivision/i.test(post)) return null;
  return post;
}
