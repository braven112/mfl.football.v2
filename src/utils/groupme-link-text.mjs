/**
 * GroupMe link hygiene — keep sentence punctuation out of autolinked URLs.
 *
 * GroupMe's client-side autolinker is greedy about the character that
 * immediately follows a URL: a message ending
 *
 *   Review your plan at https://www.theleague.us/rosters.
 *
 * renders a link whose href is `.../rosters.` — trailing period included —
 * which 404s for every owner who taps it. Roger's roster-cutdown touch
 * shipped exactly that (reported 2026-08-16), and the same trap is one
 * template edit away in every other lane: the Schefter rumor CTA, the
 * speculation deep link, the weekly-article promos, the lineup nag.
 *
 * A guard test can't cover this on its own — a large share of GroupMe text
 * is composed at runtime (LLM-written Schefter bodies routinely end a
 * sentence right after a link), so the fix has to live on the send path.
 * `stripLinkAdjacentPunctuation` runs inside every bot-post primitive:
 * `scripts/lib/groupme.mjs`, `scripts/lib/speculation-groupme.mjs`, and
 * `src/utils/groupme-client.ts#postAsBot`.
 *
 * This is a `.mjs` on purpose — the plain-node scripts and the TS runtime
 * both import it, same reason as `src/config/rules-qa-keys.mjs`.
 *
 * Deliberately NOT applied to `groupme-client.ts#sendMessage`, which posts
 * as a human owner using their own token. Rewriting an owner's own words is
 * a different decision than tidying our bot's copy.
 */

/**
 * Punctuation we will drop when it abuts the end of a URL. A trailing dot or
 * comma is never meaningful in one of our links, and in chat a message-final
 * URL conventionally takes no period at all.
 */
const TRAILING_PUNCTUATION = '.,;:!?';

/**
 * Matches a URL plus the run of sentence punctuation glued to its end.
 *
 * - `https?://…` covers every link we build; the bare `www.` branch covers
 *   the host-only mentions (`www.theleague.us`) that GroupMe also autolinks.
 * - Group 1 is forced to end on a NON-punctuation character, so the URL
 *   itself keeps any interior dots (`theleague.us`).
 * - The lookahead is what makes this safe: the punctuation run must be
 *   followed by whitespace, a closing quote/bracket, or end-of-string.
 *   Without it, `https://a.us/x.y` would backtrack into `https://a.us/x` +
 *   `.` and get mangled into `https://a.us/xy`.
 */
const URL_WITH_TRAILING_PUNCTUATION = new RegExp(
  `((?:https?://|www\\.)\\S*[^\\s${TRAILING_PUNCTUATION}])([${TRAILING_PUNCTUATION}]+)(?=[\\s"')\\]]|$)`,
  'g',
);

/**
 * Remove sentence punctuation that would otherwise be swallowed into an
 * autolinked URL. Non-string input passes through untouched so callers can
 * stay unguarded.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripLinkAdjacentPunctuation(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.replace(URL_WITH_TRAILING_PUNCTUATION, '$1');
}

export const __testing__ = { TRAILING_PUNCTUATION, URL_WITH_TRAILING_PUNCTUATION };
