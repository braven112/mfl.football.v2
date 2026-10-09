/**
 * Visit beacon — one fire-and-forget POST to `/api/track-visit` per page view,
 * shared by every layout (league sites, MFL Live, the splash).
 *
 * Signed in it records last-seen, page popularity and the site-insights
 * dimensions; signed out the server keeps only bounded anonymous counts.
 *
 * LIFECYCLE. The module runs once per full document load. Under the
 * ClientRouter every navigation (the first one included) dispatches
 * `astro:page-load` on `document`, which survives swaps, so one listener
 * registered here covers them all. A layout WITHOUT the router (the splash)
 * never fires that event, so the beacon is sent directly instead.
 *
 * DEBOUNCE. A repeat of the SAME path within a minute (a reload, a double
 * render) is dropped. It used to be one beacon per minute per tab regardless
 * of path, which under-counted exactly the thing the page rankings measure:
 * an owner clicking through five pages in a minute registered one.
 */

const DEBOUNCE_KEY = 'mfl:lastTrackVisit';
const DEBOUNCE_MS = 60_000;
/** Set once per tab: the first beacon of a tab session carries its source. */
const LANDED_KEY = 'mfl:insightsLanded';
/** The tagged area of the last in-site link clicked, read by the next beacon. */
const VIA_KEY = 'mfl:insightsVia';
/** A click older than this is not what brought the visitor to this page. */
const VIA_MAX_AGE_MS = 30_000;

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * LINK AREAS. A click on a same-origin link inside an element carrying
 * `data-track-via` (the My Team card, the nav drawer, the quick links) is
 * remembered for the page it leads to; that page's beacon then reports
 * `via=<area>`. Nothing is sent on the click itself, so a link that never
 * arrives (a modifier-click into a new tab, a cancelled navigation) costs
 * nothing and counts nothing. The server accepts only its fixed list of
 * areas (`INSIGHT_LINK_AREAS`).
 *
 * Registered once, at module scope: `document` survives every ClientRouter
 * swap and this module runs once per document, so it never stacks.
 */
function rememberLinkArea(event: MouseEvent) {
	try {
		const target = event.target as Element | null;
		const link = target?.closest?.('a[href]') as HTMLAnchorElement | null;
		if (!link || link.origin !== location.origin) return;
		const area = (link.closest('[data-track-via]') as HTMLElement | null)?.dataset.trackVia;
		if (!area) return;
		sessionStorage.setItem(VIA_KEY, JSON.stringify({ a: area, p: trimSlash(link.pathname), t: Date.now() }));
	} catch (_) {}
}

/** The area that brought the visitor to THIS page, consumed on read. */
function takeLinkArea(): string | null {
	try {
		const raw = sessionStorage.getItem(VIA_KEY);
		if (!raw) return null;
		sessionStorage.removeItem(VIA_KEY);
		const via = JSON.parse(raw);
		if (Date.now() - Number(via?.t) > VIA_MAX_AGE_MS) return null;
		return via?.p === trimSlash(location.pathname) ? String(via.a || '') || null : null;
	} catch (_) {
		return null;
	}
}

/**
 * Installed app or browser tab? Only the CLIENT can answer this — both send
 * identical requests — so the beacon carries the answer.
 * `display-mode: standalone` covers Android/desktop installs and `minimal-ui`
 * an installed app whose manifest asks for it; `navigator.standalone` is iOS
 * Safari's older, non-standard flag, still the only signal for a home-screen
 * app there.
 *
 * `fullscreen` is deliberately NOT in that list even though a manifest can
 * request it: an ordinary tab pushed to fullscreen with F11 matches
 * `(display-mode: fullscreen)` too, so counting it would file every desktop
 * browser visitor as an app install. If the manifest ever moves to
 * fullscreen, gate that mode on something that separates the two rather than
 * adding it back here.
 */
