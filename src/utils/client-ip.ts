/**
 * Resolve who is calling, from proxy headers, for rate-limiting an
 * UNAUTHENTICATED endpoint — there is no session there, so the shared
 * limiter's franchiseId key is unavailable.
 *
 * Two values, because no single header is both fine-grained AND trustworthy:
 *
 * - `client` identifies the individual caller. Behind Cloudflare that is
 *   `CF-Connecting-IP`, which Cloudflare overwrites on every request. But
 *   this app is ALSO reachable on its raw `*.vercel.app` deployment URLs,
 *   which bypass Cloudflare entirely (deployment protection is off
 *   project-wide, and cannot be turned on without 401ing the staging sites,
 *   which are preview deployments). On that path nothing overwrites the
 *   header, so a caller can send their own and rotate it per request. Treat
 *   `client` as attacker-controlled.
 *
 * - `nearestHop` is the last entry of `X-Forwarded-For`: the hop closest to
 *   us, appended by our own infrastructure rather than supplied by the
 *   caller. It is coarse — behind Cloudflare it is a Cloudflare edge address
 *   shared by many real users, so it must never carry a per-user-sized limit
 *   — but it is the one value a caller cannot forge, which makes it the
 *   right key for a ceiling. Taking the LAST entry rather than the first is
 *   what makes this hold whether the platform appends to a caller-supplied
 *   chain or replaces it outright: in the replace case there is one entry and
 *   last == first == the real address.
 *
 * A limit keyed only on `client` is not a limit at all against a caller who
 * can reach the origin directly; a limit keyed only on `nearestHop` locks out
 * everyone behind one Cloudflare edge. Use both — see
 * src/pages/api/auth/login.ts.
 */
export interface ClientIdentity {
  /** Best available identifier for the individual caller. Forgeable. */
  client: string | null;
  /** Nearest proxy hop, as our infrastructure saw it. Not forgeable. */
  nearestHop: string | null;
}

/** Split an X-Forwarded-For header into its non-empty, trimmed entries. */
function forwardedChain(request: Request): string[] {
  const raw = request.headers.get('x-forwarded-for');
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getClientIdentity(request: Request): ClientIdentity {
  const chain = forwardedChain(request);
  const realIp = request.headers.get('x-real-ip')?.trim() || null;
  const cf = request.headers.get('cf-connecting-ip')?.trim() || null;

  return {
    // Leftmost chain entry is the original client; the rest are proxy hops.
    client: cf ?? chain[0] ?? realIp,
    nearestHop: chain[chain.length - 1] ?? realIp,
  };
}
