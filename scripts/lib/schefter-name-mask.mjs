/**
 * Franchise-name masking for the LLM's MEMORY block.
 *
 * The rolling "RECENT POSTS" block exists for one purpose: stop Schefter
 * reusing an opener, closer or bit he just used. It never needed the names in
 * those posts — and carrying them was a live leak. On 2026-09-07 a trade-offer
 * post named "Fire Ready Aim" beside Cyrus Allen, who is and always has been a
 * Bring the Pain player. The `exposure` payload could not have produced that
 * pairing: `buildExposure` only lists players off the named team's own side,
 * and `escalatedPlayer` is re-picked from that same side. The name came from
 * the memory block, where the previous three trade posts had all named Fire
 * Ready Aim, and nothing downstream checks the franchise a post actually
 * prints.
 *
 * Both scanners read ONE `post-history.json` — the transaction scanner writes
 * posts that name teams legitimately (a completed trade is public), and the
 * rumor scanner then reads them back as memory. So masking has to live in the
 * shared block builder rather than in either lane, or the rumor lane keeps
 * seeing names the transaction lane wrote.
 *
 * This masker is deliberately BLUNTER than the scanner's
 * `redactFranchiseNamesInText`. That one is scope-aware and has a
 * `keepFranchise` escape hatch, because a post is sometimes allowed to name
 * one team. The memory block is allowed to name NONE, so there is no keep
 * parameter here and nothing to get wrong at a call site.
 *
 * Over-matching is the safe direction: a false hit costs one word of an
 * anti-repetition hint, a miss puts another team's name in front of the model.
 */

/**
 * Build a list of EVERY name a franchise answers to — current forms
 * (long/medium/short/abbrev), config `aliases`, and the same four forms on
 * each retired name in `history[]`.
 *
 * Retired names count because a reader identifies a team by them just as
 * well as by the current name — and in the AFL better, since the punitive
 * last-place rebrands are recent and memorable. Harvesting only the current
 * four fields is what let a tipster's "Cock Gobbler" (The Show's 2025
 * rebrand) survive redaction and land in a post that was not allowed to name
 * a second team.
 *
 * Keeps tokens length-sorted descending so a regex alternation matches the
 * longest form first (e.g. "Nashville Geeks" wins over "Geeks").
 *
 * Lives here rather than in the rumor scanner so the scanner, the transaction
 * scanner and the memory-block masker all harvest names the same way. Five
 * copies of the ownership walk once existed in this repo and two silently
 * disagreed; one harvest is the lesson from that.
 */
export function collectFranchiseNameTokens(teams) {
  const tokens = new Set();
  const add = (v) => {
    if (typeof v === 'string' && v.trim().length >= 2) tokens.add(v.trim());
  };
  for (const team of teams.values()) {
    const history = Array.isArray(team?.history) ? team.history : [];
    // A history entry carries its own aliases — "Heavy Chevy" retired with
    // aliases ["Heavy", "Chevy"], and a nickname for a retired name identifies
    // the franchise exactly as well as the retired name itself. Reading them
    // off `team` only (the original shape) left those invisible to the
    // redactor, so a tip saying "Chevy" reached the prompt intact.
    for (const form of [team, ...history]) {
      for (const field of ['name', 'nameMedium', 'nameShort', 'abbrev']) {
        add(form?.[field]);
      }
      for (const alias of Array.isArray(form?.aliases) ? form.aliases : []) {
        add(alias);
      }
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

/** What a masked franchise name becomes. Matches the scanner's redactor. */
export const MASKED_TEAM = '[a team]';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace every franchise name form in `text` with `[a team]`.
 *
 * Word-boundary anchored so "Pain" does not fire inside "painful" — the config
 * genuinely contains short nameShorts that are also ordinary words (`balls`,
 * `feelers`, `herd`, `chat`, `swift` are all somebody's short name), and the
 * memory block is prose, not a tip. A possessive survives the boundary
 * (`Pain's` → `[a team]'s`) because \b sits between "n" and "'".
 *
 * Returns `text` unchanged when there is nothing to mask, so a caller with an
 * empty team map degrades to today's behavior rather than throwing.
 */
export function maskFranchiseNames(text, teams) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!teams || typeof teams.values !== 'function') return text;
  const tokens = collectFranchiseNameTokens(teams);
  if (tokens.length === 0) return text;
  // Length-descending already, so the alternation prefers "Nashville Geeks"
  // over "Geeks" and a long form is never left half-masked.
  const pattern = new RegExp(`\\b(?:${tokens.map(escapeRegExp).join('|')})\\b`, 'gi');
  return text.replace(pattern, MASKED_TEAM);
}

/**
 * A masker bound to a team map, shaped for `buildRecentPostsPromptBlock`'s
 * `maskNames` option. Kept as its own export so both scanners pass the SAME
 * function rather than each writing an inline arrow that could drift.
 */
export function memoryNameMasker(teams) {
  return (text) => maskFranchiseNames(text, teams);
}
