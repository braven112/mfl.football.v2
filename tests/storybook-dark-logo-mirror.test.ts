/**
 * Chromatic snapshots must never touch a CDN.
 *
 * This is the guard on the Bengals-logo flake (Sep 2026): Roster/PlayerCell
 * failed Chromatic intermittently because its DARK snapshots were fetching the
 * team mark live from a.espncdn.com at capture time.
 *
 * The path was invisible from the story — no story arg named a URL. It came
 * from the CSS `.storybook/preview.ts` injects. `buildNflLogoDarkCss()` swaps
 * every NFL logo <img> for its dark cut via `content: url(...)`, serving the
 * self-hosted mirror for teams in `src/data/nfl-dark-logos-manifest.json` and
 * falling back to ESPN's CDN for the rest. That mirror is written by prebuild
 * and gitignored, and `storybook build` never runs prebuild — so in CI the
 * manifest was its committed `{"codes": []}` default and ALL 32 teams fell
 * back to the CDN. `content:` images have no error fallback and Chromatic's
 * 300ms settle does not cover a cross-origin round trip, so ESPN weather
 * failed builds that had nothing wrong with them.
 *
 * The fix has two halves and this file pins both:
 *   1. Storybook carries its own COMMITTED mirror (.storybook/static/nfl-dark,
 *      served at /storybook-nfl-dark) so all 32 swaps stay offline.
 *   2. Both dark-logo builders take `sameOriginOnly`, which DROPS a swap that
 *      would point off-origin instead of emitting it. That is the backstop: a
 *      missing mirror file degrades to the light mark in dark mode — a
 *      deterministic, visible diff — never to a network request.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { buildNflLogoDarkCss } from '../src/utils/nfl-logo-dark-css';
import { buildCollegeLogoDarkCss } from '../src/utils/college-logo-dark-css';
import { getAllNFLTeamCodes, getNFLTeamLogo } from '../src/utils/nfl-logo';
import { STORYBOOK_NFL_TEAM_CODES } from '../scripts/mirror-storybook-dark-logos.mjs';
import {
  STORYBOOK_NFL_DARK_BASE_PATH,
  STORYBOOK_NFL_DARK_CODES,
} from '../.storybook/nfl-dark-mirror';

const ROOT = path.join(__dirname, '..');
const MIRROR_DIR = path.join(ROOT, '.storybook', 'static', 'nfl-dark');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** The Storybook configuration of the NFL builder, in one place. */
const storybookNflCss = () =>
  buildNflLogoDarkCss({
    manifestCodes: STORYBOOK_NFL_DARK_CODES,
    darkBasePath: STORYBOOK_NFL_DARK_BASE_PATH,
    sameOriginOnly: true,
  });

describe('Storybook NFL dark-logo mirror', () => {
  it('mirrors every canonical team — a gap is a live CDN fetch in a snapshot', () => {
    expect([...STORYBOOK_NFL_DARK_CODES].sort()).toEqual([...getAllNFLTeamCodes()].sort());
  });

  it('keeps the mirror script team list in lockstep with getAllNFLTeamCodes', () => {
    // The .mjs script cannot import the TS helper, so it carries its own copy.
    expect([...STORYBOOK_NFL_TEAM_CODES].sort()).toEqual([...getAllNFLTeamCodes()].sort());
  });

  it('has a real PNG on disk for every code the manifest claims', () => {
    // The manifest is what preview.ts trusts. A code listed without its file
    // would emit a same-origin swap at a 404 — a broken-image icon baselined
    // into every dark snapshot, which is worse than the CDN it replaced.
    for (const code of STORYBOOK_NFL_DARK_CODES) {
      const file = path.join(MIRROR_DIR, `${code}.png`);
      expect(fs.existsSync(file), `${code}.png missing from .storybook/static/nfl-dark`).toBe(true);
      const buf = fs.readFileSync(file);
      // Same 1KB floor the mirror lib uses: CDN edge error pages served with a
      // 200 are tiny, and every real 500px cut is tens of KB.
      expect(buf.length, `${code}.png is too small to be a logo`).toBeGreaterThan(1024);
      expect(buf.subarray(0, 4).equals(PNG_MAGIC), `${code}.png is not a PNG`).toBe(true);
    }
  });

  it('carries no file the manifest does not list', () => {
    const onDisk = fs
      .readdirSync(MIRROR_DIR)
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace(/\.png$/, ''))
      .sort();
    expect(onDisk).toEqual([...STORYBOOK_NFL_DARK_CODES].sort());
  });
});

