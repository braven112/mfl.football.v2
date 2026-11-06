/**
 * Season video — the browser side shared by every page that plays a video:
 * the video maker (/champion-video) and the League History page it hands the
 * owner to (/history/espn/<id>).
 *
 * BROWSER ONLY (Image, FontFace, localStorage).
 *
 * The handoff (`saveLastVideo` / `readLastVideo`): the video is drawn in the
 * owner's own browser and never uploaded, so the History page plays it by
 * re-drawing it from what the maker last made, kept in localStorage. It is a
 * per-viewer convenience, never a record: storage may be blocked or full, and
 * every caller renders correctly without it (the History page then shows the
 * league's champions and an invitation to make a video).
 */
import type { DrawAssets, Img } from './draw';
import type { ChampionStyle, LastPlaceTheme, SeasonFacts, SeasonVideoKind, VideoLook } from './season';

export const loadImage = (src: string): Promise<Img | null> =>
	new Promise((resolve) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = src;
	});

/** Our own SVG, given a pixel size so every browser will draw it on a canvas. */
export async function loadSvg(url: string, width: number): Promise<Img | null> {
	try {
		const text = await (await fetch(url)).text();
		const vb = /viewBox="([\d.\s-]+)"/.exec(text)?.[1].trim().split(/\s+/).map(Number);
		const ratio = vb && vb[2] && vb[3] ? vb[3] / vb[2] : 1;
		const sized = text.replace('<svg ', `<svg width="${width}" height="${Math.round(width * ratio)}" `);
		return loadImage(URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' })));
	} catch {
		return null;
	}
}

let brand: Promise<[Img | null, Img | null, unknown]> | null = null;
/** The end card's mark and wordmark, and the video's condensed face. Loaded once per page. */
export function loadBrand() {
	brand ??= Promise.all([
		loadSvg('/assets/logos/mfl-football-mark-dark.svg', 640),
		loadSvg('/assets/logos/mfl-football-wordtype-dark.svg', 1520),
		new FontFace('SVCond', 'url(/assets/fonts/UFCSans-CondensedBold.woff2)', { weight: '700' })
			.load()
			.then((f) => (document.fonts as unknown as Set<FontFace>).add(f))
			.catch(() => undefined),
	]);
	return brand;
}

/** Everything a frame draws, for these facts. `cache` keeps opponent logos across calls. */
export async function loadAssets(facts: SeasonFacts, team: Img | null, cache: Map<string, Img>): Promise<DrawAssets> {
	const [mark, wordmark] = await loadBrand();
	const logos = [...facts.playoffs, facts.bestGame, facts.worstGame].map((g) => g?.oppLogo).filter((x): x is string => !!x);
	await Promise.all(
		logos.filter((l) => !cache.has(l)).map(async (l) => {
			const img = await loadImage(l);
			if (img) cache.set(l, img);
		}),
	);
	return { team, opponents: cache, mark, wordmark };
}

// ── handoff to League History ─────────────────────────────────────────────

export type VideoSource = 'mfl' | 'espn' | 'sleeper' | 'manual';

export interface LastVideo {
	source: VideoSource;
	/** The league on its own platform, when the season came from one. */
	leagueId: string | null;
	facts: SeasonFacts;
	kind: SeasonVideoKind;
	look?: VideoLook;
	/** The weekly roast's week. */
	week?: number;
	/** Saved before looks were split from stories; read through `lookOf`. */
	theme?: LastPlaceTheme;
	style?: ChampionStyle;
	music: string;
	madeAt: string;
}

const LAST_KEY = 'seasonVideo.last';

/** Keep the video just made, for the History page. Drops opponent logos, then gives up, if storage is full. */
export function saveLastVideo(v: LastVideo): void {
	const slim: LastVideo = {
		...v,
		facts: {
			...v.facts,
			playoffs: v.facts.playoffs.map((g) => ({ ...g, oppLogo: null })),
			bestGame: v.facts.bestGame ? { ...v.facts.bestGame, oppLogo: null } : null,
			worstGame: v.facts.worstGame ? { ...v.facts.worstGame, oppLogo: null } : null,
		},
	};
	for (const attempt of [v, slim]) {
		try {
			localStorage.setItem(LAST_KEY, JSON.stringify(attempt));
			return;
		} catch {
			/* full or blocked: try smaller, then give up */
		}
	}
}

/** The last video made in this browser, if it was this league's. */
export function readLastVideo(source: VideoSource, leagueId: string): LastVideo | null {
	try {
		const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastVideo | null;
		return v && v.source === source && v.leagueId === leagueId && v.facts?.teamName ? v : null;
	} catch {
		return null;
	}
}

/** Where a league's History page lives, for the sources that have one. */
export function historyPath(source: VideoSource, leagueId: string | null): string | null {
	if (!leagueId || !/^\d{1,25}$/.test(leagueId)) return null;
	if (source === 'mfl') return `/history/mfl/${leagueId}`;
	if (source === 'espn') return `/history/espn/${leagueId}`;
	return null;
}
