/**
 * ESPN CDN URL matching — the single definition.
 *
 * Every composite surface in the app gates on "is this headshot a transparent
 * ESPN cutout?", because MFL's fallback JPG has a baked-in background that
 * ruins the layering. That question used to be answered with
 * `url.includes('espncdn.com')` in eight places, which CodeQL flags as
 * `js/incomplete-url-substring-sanitization` (high): the string can appear
 * ANYWHERE in the URL, so both `https://evil.com/espncdn.com/x.png` (path) and
 * `https://espncdn.com.evil.com/x.png` (a lookalike registrable domain) pass a
 * substring test. Headshot URLs are fed into `<img src>` and, on the OG path,
 * fetched server-side — so the host is the only part worth trusting.
 *
 * This module is a LEAF on purpose: no imports, no Node built-ins. One of its
 * callers is a client-hydrated React island
 * (`components/theleague/trade-builder/TradeCompositeStrip.tsx`), and anything
 * this file pulled in would follow it into the browser bundle.
 *
 * `tests/espn-cdn.test.ts` pins the behavior AND scans `src/` to fail the build
 * if a bare `includes('espncdn.com')` reappears — the reason there were eight
 * copies is that hardening two of them left no tripwire for the rest.
 */

/**
 * True only when the URL is an http(s) URL whose actual HOST is ESPN's CDN
 * (`espncdn.com` or a subdomain of it — in practice always `a.espncdn.com`).
 *
 * The SCHEME is checked as well as the host, because a host check alone is not
 * enough: `javascript:`, `data:` and `ftp:` are not "special" schemes in the
 * WHATWG URL parser, so it reads `//a.espncdn.com/...` after them as a real
 * authority — `new URL('javascript://a.espncdn.com/%0aalert(1)').hostname` is
 * `a.espncdn.com`. Nothing renders those today (`<img src="javascript:...">`
 * does not execute, and the OG path's `fetch` throws into a catch) and the
 * substring test had the same hole, so this is hardening rather than a fix for
 * a live bug — but the predicate's contract is "this is an ESPN CDN image",
 * and a `javascript:` URL must never satisfy it.
 *
 * Protocol-relative URLs (`//a.espncdn.com/...`) are resolved against `https:`
 * rather than rejected. `new URL()` throws on them, and the substring test this
 * replaces accepted them, so parsing them is what keeps the tightening
 * behavior-preserving instead of quietly dropping a working headshot. A truly
 * relative path (`/i/headshots/...`) still returns false: it names no host, and
 * the one relative shape the old test would have accepted — `/espncdn.com/x.png`
 * — is precisely the confusion this exists to reject.
 */
export function isEspnCdnUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname;
    return host === 'espncdn.com' || host.endsWith('.espncdn.com');
  } catch {
    return false;
  }
}
