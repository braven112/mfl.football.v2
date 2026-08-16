/**
 * Link punctuation — chat clients glue the sentence's period onto our URL.
 *
 * GroupMe's autolinker is greedy about the character that immediately
 * follows a URL: a message ending
 *
 *   Review your plan at https://www.theleague.us/rosters.
 *
 * renders a link whose href is `.../rosters.` — trailing period included —
 * which 404s for every owner who taps it. Roger's roster-cutdown touch
 * shipped exactly that (reported 2026-08-16), and the same trap is one
 * template edit away in every other lane: the Schefter rumor CTA, the
 * speculation deep link, the weekly-article promos, the lineup nag.
 *
 * Two halves, because one is not enough:
 *
 * 1. OUTGOING — `stripLinkAdjacentPunctuation` runs inside every bot-post
 *    primitive (`scripts/lib/groupme.mjs`, `scripts/lib/speculation-groupme.mjs`,
 *    `src/utils/groupme-client.ts#postAsBot`) so we stop emitting them. This
 *    lives on the SEND path, not in a template guard test: a large share of
 *    GroupMe text is composed at runtime (LLM-written Schefter bodies
 *    routinely end a sentence right after a link), so nothing static catches
 *    those.
 *
 * 2. INBOUND — `trimTrailingPunctuationFromPath` powers a 302 in
 *    `src/middleware.ts`. Half the problem is already out of our hands:
 *    messages sent BEFORE the outgoing fix are still in the chat, still
 *    dead, and we can't edit them. The redirect also covers links owners
 *    paste into iMessage, email, or Slack, which autolink the same way, and
 *    anything typed with a sentence's period attached. Every URL we serve
 *    is punctuation-free, so a path ending in one is never a real route —
 *    trimming it can only turn a 404 into the page the owner wanted.
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

/**
 * Inbound half: given a request pathname, return the same path with the
 * trailing punctuation removed, or `null` when there is nothing to do or the
 * result would be unsafe to redirect to.
 *
 * Refuses (returns null) rather than redirecting when:
 *
 * - Nothing would change. Keeps the redirect idempotent — the trimmed result
 *   never matches again, so there is no loop.
 * - The path does not start with exactly one `/`. This is the open-redirect
 *   guard and it is the whole reason this is a function instead of a
 *   one-line `.replace()` at the call site: a request for `//evil.com.`
 *   trims to `//evil.com`, and a `Location: //evil.com` is protocol-relative
 *   — the browser leaves our origin entirely. Same for the `/\evil.com`
 *   backslash variant that some clients normalize to `//`.
 * - The path contains an ASCII control character. `URL#pathname` keeps
 *   percent-encoding so a raw CR/LF cannot normally reach us, but a value
 *   that lands in a `Location` header gets an explicit check regardless.
 *
 * PATH ONLY — the query string is deliberately left alone, and this is a
 * measured limitation rather than an oversight. `/api/suggestions/gif-search?q=`
 * carries free-form user text; trimming there would silently turn a search for
 * `cat.` into a search for `cat` on every request. The cost is that a link
 * ending in a query value (`/schefter/tip?target=0001.`) is NOT rescued —
 * the stray character lands inside the param. In practice the outgoing half
 * stops us emitting those, and the one deep link we build with a query
 * (`/news?post=<id>`) ends in a `#post-<id>` fragment, which browsers never
 * send to the server, so it absorbs the character harmlessly.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
export function trimTrailingPunctuationFromPath(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) return null;

  const trimmed = pathname.replace(new RegExp(`[${TRAILING_PUNCTUATION}]+$`), '');
  if (trimmed === pathname) return null;
  if (trimmed.length === 0) return '/';

  if (trimmed[0] !== '/' || trimmed[1] === '/' || trimmed[1] === '\\') return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;

  return trimmed;
}

export const __testing__ = { TRAILING_PUNCTUATION, URL_WITH_TRAILING_PUNCTUATION };
