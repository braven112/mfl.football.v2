/**
 * Resolve the calling client's IP address from proxy headers.
 *
 * Used to key rate limits on UNAUTHENTICATED endpoints, where there is no
 * session and therefore no franchiseId for `checkRateLimit` to key on.
 *
 * Header order is a trust ranking, not a convenience:
 *
 * 1. `CF-Connecting-IP` — authoritative. Cloudflare OVERWRITES it on every
 *    request, so a client cannot forge it. Every real hostname for this site
 *    is proxied through Cloudflare (they resolve to Cloudflare IPs), so this
 *    is the header that will actually be present in production.
 * 2. `X-Forwarded-For` — best effort. Vercel sets it, but on a URL that
 *    bypasses Cloudflare (a raw *.vercel.app deployment) a caller can send
 *    their own and shift the leftmost entry. Treat a limit keyed on this as
 *    a speed bump, not a control.
 * 3. `X-Real-IP` — last resort, same caveat.
 *
 * Returns null when no header yields anything usable. Callers must decide
 * what that means for them; for a rate limit the safe reading is "cannot
 * identify this caller", not "this caller is fine".
 */
export function getClientIp(request: Request): string | null {
  const cf = request.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;

  // Leftmost entry is the original client; the rest are proxy hops.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const real = request.headers.get('x-real-ip')?.trim();
  return real || null;
}
