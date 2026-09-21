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
 * The hosts the optimizer will fetch a source image from — THE one copy.
 *
 * `astro.config.ts` imports this into the adapter's `imagesConfig`, so the
 * list our own edge enforces and the list this helper checks against cannot
 * drift apart. That matters in both directions: a host in the config but not
 * here just loses an optimization, while a host here but not in the config is
 * a 400 and a broken image.
 *
 * It is a security boundary, not a convenience list — `/_vercel/image?url=`
 * makes our edge fetch whatever it is handed.
 */
export const REMOTE_MARK_HOSTS = [
  { protocol: 'https' as const, hostname: '**.myfantasyleague.com' },
];

/**
 * Does `hostname` match one of the patterns above?
 *
 * Vercel's `**.` matches the domain AND any subdomain of it, so
 * `**.myfantasyleague.com` covers `www48.myfantasyleague.com` and the bare
 * apex alike. Only the `**.` prefix is implemented, because that is the only
 * form the list uses; anything else is treated as an exact hostname rather
 * than silently matching more than it says.
 */
function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return REMOTE_MARK_HOSTS.some(({ hostname: pattern }) => {
    const p = pattern.toLowerCase();
    if (!p.startsWith('**.')) return host === p;
    const bare = p.slice(3);
    return host === bare || host.endsWith(`.${bare}`);
  });
}

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
 * ── A HOST THE OPTIMIZER WILL NOT SERVE KEEPS ITS ORIGINAL URL ────────────
 * Vercel answers a `url=` outside `remotePatterns` with a 400, not with the
 * image — so rewriting a host it does not allow does not merely lose the
 * optimization, it replaces a working mark with a broken one. That is not
 * hypothetical here: a franchise's `icon` is an arbitrary URL, and this repo's
 * own committed league exports carry marks on `theleague.us`, `mfl.football`,
 * `dynastytheleague.com`, `mfladdons.com`, `nbc.com` and `amtv.jp` — only
 * about 1 in 15 is on `*.myfantasyleague.com`. So the allowlist is checked
 * HERE too, against the same list the config enforces, and an unlisted host
 * is served as-is: unoptimized, and visible.
 *
 * Non-HTTP, relative and data URLs are returned untouched for the same
 * reason. A local `/assets/…` mark is same-origin and already the right size,
 * so there is nothing to optimize — and it is usually an SVG, which the
 * optimizer does not touch anyway.
 */
export function optimizedRemoteImage(url: string, width: number = REMOTE_MARK_WIDTH): string {
  if (!url || !url.startsWith('https://') || !onVercel()) return url;

  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return url;
    if (parsed.port && parsed.port !== '443') return url;
    if (!parsed.hostname.includes('.')) return url;
    // The 400-vs-broken-image case above: serve it straight rather than
    // through an optimizer that will refuse it.
    if (!hostAllowed(parsed.hostname)) return url;
  } catch {
    return url;
  }

  return `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}
