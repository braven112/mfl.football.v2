// Renders every MFL Football app icon and tile: the mark big with MFL.football
// small underneath, for the TV app (launcher icon, home-screen banners), the
// phone app (icon, adaptive icon) and the Play listing (icon, TV banner), plus
// the 1024x500 feature graphic (the full wordmark). Writes them in place.
// [INTER_BOLD=/path/Inter-Bold.otf] node android-tv/store/render-artwork.cjs [storeOutDir]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../..');
const OUT = process.argv[2] || __dirname;
const MARK = `<g fill="#f3f4f6"><rect x="9" y="12" width="12" height="42" rx="6"/><rect x="26" y="30" width="12" height="24" rx="6"/><rect x="43" y="12" width="12" height="42" rx="6"/></g><g fill="#ff4d61" stroke="#ff4d61"><g transform="translate(32 20) rotate(-15)"><path d="M-6.5 0Q0-5.4 6.5 0Q0 5.4-6.5 0Z" stroke-width="4.5" stroke-linejoin="round"/></g></g>`;
// Inter Bold draws the name. Point INTER_BOLD at the font file if it is not
// at the Debian/Ubuntu path (fonts-inter); without it the pill text would
// silently fall back to a serif, so fail instead.
const INTER_BOLD = process.env.INTER_BOLD || '/usr/share/fonts/opentype/inter/Inter-Bold.otf';
if (!fs.existsSync(INTER_BOLD)) {
  console.error(`Inter Bold not found at ${INTER_BOLD}. Install fonts-inter or set INTER_BOLD=/path/to/Inter-Bold.otf`);
  process.exit(1);
}
const font = '@font-face{font-family:IB;src:url(data:font/otf;base64,' + fs.readFileSync(INTER_BOLD).toString('base64') + ') format("opentype")}';
// The mark is the logo: drawn big, with MFL.football small underneath (the
// owner's call, Oct 2026: the name only until people know the mark). One
// layout for every square and wide surface, scaled by its box.
function lockup(w, h, markPx, textPx, gap, bg, label, inset) {
  const k = inset || 1; // shrink toward centre (adaptive icon safe zone)
  const text = label || 'MFL<b>.</b>football';
  return `<!doctype html><html><head><style>${font}html,body{margin:0}
  body{width:${w}px;height:${h}px;background:${bg};overflow:hidden}
  .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
   gap:${gap}px;transform:scale(${k});transform-origin:center}
  svg{width:${markPx}px;height:${markPx}px;display:block}
  .t{font:${textPx}px/1 IB;letter-spacing:${textPx * 0.04}px;color:#c9ced6;white-space:nowrap}.t b{color:#ff4d61}
  </style></head><body><div class="c"><svg viewBox="9 10 46 46">${MARK}</svg><div class="t">${text}</div></div></body></html>`;
}
const square = (size, bg, inset) => lockup(size, size, size * 0.586, size * 0.09, size * 0.066, bg, null, inset);
// Android TV banners are 16:9; the overlay's own tile names itself instead.
const wide = (w, h, label) => lockup(w, h, h * 0.556, h * 0.089, h * 0.061, '#05070b', label);
function feature() {
  const wm = fs.readFileSync(`${REPO}/public/assets/logos/mfl-football-wordmark-dark.svg`, 'utf8');
  return `<!doctype html><html><head><style>html,body{margin:0}body{width:1024px;height:500px;background:#05070b;display:flex;align-items:center;justify-content:center}
  .w{width:780px}.w svg{width:100%;height:auto;display:block}</style></head><body><div class="w">${wm}</div></body></html>`;
}
const RES = `${REPO}/android-tv/app/src/main/res`;
const MOBILE = `${REPO}/apps/mobile/assets`;
const jobs = [
  [`${OUT}/icon-512.png`, 512, 512, square(512, '#05070b')],
  [`${RES}/mipmap-xxxhdpi/ic_launcher.png`, 192, 192, square(192, '#05070b')],
  [`${OUT}/tv-banner-1280x720.png`, 1280, 720, wide(1280, 720)],
  [`${RES}/drawable-xhdpi/banner.png`, 320, 180, wide(320, 180)],
  [`${RES}/drawable-xhdpi/banner_overlay.png`, 320, 180, wide(320, 180, 'Score overlay')],
  [`${MOBILE}/icon.png`, 1024, 1024, square(1024, '#05070b')],
  [`${MOBILE}/adaptive-icon.png`, 1024, 1024, square(1024, 'transparent', 0.62)],
  [`${OUT}/feature-graphic-1024x500.png`, 1024, 500, feature()],
];
(async () => {
  const b = await chromium.launch();
  for (const [file, w, h, html] of jobs) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html, { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: file, omitBackground: html.includes('background:transparent') });
    await p.close();
  }
  await b.close();
})();
