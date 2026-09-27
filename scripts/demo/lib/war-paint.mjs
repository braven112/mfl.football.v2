/**
 * The demo leagues' shared mark: the war-paint pig (owner-supplied art,
 * 2026-09-27), recoloured per league so it matches the league it sits in.
 *
 * Three colours are the league's; the pig itself (pinks, white, the grey
 * facemask) never changes:
 *   - `ink`    — the disc and every outline (the league's deep colour)
 *   - `helmet` — the helmet shell (the league's accent), shaded from it
 *   - `rim`    — dark cut only: a light ring, so a dark disc still reads on a
 *                dark card. The light cut has none (the disc is its own edge).
 *
 * The site swaps the two cuts by CSS (`-logo.svg` / `-logo-dark.svg`), so both
 * are written for every league slot.
 */

/** Each demo league slot's palette, from its tokens.css / tokens-dark.css. */
export const WAR_PAINT_PALETTES = {
  // TheLeague blue (tokens.css --color-primary; dark --color-primary)
  theleague: { ink: '#0f2a47', helmet: '#1c497c', helmetDark: '#3b82f6' },
  // The AFL slot + keeper: --afl-navy, --league-accent red
  afl: { ink: '#0f1e2e', helmet: '#c41e3a', helmetDark: '#ef5350' },
  // Best ball: --bb-green, --league-accent emerald
  bestball: { ink: '#0b3d2e', helmet: '#0e8a5f', helmetDark: '#34d399' },
};

