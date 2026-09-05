/**
 * Dark-mode NFL logo swap — CSS generator validation.
 *
 * Locks in the contract of src/utils/nfl-logo-dark-css.ts:
 * - every canonical NFL team gets an `html.dark` swap to a dark logo variant,
 * - both ESPN 500 PNGs and local SVGs (canonical + legacy alias filenames) are
 *   keyed, so non-normalized roster srcs like WAS.svg / LVR.svg are covered,
 * - the dark variant never appears as a match key (no self-referential swap),
 * - the dark URL is self-hosted (/assets/nfl-logos/dark/) for teams listed in
 *   the prebuild manifest and falls back to ESPN's 500-dark CDN cut otherwise
 *   — a swap target must never point at a local file the build doesn't have,
 *   because `content: url(...)` renders a broken-image icon on load failure
 *   (the Aug 2026 AFL players-page bug this system now guards against).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  buildNflLogoDarkCss,
  resolveNflDarkLogoUrl,
  NFL_DARK_STROKE_CODES,
  NFL_DARK_STROKE_WIDTH,
} from '../src/utils/nfl-logo-dark-css';
import { crestStrokeFilter } from '../src/utils/crest-dark-stroke-css';
import { getNFLTeamLogo as getNFLTeamLogoLegacy } from '../src/utils/nfl';
import { getAllNFLTeamCodes, getNFLTeamLogo, normalizeTeamCode, TEAM_CODE_MAP } from '../src/utils/nfl-logo';
import { getNflLogoUrl } from '../src/constants/roster-constants';
import { NFL_TEAM_CODES } from '../scripts/fetch-nfl-dark-logos.mjs';
import darkLogoManifest from '../src/data/nfl-dark-logos-manifest.json';

describe('buildNflLogoDarkCss', () => {
  const css = buildNflLogoDarkCss();
  const lines = css.split('\n');

  it('emits ESPN + local-svg rules (canonical teams and legacy aliases), all html.dark', () => {
    const canonical = getAllNFLTeamCodes();
    // 1 ESPN rule per canonical team, plus 1 local-svg rule for every canonical
    // code and every non-shield alias filename.
    const localCodes = new Set([...canonical, ...Object.keys(TEAM_CODE_MAP)]);
    const localRules = [...localCodes].filter((c) => {
      const n = normalizeTeamCode(c);
      return n && n !== 'NFL';
    }).length;
    // ...plus the two white-ring rules for NFL_DARK_STROKE_CODES (html.dark
    // on the light srcs; theme-independent on the dark cut's own srcs) and
    // the two failed-logo rules (base hide + dark un-hide for swapped srcs)
    // appended at the end.
    expect(lines).toHaveLength(canonical.length + localRules + 4);
    const swapLines = lines.filter((l) => !l.includes('nfl-logo-failed') && !l.includes('filter:'));
    expect(swapLines).toHaveLength(canonical.length + localRules);
    for (const line of swapLines) {
      expect(line.startsWith('html.dark img[src="')).toBe(true);
    }
  });

  it('hides failed logos, un-hiding them in dark mode only where a swap provides pixels', () => {
    // NFL_LOGO_ONERROR tags a failed img with .nfl-logo-failed; the base rule
    // hides it in either theme...
    expect(css).toContain('img.nfl-logo-failed { visibility: hidden; }');
    // ...and the dark-mode un-hide is scoped to exactly the srcs that have a
    // content:url() swap rule (their pixels don't depend on the failed light
    // src). Shield srcs (NFL.svg) have no swap, so they must NOT appear.
    const unhide = css.split('\n').find((l) => l.includes(':is('));
    expect(unhide).toBeDefined();
    expect(unhide).toContain('html.dark img.nfl-logo-failed:is(');
    expect(unhide).toContain('[src="/assets/nfl-logos/SF.svg"]');
    expect(unhide).toContain(`[src="${getNFLTeamLogo('DAL')}"]`);
    expect(unhide).not.toContain('NFL.svg');
    expect(unhide?.endsWith('{ visibility: visible; }')).toBe(true);
  });

  it('swaps the ESPN light logo to the resolved dark variant', () => {
    const light = getNFLTeamLogo('DAL'); // .../500/DAL.png
    const dark = resolveNflDarkLogoUrl('DAL');
    expect(css).toContain(`html.dark img[src="${light}"] { content: url("${dark}"); }`);
  });

  it('swaps the canonical local NFL SVG to the resolved dark variant too', () => {
    const svg = getNflLogoUrl('SF'); // /assets/nfl-logos/SF.svg
    expect(css).toContain(`html.dark img[src="${svg}"] { content: url("${resolveNflDarkLogoUrl('SF')}"); }`);
  });

  it('covers legacy alias SVG filenames the rosters page renders (WAS, LVR)', () => {
    // rosters.astro normalizes Washington to WAS (not WSH) and hardcodes
    // /assets/nfl-logos/LVR.svg — both must map to the canonical dark logo.
    expect(css).toContain(
      `html.dark img[src="/assets/nfl-logos/WAS.svg"] { content: url("${resolveNflDarkLogoUrl('WSH')}"); }`,
    );
    expect(css).toContain(
      `html.dark img[src="/assets/nfl-logos/LVR.svg"] { content: url("${resolveNflDarkLogoUrl('LV')}"); }`,
    );
  });

  it('skips shield aliases (FA/UFA → NFL) — no dark shield to swap to', () => {
    expect(css).not.toContain('/assets/nfl-logos/FA.svg');
    expect(css).not.toContain('/assets/nfl-logos/UFA.svg');
  });

  it('never keys a SWAP on a dark-variant src (no self-referential swap)', () => {
    // Scans EVERY line: a rule keyed on a dark src is only ever allowed to be
    // the theme-independent stroke (`filter:`, never `content:`) — see the
    // NFL_DARK_STROKE_CODES block below. Any other rule type that turns up
    // keyed on a dark src is the self-referential bug this guard exists for.
    for (const line of lines) {
      const srcs = [...line.matchAll(/img\[src="([^"]+)"\]/g)].map((m) => m[1]);
      const onDarkSrc = srcs.some((s) => s.includes('500-dark') || s.includes('/assets/nfl-logos/dark/'));
      if (!onDarkSrc) continue;
      expect(line, `dark-src-keyed rule must be a filter, not a swap: ${line.slice(0, 120)}`).toContain('filter:');
      expect(line).not.toContain('content:');
    }
  });

  it('covers every canonical team code', () => {
    for (const code of getAllNFLTeamCodes()) {
      expect(css).toContain(resolveNflDarkLogoUrl(code));
    }
  });
});

describe('white ring for dark-bodied marks (NFL_DARK_STROKE_CODES)', () => {
  const css = buildNflLogoDarkCss();
  const filterLines = css.split('\n').filter((l) => l.includes('filter:'));
  const strokeLine = filterLines.find((l) => l.includes('html.dark '));
  const darkSrcStrokeLine = filterLines.find((l) => !l.includes('html.dark '));

  it('emits one html.dark filter rule using the shared crest ring', () => {
    // The Panthers' dark cut is a black body with a hairline blue edge — the
    // swap alone leaves a smudge on the dark card. The ring must be the SAME
    // drop-shadow stack the league crests use, so an NFL logo and an AFL
    // crest on one card wear one edge.
    expect(NFL_DARK_STROKE_CODES).toContain('CAR');
    expect(filterLines).toHaveLength(2);
    expect(strokeLine).toBeDefined();
    // Same STACK as the crests, wider than their 0.5px hairline — a 16px
    // panther is a solid silhouette with no bright interior to help it.
    expect(NFL_DARK_STROKE_WIDTH).toBe('1px');
    expect(strokeLine).toContain(`{ filter: ${crestStrokeFilter(undefined, NFL_DARK_STROKE_WIDTH)}; }`);
    expect(strokeLine).toContain('drop-shadow(1px 0 0 ');
    expect(strokeLine).not.toContain('0.5px');
    expect(strokeLine!.startsWith(':where(html.dark img[src="')).toBe(true);
  });

  it('carries zero specificity so a surface\'s own filter wins (the Free Agents watermark)', () => {
    // `filter` is not additive across rules. The Free Agents hero renders the
    // top FA's logo as a 16%-opacity `.hero-spotlight__logo` watermark with
    // `filter: grayscale(.1)` (a (0,1,0) class selector); a bare
    // `html.dark img[src=…]` rule is (0,2,2) and would replace that with
    // white halos. Wrapping the whole selector list in `:where()` zeroes it,
    // so any class-level filter on the same img beats the default ring.
    for (const line of filterLines) {
      expect(line.startsWith(':where(')).toBe(true);
      expect(line).toMatch(/^:where\([^{]+\) \{ filter: /);
    }
  });

  it('reaches the Sunday Ticket multi-view, which builds its dark src through the OTHER getNFLTeamLogo', () => {
    // src/utils/nfl.ts carries a duplicate getNFLTeamLogo that
    // SundayTicketMultiView.astro uses. The theme-independent ring is keyed on
    // nfl-logo.ts's output, so the two must agree byte-for-byte or that
    // surface silently loses the ring.
    for (const code of NFL_DARK_STROKE_CODES) {
      expect(getNFLTeamLogoLegacy(code, 'dark')).toBe(getNFLTeamLogo(code, 'dark'));
      expect(darkSrcStrokeLine).toContain(`[src="${getNFLTeamLogoLegacy(code, 'dark')}"]`);
    }
  });

  it('keys the ring on every light src the swap keys on: ESPN 500, canonical SVG, legacy aliases', () => {
    for (const code of NFL_DARK_STROKE_CODES) {
      expect(strokeLine).toContain(`[src="${getNFLTeamLogo(code)}"]`);
      expect(strokeLine).toContain(`[src="/assets/nfl-logos/${code}.svg"]`);
      for (const [alias, canonical] of Object.entries(TEAM_CODE_MAP)) {
        if (canonical === code && alias !== code) {
          expect(strokeLine).toContain(`[src="/assets/nfl-logos/${alias}.svg"]`);
        }
      }
    }
    // Never keyed on the dark variant (the swap target), never on other teams.
    expect(strokeLine).not.toContain('500-dark');
    expect(strokeLine).not.toContain('/assets/nfl-logos/dark/');
    expect(strokeLine).not.toContain('/DAL.');
    expect(strokeLine).not.toContain('/LV.');
  });

  it('also rings the dark cut itself, theme-independently, for both-themes-dark surfaces', () => {
    // The draft broadcast board/reveal card and the Sunday Ticket multi-view
    // are dark in BOTH themes and ship the dark cut as `src` directly, so an
    // `html.dark` rule never reaches a light-theme viewer there. An img whose
    // src IS the dark cut is on a dark surface by construction — ring it with
    // no theme guard, keyed on the ESPN URL and the self-hosted mirror path.
    expect(darkSrcStrokeLine).toBeDefined();
    expect(darkSrcStrokeLine!.startsWith(':where(img[src="')).toBe(true);
    expect(darkSrcStrokeLine).not.toContain('html.dark');
    expect(darkSrcStrokeLine).not.toContain('content:');
    for (const code of NFL_DARK_STROKE_CODES) {
      expect(darkSrcStrokeLine).toContain(`[src="${getNFLTeamLogo(code, 'dark')}"]`);
      expect(darkSrcStrokeLine).toContain(`[src="/assets/nfl-logos/dark/${code}.png"]`);
    }
    expect(darkSrcStrokeLine).toContain(`{ filter: ${crestStrokeFilter(undefined, NFL_DARK_STROKE_WIDTH)}; }`);
    expect(darkSrcStrokeLine).not.toContain('/DAL.');
  });

  it('composes with the swap rather than replacing it — the dark cut still ships underneath', () => {
    for (const code of NFL_DARK_STROKE_CODES) {
      expect(css).toContain(
        `html.dark img[src="${getNFLTeamLogo(code)}"] { content: url("${resolveNflDarkLogoUrl(code)}"); }`,
      );
    }
  });

  it('only lists canonical team codes', () => {
    const canonical = new Set(getAllNFLTeamCodes());
    for (const code of NFL_DARK_STROKE_CODES) expect(canonical.has(code)).toBe(true);
  });
});

describe('resolveNflDarkLogoUrl', () => {
  it('serves the self-hosted mirror for manifest-listed teams', () => {
    expect(resolveNflDarkLogoUrl('DEN', ['DEN', 'GB'])).toBe('/assets/nfl-logos/dark/DEN.png');
  });

  it('falls back to the ESPN 500-dark URL for teams the build could not fetch', () => {
    expect(resolveNflDarkLogoUrl('DEN', [])).toBe(getNFLTeamLogo('DEN', 'dark'));
  });

  it('returns null (emit no rule) for teams in a curated known-missing list', () => {
    // A permanently missing dark cut means a swap rule would point at a 404
    // and render a broken icon on every connection — the builder must skip
    // the rule and keep the light logo in dark mode. (All 32 NFL cuts exist
    // today, so the production list is empty; the mechanism is exercised via
    // the injectable parameter.)
    expect(resolveNflDarkLogoUrl('DEN', [], ['DEN'])).toBeNull();
    // On-disk presence wins over the missing list.
    expect(resolveNflDarkLogoUrl('DEN', ['DEN'], ['DEN'])).toBe('/assets/nfl-logos/dark/DEN.png');
  });
});

describe('nfl-dark-logos manifest + fetch script', () => {
  it('fetch script team list stays in lockstep with getAllNFLTeamCodes', () => {
    // The .mjs script cannot import the TS helper, so it carries its own copy
    // of the canonical list — this is the sync guard.
    expect([...NFL_TEAM_CODES].sort()).toEqual([...getAllNFLTeamCodes()].sort());
  });

  it('manifest only ever lists canonical team codes', () => {
    const canonical = new Set(getAllNFLTeamCodes());
    for (const code of darkLogoManifest.codes) {
      expect(canonical.has(code)).toBe(true);
    }
  });

  it('every committed manifest code has its mirrored PNG on disk', () => {
    // The manifest is tracked but the PNGs it vouches for are gitignored, so
    // a populated manifest must never be committed: any checkout that didn't
    // run the prebuild fetch (CI, a teammate's astro dev) would emit CSS
    // pointing at files it doesn't have — broken icons in dark mode, the bug
    // this system exists to prevent. In CI the committed manifest is empty
    // and this passes trivially; after a local prebuild the files exist.
    const darkDir = path.join(__dirname, '..', 'public', 'assets', 'nfl-logos', 'dark');
    for (const code of darkLogoManifest.codes) {
      expect(
        fs.existsSync(path.join(darkDir, `${code}.png`)),
        `manifest lists ${code} but public/assets/nfl-logos/dark/${code}.png is missing — ` +
          'a populated manifest must not be committed (the PNGs are gitignored)',
      ).toBe(true);
    }
  });
});
