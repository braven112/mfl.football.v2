/**
 * The arithmetic behind the free logo resizer (`LogoResizer.astro`). Pure, so
 * the tests can pin it; the component's script does the canvas drawing.
 *
 * Nothing here stretches a logo: every fit keeps the source's shape and pads
 * the rest of the box (transparent, or the chosen color).
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Fit a `srcW × srcH` image inside a `boxW × boxH` box without cropping or
 * stretching, centered. `inset` is a margin on every side, in box pixels.
 */
export function containRect(srcW: number, srcH: number, boxW: number, boxH: number, inset = 0): Rect {
	const availW = Math.max(1, boxW - inset * 2);
	const availH = Math.max(1, boxH - inset * 2);
	const scale = Math.min(availW / srcW, availH / srcH);
	const w = Math.max(1, Math.round(srcW * scale));
	const h = Math.max(1, Math.round(srcH * scale));
	return { x: Math.round((boxW - w) / 2), y: Math.round((boxH - h) / 2), w, h };
}

/**
 * The sizes to draw through on the way down from `from` to `to`, halving each
 * time, ending exactly on `to`. One big jump (1024 → 16) samples so few
 * pixels that thin lines break up; halving keeps small icons crisp. Going up,
 * or a step of less than half, is a single draw.
 */
export function downscaleSteps(fromW: number, fromH: number, toW: number, toH: number): Array<[number, number]> {
	const steps: Array<[number, number]> = [];
	let w = fromW;
	let h = fromH;
	while (w / 2 >= toW && h / 2 >= toH) {
		w = Math.round(w / 2);
		h = Math.round(h / 2);
		if (w === toW && h === toH) break;
		steps.push([w, h]);
	}
	steps.push([toW, toH]);
	return steps;
}

export interface BannerLayout {
	logo: Rect;
	/** Where the team name goes, or null when there is none. */
	text: { x: number; y: number; maxWidth: number; fontSize: number } | null;
}

/**
 * A wide banner: the logo at 80% of the band's height. With no team name it is
 * centered; with one, the logo sits left and the name fills the space to its
 * right (the MFL banner: crest on the left, name beside it).
 */
export function bannerLayout(srcW: number, srcH: number, boxW: number, boxH: number, hasName: boolean): BannerLayout {
	const pad = Math.round(boxH * 0.1);
	if (!hasName) return { logo: containRect(srcW, srcH, boxW, boxH, pad), text: null };
	const side = boxH - pad * 2;
	const fit = containRect(srcW, srcH, side, side);
	const logo = { x: pad + fit.x, y: pad + fit.y, w: fit.w, h: fit.h };
	const textX = pad + side + pad;
	return {
		logo,
		text: { x: textX, y: Math.round(boxH / 2), maxWidth: Math.max(1, boxW - textX - pad), fontSize: Math.round(boxH * 0.42) },
	};
}

/** Notes on the uploaded image. Each is a warning, never a block: the files still get made. */
export function inputWarnings(w: number, h: number): string[] {
	const out: string[] = [];
	if (Math.min(w, h) < 512) {
		out.push(`Your image is ${w} × ${h}. Bigger sizes will look soft; 1024 × 1024 is best.`);
	}
	if (w !== h) {
		out.push(`Your image isn’t square (${w} × ${h}). Each square file fits the whole logo inside and fills the sides, so nothing is cut off or stretched.`);
	}
	return out;
}

/** Black or white, whichever reads better on `hex` (relative luminance, WCAG). */
export function inkFor(hex: string): '#000000' | '#ffffff' {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return '#000000';
	const n = parseInt(m[1], 16);
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
	// Contrast with black is (l + 0.05) / 0.05; with white, 1.05 / (l + 0.05).
	return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

/** `name.png` / `name.jpg`. */
export function outputFileName(file: string, format: 'png' | 'jpg'): string {
	return `${file}.${format}`;
}