/**
 * Every `content: url(...)` target in a sheet — the ONLY thing here that
 * causes a fetch. ESPN URLs also appear as `[src="..."]` MATCH KEYS (a page
 * can render the CDN 500 PNG as its light logo), and a selector never loads
 * anything, so a bare `not.toContain('espncdn')` would be testing the wrong
 * half of the file.
 */
const swapTargets = (css: string): string[] =>
  [...css.matchAll(/content:\s*url\("([^"]+)"\)/g)].map((m) => m[1]);

/** A same-origin target is a root-relative path; anything else is a network hop. */
const offOrigin = (css: string): string[] => swapTargets(css).filter((u) => !u.startsWith('/'));

describe('Storybook dark-logo CSS is offline', () => {
  it('points every NFL swap at the local mirror, never a CDN', () => {
    expect(offOrigin(storybookNflCss())).toEqual([]);
  });

  it('emits no college swap at all — none is mirrored, so none may be remote', () => {
    const css = buildCollegeLogoDarkCss({ sameOriginOnly: true });
    expect(offOrigin(css)).toEqual([]);
    expect(swapTargets(css)).toEqual([]);
    // The failed-logo hide survives; it is what keeps a src="" placeholder
    // from baselining a broken-image icon into the modal snapshots.
    expect(css).toContain('img.college-logo-failed { visibility: hidden; }');
  });

  it('still swaps all 32 teams, pointed at the Storybook mirror', () => {
    const css = storybookNflCss();
    for (const code of getAllNFLTeamCodes()) {
      // The ESPN 500 light src and the local SVG both key a swap.
      expect(css).toContain(
        `html.dark img[src="${getNFLTeamLogo(code)}"] { content: url("${STORYBOOK_NFL_DARK_BASE_PATH}/${code}.png"); }`,
      );
      expect(css).toContain(
        `html.dark img[src="/assets/nfl-logos/${code}.svg"] { content: url("${STORYBOOK_NFL_DARK_BASE_PATH}/${code}.png"); }`,
      );
    }
  });

  it('drops a swap rather than falling back to the CDN when the mirror lacks a team', () => {
    // The backstop. With CIN absent from the manifest, the light mark renders
    // unswapped in dark mode — a visible diff a human accepts or rejects —
    // instead of a fetch that usually works.
    const css = buildNflLogoDarkCss({
      manifestCodes: getAllNFLTeamCodes().filter((c) => c !== 'CIN'),
      darkBasePath: STORYBOOK_NFL_DARK_BASE_PATH,
      sameOriginOnly: true,
    });
    expect(offOrigin(css)).toEqual([]);
    expect(css).not.toContain(`html.dark img[src="/assets/nfl-logos/CIN.svg"]`);
    expect(css).toContain(
      `html.dark img[src="/assets/nfl-logos/BUF.svg"] { content: url("${STORYBOOK_NFL_DARK_BASE_PATH}/BUF.png"); }`,
    );
  });

  it('leaves the shipped site on the prebuild mirror + CDN fallback', () => {
    // sameOriginOnly is a Storybook-only posture. Production WANTS the CDN
    // fallback: a failed prebuild fetch must degrade to the remote dark cut,
    // never to no dark cut at all (that is the Aug 2026 AFL players-page bug
    // in reverse). Memoization must not leak the Storybook build into it.
    const production = buildNflLogoDarkCss();
    // The committed manifest is empty, so today every production swap target
    // IS the CDN — exactly the fallback Storybook must not inherit.
    expect(offOrigin(production).length).toBeGreaterThan(0);
    expect(production).not.toContain(STORYBOOK_NFL_DARK_BASE_PATH);
  });
});

describe('.storybook wiring', () => {
  const read = (file: string) => fs.readFileSync(path.join(ROOT, '.storybook', file), 'utf8');

  it('serves the mirror at the prefix nfl-dark-mirror.ts advertises', () => {
    expect(read('main.ts')).toContain(
      `{ from: './static/nfl-dark', to: '${STORYBOOK_NFL_DARK_BASE_PATH}' }`,
    );
  });

  it('passes sameOriginOnly to BOTH builders in preview.ts', () => {
    // The one rule. Injecting either sheet without it re-opens the CDN
    // dependency for every dark snapshot in the suite.
    const preview = read('preview.ts');
    expect(preview).toMatch(/buildNflLogoDarkCss\(\{[^}]*sameOriginOnly:\s*true/s);
    expect(preview).toMatch(/buildCollegeLogoDarkCss\(\{[^}]*sameOriginOnly:\s*true/s);
  });
});