function detectSurface(): 'pwa' | 'browser' {
	try {
		const installed = ['standalone', 'minimal-ui'].some(
			(mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
		);
		return installed || (navigator as any).standalone === true ? 'pwa' : 'browser';
	} catch (_) {
		return 'browser';
	}
}

/**
 * Coarse platform bucket. iPadOS reports itself as a Macintosh, so the
 * touch-point check is what keeps an installed iPad app out of the desktop
 * bucket.
 */
function detectPlatform(): string {
	try {
		const ua = navigator.userAgent || '';
		if (/android/i.test(ua)) return 'android';
		if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
		if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
		if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
		return 'other';
	} catch (_) {
		return 'other';
	}
}

/** Phone / tablet / desktop, from the pointer and the screen's short side. */
function detectDevice(): string {
	try {
		if (!window.matchMedia('(pointer: coarse)').matches) return 'desktop';
		return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet';
	} catch (_) {
		return 'desktop';
	}
}

/**
 * The landing half of the beacon: the referrer's HOST only (never the full
 * URL), and the `src` tag a notification click carries — which is then
 * stripped from the address bar so it is not copied into a shared link.
 */
function landingParams(): Record<string, string> | null {
	const url = new URL(location.href);
	const src = url.searchParams.get('src') || '';
	if (src) {
		url.searchParams.delete('src');
		try {
			history.replaceState(history.state, '', url.pathname + url.search + url.hash);
		} catch (_) {}
	}
	// A notification click is a landing even in a tab that is already open —
	// the service worker may navigate an existing tab rather than open one.
	// NOT counted: a click whose target a tab is ALREADY showing. The worker
	// only focuses that tab (no navigation, so no beacon), which undercounts
	// push arrivals slightly rather than reloading the page under the owner.
	let landed = false;
	try {
		landed = Boolean(sessionStorage.getItem(LANDED_KEY));
		sessionStorage.setItem(LANDED_KEY, '1');
	} catch (_) {
		return null;
	}
	if (landed && !src) return null;
	let ref = '';
	try {
		ref = !src && document.referrer ? new URL(document.referrer).hostname : '';
	} catch (_) {}
	return { landing: '1', ref, src };
}

function trackVisit() {
	try {
		const page = location.pathname.replace(/^\/theleague/, '') || '/';
		// Read (and clear) before the debounce, so a stale tag can never ride
		// a later beacon.
		const via = takeLinkArea();
		const last = JSON.parse(sessionStorage.getItem(DEBOUNCE_KEY) || 'null');
		if (last && last.p === page && Date.now() - Number(last.t) < DEBOUNCE_MS) return;
		sessionStorage.setItem(DEBOUNCE_KEY, JSON.stringify({ p: page, t: Date.now() }));
		// `league` names the league whose pages these are (TheLeagueLayout sets
		// it); the server validates it against the registry, and MFL Live's
		// `mfl` matches none, which is what files it under MFL Live.
		const league = document.documentElement.dataset.league || '';
		const params = new URLSearchParams({
			page,
			surface: detectSurface(),
			platform: detectPlatform(),
			device: detectDevice(),
			league,
			...(via ? { via } : {}),
			...(landingParams() ?? {}),
		});
		// The JSON body is load-bearing, not payload (the endpoint reads only
		// the query string). Astro's origin check 403s any POST that has NO
		// content-type unless its Origin header matches exactly, and a
		// body-less beacon has none — so every browser that omits or nulls
		// Origin had its visits silently thrown away (five AFL owners read as
		// "never visited" in Sep 2026). A JSON-typed body is exempt from that
		// check. Guard: tests/origin-check-content-type.test.ts.
		navigator.sendBeacon(
			`/api/track-visit?${params}`,
			new Blob(['{}'], { type: 'application/json' }),
		);
	} catch (_) {}
}

document.addEventListener('click', rememberLinkArea, { capture: true });

if (document.querySelector('[name="astro-view-transitions-enabled"]')) {
	document.addEventListener('astro:page-load', trackVisit);
} else {
	trackVisit();
}
