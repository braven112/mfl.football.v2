/**
 * Turn a finished logo PNG into an SVG: Owner Suite Pro's logo tracer
 * (`/api/mfl-live/logo-trace`, offered on `/live/team-logo`).
 *
 * The owner makes the picture in ChatGPT or Gemini from our prompt; this
 * traces it into vector shapes so it scales to any size. We make no images
 * ourselves (Brandon, 2026-10-27), and asking an LLM to DRAW an SVG was
 * dropped as looking terrible (2026-10-29), so tracing the AI tool's own
 * output is the vector path.
 *
 * The tracer is vtracer (`@neplex/vectorizer`, a native build that runs in the
 * server function). Settings were tuned on real logos made from our prompt:
 * fewer, cleaner color layers and smooth splines, so a mascot comes back as
 * about 100 shapes rather than thousands of specks. In-browser wasm builds of
 * vtracer were tried first and drew a dark ground and broken stacking.
 */

/**
 * Why a fantasy owner would want the SVG, in plain words: shown under the
 * tracer and on the public logo maker (Brandon, 2026-10-29). A PNG is a grid
 * of dots that blurs when blown up; an SVG is shapes that redraw sharp at any
 * size, which is what print shops, engravers and cutters work from.
 */
export const SVG_USES: Array<{ title: string; text: string }> = [
	{ title: 'Shirts and jerseys', text: 'Print shops ask for a vector file. An SVG prints crisp on a shirt, hat or jersey.' },
	{ title: 'Banners and signs', text: 'Blow it up to poster or draft-party banner size with no blurry, blocky edges.' },
	{ title: 'Trophies, mugs and stickers', text: 'Engravers and sticker makers cut along the shapes in an SVG, which a PNG doesn’t have.' },
	{ title: 'Websites', text: 'One small file looks sharp on any screen, from a tiny team icon to a full-screen header.' },
	{ title: 'Color changes', text: 'Each color is its own shape, so a designer can swap one in seconds without redrawing anything.' },
];

/** Largest upload, under Vercel's 4.5 MB request body limit. */
export const LOGO_TRACE_MAX_BYTES = 4 * 1024 * 1024;
/** Largest side we trace; AI tools hand back 1024 to 2048. */
export const LOGO_TRACE_MAX_SIDE = 2048;
/** Traces per owner per hour. A trace is about a second of CPU. */
export const LOGO_TRACE_PER_HOUR = 20;

/**
 * Alpha at or above this is solid; below, gone. AI tools feather a logo's
 * edge into the transparent ground, and the tracer turns that half-clear
 * ring into a gray halo around the whole mark.
 */
const ALPHA_SOLID = 160;

export type LogoTraceError = 'too-large' | 'not-an-image' | 'too-many-pixels';

/** PNG, JPEG or WebP, by their first bytes. */
export function looksLikeImage(bytes: Uint8Array): boolean {
	const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
	const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	const webp =
		bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
		bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
	return png || jpeg || webp;
}

/** Every pixel fully solid or fully clear, in place. */
export function snapAlpha(rgba: Uint8Array): void {
	for (let i = 3; i < rgba.length; i += 4) rgba[i] = rgba[i] >= ALPHA_SOLID ? 255 : 0;
}

/**
 * vtracer writes a fixed `width`/`height` and no `viewBox`, so the file
 * cannot be scaled by CSS or a design tool. Add one matching its size.
 */
export function withViewBox(svg: string): string {
	if (/<svg[^>]*\sviewBox=/.test(svg)) return svg;
	return svg.replace(/<svg([^>]*?)\swidth="(\d+(?:\.\d+)?)"\s+height="(\d+(?:\.\d+)?)"/, (_m, before, w, h) => `<svg${before} viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"`);
}

/** The traced SVG, or why the upload could not be traced. */
export async function traceLogo(bytes: Uint8Array): Promise<{ ok: true; svg: string } | { ok: false; error: LogoTraceError }> {
	if (bytes.length > LOGO_TRACE_MAX_BYTES) return { ok: false, error: 'too-large' };
	if (!looksLikeImage(bytes)) return { ok: false, error: 'not-an-image' };

	// Loaded on first use, so the native module only starts in the one
	// function that traces.
	const { readImage, vectorizeRaw, optimize, ColorMode, Hierarchical, PathSimplifyMode } = await import('@neplex/vectorizer');

	let image: { width: number; height: number; pixels: Buffer };
	try {
		image = await readImage(Buffer.from(bytes));
	} catch {
		return { ok: false, error: 'not-an-image' };
	}
	if (image.width > LOGO_TRACE_MAX_SIDE || image.height > LOGO_TRACE_MAX_SIDE) return { ok: false, error: 'too-many-pixels' };

	snapAlpha(image.pixels);
	const raw = await vectorizeRaw(image.pixels, { width: image.width, height: image.height }, {
		colorMode: ColorMode.Color,
		colorPrecision: 5,
		filterSpeckle: 10,
		layerDifference: 32,
		cornerThreshold: 60,
		lengthThreshold: 6,
		spliceThreshold: 45,
		maxIterations: 10,
		pathPrecision: 2,
		hierarchical: Hierarchical.Stacked,
		mode: PathSimplifyMode.Spline,
	});
	return { ok: true, svg: withViewBox(await optimize(raw, {})) };
}
