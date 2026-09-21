/**
 * A remote image, served through Vercel's optimizer instead of at full size.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 * MFL's franchise `icon` is whatever the commissioner uploaded, at whatever
 * size they had. Archie's Fantasy Football League (10105) is the case that
 * forced this: every one of its 99 franchises carries a **1500×636 PNG of
 * around 400 KB** under a field called "icon", rendered by this app into a
 * 1.4rem box. That is roughly a quarter of a million times the pixels the box
 * can show, per franchise, on a board that holds every league an owner is in
 * and refreshes all afternoon.
 *
 * `/_vercel/image` is already wired up — `astro.config.ts` sets the Vercel
 * adapter's `imageService: true` — so the fix is a URL, not a pipeline: the
 * edge fetches the original once, re-encodes it to webp at the width we ask
 * for, and caches it. ~10 KB instead of ~400 KB, and MFL is asked for the
 * original once per cache period rather than once per viewer.
 *
 * ── IT RESIZES; IT DOES NOT CROP ──────────────────────────────────────────
 * The optimizer scales to a WIDTH and keeps the aspect ratio. Making the mark
 * SQUARE is a rendering decision and stays in CSS (`object-fit: cover` on the
 * rung that earned a crop). The two work together: this decides how many
 * pixels cross the wire, CSS decides which of them you see.
 */

/**
 * The one width we ask for.
 *
 * ONE width, not a set, on purpose. Every distinct `w` is a separate source
 * transform and a separate cache entry, and these marks render into boxes of
 * 1.4rem and 2.25rem — a per-site width would double the transforms to save
 * bytes nobody would notice.
 *
 * 256 rather than something nearer the box because the crop happens on the
 * SHORT side and we do not know the aspect ratio: a 1500×636 banner asked for
 * at `w=256` comes back 256×109, which still covers a 2.25rem square at 3×
 * device pixel ratio. A width chosen for a square source would land blurry on
 * every wide one.
 */
export const REMOTE_MARK_WIDTH = 256;

/**
 * Is `/_vercel/image` actually there to serve this?
 *
 * It exists only on a Vercel deployment. Locally (`pnpm dev`, vitest, any
 * script) the path 404s, so rewriting there would replace a working image with
 * a broken one — the optimization must degrade to the original, never to
 * nothing. `VERCEL` is set on every Vercel runtime including previews.
 */
function onVercel(): boolean {
  return !!process.env.VERCEL;
}

/**
 * `url`, served through the image optimizer when we are somewhere that has
 * one; `url` unchanged when we are not.
 *
 * ── WHAT CONSTRAINS WHERE OUR EDGE WILL FETCH FROM ────────────────────────
 * `/_vercel/image?url=` makes our own edge fetch what it is given, so the set
 * of hosts it will fetch from is a security boundary — and it is declared in
 * ONE place, `vercel.json`'s `images.remotePatterns`. Vercel answers a `url=`
 * outside that list with a 400 rather than fetching it, which is why this
 * helper does not keep a second allowlist that could drift out of step with
 * the one actually being enforced. The check here is structural only: HTTPS,
 * a real hostname, no credentials, no odd port — enough that we never hand the
 * edge a URL that is malformed on its face.
 *
 * Non-HTTP, relative and data URLs are returned untouched. A local
 * `/assets/…` mark is same-origin and already the right size, so there is
 * nothing to optimize — and it is usually an SVG, which the optimizer does not
 * touch anyway.
 */
export function optimizedRemoteImage(url: string, width: number = REMOTE_MARK_WIDTH): string {
  if (!url || !url.startsWith('https://') || !onVercel()) return url;

  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return url;
    if (parsed.port && parsed.port !== '443') return url;
    if (!parsed.hostname.includes('.')) return url;
  } catch {
    return url;
  }

  return `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}