/** Darken a #rrggbb toward black by `amount` (0–1): the helmet's shaded side. */
function shade(hex, amount = 0.22) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function warPaintSvg(palette, { dark = false, label = 'League logo' } = {}) {
  const ink = palette.ink;
  const helmet = dark ? palette.helmetDark : palette.helmet;
  const helmetShade = shade(helmet);
  const disc = dark
    ? `<circle cx="250" cy="250" r="232" style="fill:${ink};stroke:#f5f5f5;stroke-width:12"/>`
    : `<circle cx="250" cy="250" r="236" style="fill:${ink}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="256" height="256" role="img" aria-label="${escapeXml(label)}">
${disc}
<g transform="translate(250 256) scale(1.1) translate(-250 -262)">
<g style="fill:#ffffff;stroke:#ffffff;stroke-width:24;stroke-linejoin:round">
<path d="M 172 206 C 150 184 132 162 120 140 L 146 100 C 170 110 190 124 206 144 Z">
</path>
<path d="M 146 100 C 116 108 92 132 78 168 C 96 160 110 152 122 142 Z">
</path>
<path d="M 328 206 C 350 184 368 162 380 140 L 354 100 C 330 110 310 124 294 144 Z">
</path>
<path d="M 354 100 C 384 108 408 132 422 168 C 404 160 390 152 378 142 Z">
</path>
<path d="M 126 300 C 110 185 170 98 250 98 C 330 98 390 185 374 300 L 368 382 C 366 398 352 404 336 398 L 164 398 C 148 404 134 398 132 382 Z">
</path>
<path d="M 166 234 C 200 236 232 250 250 260 C 268 250 300 236 334 234 C 342 282 352 330 346 362 C 340 402 300 422 250 422 C 200 422 160 402 154 362 C 148 330 156 282 166 234 Z">
</path>
<path d="M 150 394 Q 250 448 350 394">
</path>
</g>
<path d="M 172 206 C 150 184 132 162 120 140 L 146 100 C 170 110 190 124 206 144 Z" style="fill:#f6b3c0;stroke:${ink};stroke-width:9;stroke-linejoin:round">
</path>
<path d="M 172 190 C 156 172 142 156 132 140 L 150 114 C 168 122 184 134 196 150 Z" style="fill:#e27790">
</path>
<path d="M 146 100 C 116 108 92 132 78 168 C 96 160 110 152 122 142 Z" style="fill:#f6b3c0;stroke:${ink};stroke-width:8;stroke-linejoin:round">
</path>
<path d="M 128 128 C 112 138 100 150 92 160" style="fill:none;stroke:#e897a8;stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 328 206 C 350 184 368 162 380 140 L 354 100 C 330 110 310 124 294 144 Z" style="fill:#f6b3c0;stroke:${ink};stroke-width:9;stroke-linejoin:round">
</path>
<path d="M 328 190 C 344 172 358 156 368 140 L 350 114 C 332 122 316 134 304 150 Z" style="fill:#e27790">
</path>
<path d="M 354 100 C 384 108 408 132 422 168 C 404 160 390 152 378 142 Z" style="fill:#f6b3c0;stroke:${ink};stroke-width:8;stroke-linejoin:round">
</path>
<path d="M 372 128 C 388 138 400 150 408 160" style="fill:none;stroke:#e897a8;stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 126 300 C 110 185 170 98 250 98 C 330 98 390 185 374 300 L 368 382 C 366 398 352 404 336 398 L 164 398 C 148 404 134 398 132 382 Z" style="fill:${helmet}">
</path>
<path d="M 374 300 C 390 185 330 98 250 98 C 318 112 358 182 350 300 L 346 390 L 368 382 Z" style="fill:${helmetShade}">
</path>
<path d="M 224 262 C 222 186 228 128 236 100 L 264 100 C 272 128 278 186 276 262 Z" style="fill:#ffffff">
</path>
<path d="M 234 262 C 233 188 238 130 243 100 L 257 100 C 262 130 267 188 266 262 Z" style="fill:${ink}">
</path>
<path d="M 160 215 C 160 165 190 125 226 110 C 204 136 188 170 182 214 Z" style="fill:#ffffff;opacity:.3">
</path>
<path d="M 172 150 L 188 166 L 180 180 L 198 198" style="fill:none;stroke:${ink};stroke-width:5;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 126 300 C 110 185 170 98 250 98 C 330 98 390 185 374 300 L 368 382 C 366 398 352 404 336 398 L 164 398 C 148 404 134 398 132 382 Z" style="fill:none;stroke:${ink};stroke-width:9;stroke-linejoin:round">
</path>
<path d="M 166 234 C 200 236 232 250 250 260 C 268 250 300 236 334 234 C 342 282 352 330 346 362 C 340 402 300 422 250 422 C 200 422 160 402 154 362 C 148 330 156 282 166 234 Z" style="fill:#f6b3c0;stroke:${ink};stroke-width:9;stroke-linejoin:round">
</path>
<path d="M 168 242 C 200 244 232 258 250 268 C 268 258 300 244 332 242 L 332 252 C 300 254 268 268 250 278 C 232 268 200 254 168 252 Z" style="fill:#e897a8">
</path>
<ellipse cx="182" cy="342" rx="16" ry="10" style="fill:#ec8fa2">
</ellipse>
<ellipse cx="318" cy="342" rx="16" ry="10" style="fill:#ec8fa2">
</ellipse>
<path d="M 178 268 L 230 288 C 226 302 190 304 180 282 Z" style="fill:#ffffff;stroke:${ink};stroke-width:6;stroke-linejoin:round">
</path>
<path d="M 322 268 L 270 288 C 274 302 310 304 320 282 Z" style="fill:#ffffff;stroke:${ink};stroke-width:6;stroke-linejoin:round">
</path>
<circle cx="214" cy="289" r="6.5" style="fill:${ink}">
</circle>
<circle cx="286" cy="289" r="6.5" style="fill:${ink}">
</circle>
<circle cx="216" cy="287" r="2" style="fill:#fff">
</circle>
<circle cx="288" cy="287" r="2" style="fill:#fff">
</circle>
<path d="M 170 261 L 236 290" style="fill:none;stroke:${ink};stroke-width:12;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 330 261 L 264 290" style="fill:none;stroke:${ink};stroke-width:12;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 242 276 Q 250 270 258 276" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 244 286 Q 250 281 256 286" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 180 306 L 193 306 L 185 330 L 173 326 Z" style="fill:${ink}">
</path>
<path d="M 198 306 L 211 306 L 203 332 L 191 330 Z" style="fill:${ink}">
</path>
<path d="M 320 306 L 307 306 L 315 330 L 327 326 Z" style="fill:${ink}">
</path>
<path d="M 302 306 L 289 306 L 297 332 L 309 330 Z" style="fill:${ink}">
</path>
<path d="M 204 368 C 230 362 270 362 296 368 L 292 398 C 270 404 230 404 208 398 Z" style="fill:#fff">
</path>
<path d="M 224 364 L 224 404" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 237 364 L 237 404" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 250 364 L 250 404" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 263 364 L 263 404" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 276 364 L 276 404" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 207 383 Q 250 387 293 383" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 204 368 C 230 362 270 362 296 368 L 292 398 C 270 404 230 404 208 398 Z" style="fill:none;stroke:${ink};stroke-width:6;stroke-linejoin:round">
</path>
<g style="fill:none;stroke:${ink};stroke-width:18;stroke-linecap:round;stroke-linejoin:round">
<path d="M 138 304 Q 250 328 362 304">
</path>
<path d="M 198 312 L 204 408">
</path>
<path d="M 302 312 L 296 408">
</path>
<path d="M 150 394 Q 250 448 350 394">
</path>
</g>
<g style="fill:none;stroke:#b0b7bc;stroke-width:9;stroke-linecap:round;stroke-linejoin:round">
<path d="M 138 304 Q 250 328 362 304">
</path>
<path d="M 198 312 L 204 408">
</path>
<path d="M 302 312 L 296 408">
</path>
<path d="M 150 394 Q 250 448 350 394">
</path>
</g>
<ellipse cx="250" cy="332" rx="50" ry="34" style="fill:#ec8fa2;stroke:${ink};stroke-width:9">
</ellipse>
<ellipse cx="231" cy="334" rx="9" ry="13" style="fill:${ink}">
</ellipse>
<ellipse cx="269" cy="334" rx="9" ry="13" style="fill:${ink}">
</ellipse>
<path d="M 232 306 Q 250 301 268 306" style="fill:none;stroke:${ink};stroke-width:4;stroke-linecap:round;stroke-linejoin:round">
</path>
<path d="M 214 324 Q 220 312 234 308" style="fill:none;stroke:#ffffff;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;opacity:.7">
</path>
</g>
</svg>
`;
}

/** Light + dark cuts for one logo slot: [[fileBase, svg], [fileBase-dark, svg]]. */
export function warPaintFiles(fileBase, palette, label) {
  return [
    [`assets/logos/${fileBase}.svg`, warPaintSvg(palette, { label })],
    [`assets/logos/${fileBase}-dark.svg`, warPaintSvg(palette, { dark: true, label })],
  ];
}
