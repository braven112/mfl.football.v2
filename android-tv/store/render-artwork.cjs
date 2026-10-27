// Renders the MFL Football store artwork: icons (the MFL.football mark with a
// FOOTBALL pill) and the 1024x500 feature graphic (the full wordmark).
// [INTER_BOLD=/path/Inter-Bold.otf] node android-tv/store/render-artwork.cjs [outDir]. Copy the icons to
// android-tv/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png and apps/mobile/assets/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../..');
const OUT = process.argv[2] || __dirname;
const MARK = `<g fill="#f3f4f6"><rect x="9" y="12" width="12" height="42" rx="6"/><rect x="26" y="30" width="12" height="24" rx="6"/><rect x="43" y="12" width="12" height="42" rx="6"/></g><g fill="#ff4d61" stroke="#ff4d61"><g transform="translate(32 20) rotate(-15)"><path d="M-6.5 0Q0-5.4 6.5 0Q0 5.4-6.5 0Z" stroke-width="4.5" stroke-linejoin="round"/></g></g>`;
// Inter Bold draws FOOTBALL. Point INTER_BOLD at the font file if it is not
// at the Debian/Ubuntu path (fonts-inter); without it the pill text would
// silently fall back to a serif, so fail instead.
const INTER_BOLD = process.env.INTER_BOLD || '/usr/share/fonts/opentype/inter/Inter-Bold.otf';
if (!fs.existsSync(INTER_BOLD)) {
  console.error(`Inter Bold not found at ${INTER_BOLD}. Install fonts-inter or set INTER_BOLD=/path/to/Inter-Bold.otf`);
  process.exit(1);
}
const font = '@font-face{font-family:IB;src:url(data:font/otf;base64,' + fs.readFileSync(INTER_BOLD).toString('base64') + ') format("opentype")}';
// Icon drawn on a 512 grid: mark where the old icon had it, FOOTBALL pill where LIVE was.
function icon(size, bg, transparent, inset) {
  const s = size / 512;
  const k = inset || 1; // shrink content toward centre (adaptive safe zone)
  return `<!doctype html><html><head><style>${font}html,body{margin:0}
  body{width:${size}px;height:${size}px;background:${transparent ? 'transparent' : bg};overflow:hidden}
  .c{position:absolute;inset:0;transform:scale(${k});transform-origin:center}
  svg{position:absolute;left:${106 * s}px;top:${48 * s}px;width:${64 * 4.67 * s}px;height:${64 * 4.67 * s}px}
  .pill{position:absolute;left:50%;top:${376 * s}px;height:${87 * s}px;transform:translateX(-50%);
   background:#e5322d;border-radius:${12 * s}px;padding:0 ${26 * s}px;display:flex;align-items:center;
   font:${46 * s}px/1 IB;letter-spacing:${2 * s}px;color:#fff;white-space:nowrap}
  </style></head><body><div class="c"><svg viewBox="0 0 64 64">${MARK}</svg><div class="pill">FOOTBALL</div></div></body></html>`;
}
function feature() {
  const wm = fs.readFileSync(`${REPO}/public/assets/logos/mfl-football-wordmark-dark.svg`, 'utf8');
  return `<!doctype html><html><head><style>html,body{margin:0}body{width:1024px;height:500px;background:#05070b;display:flex;align-items:center;justify-content:center}
  .w{width:780px}.w svg{width:100%;height:auto;display:block}</style></head><body><div class="w">${wm}</div></body></html>`;
}
const jobs = [
  ['tv-icon-512.png', 512, icon(512, '#05070b')],
  ['tv-ic_launcher-192.png', 192, icon(192, '#05070b')],
  ['mobile-icon-1024.png', 1024, icon(1024, '#05070b')],
  ['mobile-adaptive-icon-1024.png', 1024, icon(1024, '#05070b', true, 0.62)],
];
(async () => {
  const b = await chromium.launch();
  for (const [name, size, html] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(html, { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: `${OUT}/${name}`, omitBackground: name.includes('adaptive') });
    await p.close();
  }
  const p = await b.newPage({ viewport: { width: 1024, height: 500 } });
  await p.setContent(feature(), { waitUntil: 'load' });
  await p.screenshot({ path: `${OUT}/feature-graphic-1024x500.png` });
  await b.close();
})();
