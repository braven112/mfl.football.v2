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
 * 2. INBOUND — `resolvePunctuationRedirect` powers a 302 in
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
 * SCOPE — `stripLinkAdjacentPunctuation` is for CHAT PROSE, not structured
 * text. It cannot tell a sentence's period from one inside a quoted or
 * delimited value, so on JSON/config/markup it will happily turn
 * `{"url": "https://a.us/x.xml", ...}` into invalid JSON and
 * `?q=U.S.` into `?q=U.S`. Nothing structured flows to GroupMe today; keep
 * it that way rather than reusing this on a data file.
 *
 * WHO GETS SANITIZED — every bot post, including `/api/groupme/send`, which
 * is the owner-compose path behind `GroupMeChatPanel`. That is a deliberate
 * choice, not an oversight: that route posts Schefter-rewritten text through
 * the same bot identity, so the same autolink bug applies. (An earlier
 * version of this comment claimed the carve-out was
 * `groupme-client.ts#sendMessage`, which posts under an owner's own token —
 * that function has no production callers at all, so it was defending a
 * boundary that does not exist.) The one real cost is that an owner previews
 * their text before sending and this alters it afterwards; it only ever
 * removes punctuation that would have broken the link.
 */

/**
 * Punctuation we drop when it abuts the end of a URL.
 *
 * `?` is deliberately absent. It cannot appear in a `pathname` at all (it is
 * the query separator), and on the outgoing side a URL autolinked as
 * `…/rosters?` still resolves — so stripping it would cost a grammatically
 * load-bearing question mark ("Have you checked <url>?") to fix nothing.
 */
const TRAILING_PUNCTUATION = '.,;:!';

/** HTTP methods safe to answer with a redirect. See `resolvePunctuationRedirect`. */
const REDIRECTABLE_METHODS = new Set(['GET', 'HEAD']);

/** Status used for the inbound redirect. Exported so the middleware and the test agree. */
export const PUNCTUATION_REDIRECT_STATUS = 302;

/**
 * Past this length we return the text untouched. The regex is O(n²) on
 * adversarial input (`'www.'.repeat(n)` measured at 1.8s for 64KB), and no
 * legitimate GroupMe message is anywhere near this — the platform caps at
 * 1000 chars. Not reachable today, but it is one caller away from being a
 * cheap DoS, so the ceiling is cheaper than the argument.
 */
const MAX_SANITIZE_LENGTH = 8000;

/**
 * The last character a URL is allowed to end on before we treat what follows
 * as sentence punctuation. Excluding the closing delimiters `"'()[]<>` is
 * what stops us eating prose: in `(see https://a.us/x), then act` the comma
 * sits outside the link and no autolinker would ever have taken it, but a
 * pattern that lets the URL end on `)` will strip it anyway.
 */
const URL_TAIL_CHAR = `[^\\s${TRAILING_PUNCTUATION}"'()\\[\\]<>]`;

/**
 * A character that means we are still INSIDE the URL, so the punctuation we
 * matched was interior rather than trailing. Used as a negative lookahead —
 * strictly better than enumerating the allowed followers, which missed
 * emoji (`.../rosters.🚨`, and Roger's copy is emoji-dense) and angle
 * brackets. Without it, `https://a.us/x.y` would backtrack into
 * `https://a.us/x` + `.` and get mangled into `https://a.us/xy`.
 */
const URL_CONTINUATION_CHAR = '[\\w/%~+=&#@$*-]';

/**
 * Matches a URL plus the run of sentence punctuation glued to its end.
 * `https?://…` covers every link we build; the bare `www.` branch covers the
 * host-only mentions (`www.theleague.us`) that GroupMe also autolinks.
 */
const URL_WITH_TRAILING_PUNCTUATION = new RegExp(
  `((?:https?://|www\\.)\\S*${URL_TAIL_CHAR})([${TRAILING_PUNCTUATION}]+)(?!${URL_CONTINUATION_CHAR})`,
  'g',
);

/**
 * Remove sentence punctuation that would otherwise be swallowed into an
 * autolinked URL. Input that is not a non-empty string is returned as-is, so
 * callers can stay unguarded.
 *
 * @param {string} text
 * @returns {string} the sanitized text — or the input untouched when it is
 *   not a string, is empty, or exceeds `MAX_SANITIZE_LENGTH`.
 */
export function stripLinkAdjacentPunctuation(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (text.length > MAX_SANITIZE_LENGTH) return text;
  return text.replace(URL_WITH_TRAILING_PUNCTUATION, '$1');
}

/**
 * Inbound half: given a request pathname, return the same path with the
 * trailing punctuation removed, or `null` when there is nothing to do or the
 * result would be unsafe to redirect to.
 *
 * Refuses (returns null) rather than redirecting when:
 *
 * - The path does not start with exactly one `/`. This is the open-redirect
 *   guard and it is the whole reason this is a function instead of a
 *   one-line `.replace()` at the call site: a request for `//evil.com.`
 *   trims to `//evil.com`, and a `Location: //evil.com` is protocol-relative
 *   — the browser leaves our origin entirely. Same for the `/\evil.com`
 *   backslash variant that some clients normalize to `//`.
 * - The path contains an ASCII control character. `URL#pathname` keeps
 *   percent-encoding so a raw CR/LF cannot normally reach us, but a value
 *   that lands in a `Location` header gets an explicit check regardless.
 * - Nothing would change. Keeps the redirect idempotent — the trimmed result
 *   never matches again, so there is no loop.
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

  // Shape guards run FIRST — this is exported, so it must not hand back a
  // redirect target for input the middleware would never have produced.
  if (pathname[0] !== '/' || pathname[1] === '/' || pathname[1] === '\\') return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(pathname)) return null;

  const trimmed = pathname.replace(new RegExp(`[${TRAILING_PUNCTUATION}]+$`), '');
  if (trimmed === pathname) return null;
  return trimmed.length === 0 ? '/' : trimmed;
}

/**
 * The whole inbound decision as one pure function, so the invariants are
 * testable instead of grep-able. Returns the redirect target (path + query)
 * or `null` to leave the request alone.
 *
 * Only GET/HEAD are redirected. A 3xx on a POST/PATCH is a real hazard:
 * clients re-issue the follow-up as a GET and silently drop the body, so a
 * mistyped write would look like it succeeded and land nowhere. Every broken
 * chat link is a GET, so this costs us nothing.
 *
 * @param {string} method - the request method
 * @param {{ pathname: string, search?: string }} url - typically `context.url`
 * @returns {string | null}
 */
export function resolvePunctuationRedirect(method, url) {
  if (!REDIRECTABLE_METHODS.has(method)) return null;
  if (!url || typeof url.pathname !== 'string') return null;

  const trimmed = trimTrailingPunctuationFromPath(url.pathname);
  if (trimmed === null) return null;

  return `${trimmed}${url.search ?? ''}`;
}

export const __testing__ = {
  TRAILING_PUNCTUATION,
  URL_WITH_TRAILING_PUNCTUATION,
  REDIRECTABLE_METHODS,
  MAX_SANITIZE_LENGTH,
};
