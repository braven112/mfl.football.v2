/**
 * Guard: per-league PWA identity and push-notification art.
 *
 * Two bugs shipped here in Sept 2026, both AFL-only and both invisible in a
 * diff, so each rule below is pinned mechanically:
 *
 * 1. `public/assets/afl/favicons/site.webmanifest` declared
 *    `start_url` / `scope` of `/afl-fantasy/`. Every league is served at the
 *    ROOT of its own apex domain (the middleware rewrites `/rosters` →
 *    `/afl-fantasy/rosters`, and vercel.json 301s `/afl-fantasy/*` → `/*` on
 *    that host), so that scope excluded every URL the manifest was linked
 *    from. A manifest whose scope does not cover the document is discarded:
 *    no install, no app icon, no app identity on notifications.
 *
 * 2. The service worker sent TheLeague's `icon-192.png` as the notification
 *    BADGE for every league. Android uses only a badge's alpha channel as a
 *    stencil, and that file is PNG color type 2 — no alpha channel at all —
 *    so it rendered as a solid white square rather than a mark.
 *
 * See docs/features/web-push.md.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPng } from '../scripts/lib/png-raw.mjs';
import { leaguePushIcon, leaguePushBadge } from '../src/utils/push-notify-trade';
import { ALL_LEAGUES } from '../src/config/leagues';

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

/** navSlugs that ship a PWA manifest + push art. Best-ball is draft-only. */
const PUSH_LEAGUES = ALL_LEAGUES.filter((l) => !l.bestBall).map((l) => l.navSlug);

function findManifests(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findManifests(full, out);
    else if (entry.name.endsWith('.webmanifest') || entry.name === 'manifest.json') out.push(full);
  }
  return out;
}

describe('PWA manifests', () => {
  const manifests = findManifests(PUBLIC);

  it('finds every manifest we ship', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(2);
  });

  it.each(manifests)('%s is served at the apex root, not under a league prefix', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    // The whole bug in one assertion. A `/afl-fantasy/` scope on a domain
    // that 301s `/afl-fantasy/*` → `/*` makes the manifest inapplicable to
    // every page that links it.
    expect(m.scope, `${path.basename(file)} scope`).toBe('/');
    expect(m.start_url, `${path.basename(file)} start_url`).toBe('/');
  });

  it.each(manifests)('%s points at icons that exist and are >=192px', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Array.isArray(m.icons) && m.icons.length > 0).toBe(true);
    for (const icon of m.icons) {
      const abs = path.join(PUBLIC, icon.src.replace(/^\//, ''));
      expect(fs.existsSync(abs), `${icon.src} referenced by ${path.basename(file)}`).toBe(true);
      const png = readPng(abs);
      expect(png.width).toBe(png.height);
      expect(png.width).toBeGreaterThanOrEqual(192);
    }
  });

  it.each(manifests)('%s ships a maskable icon so Android has a real adaptive icon', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const maskable = m.icons.filter((i: { purpose?: string }) => i.purpose?.split(/\s+/).includes('maskable'));
    expect(maskable.length).toBeGreaterThan(0);
    for (const icon of maskable) {
      // Adaptive icons are cropped to an OEM shape — a transparent corner
      // becomes a visible notch, so a maskable icon must be full-bleed.
      const png = readPng(path.join(PUBLIC, icon.src.replace(/^\//, '')));
      const corners = [
        [0, 0],
        [png.width - 1, 0],
        [0, png.height - 1],
        [png.width - 1, png.height - 1],
      ];
      for (const [x, y] of corners) {
        expect(png.data[(y * png.width + x) * 4 + 3], `${icon.src} corner ${x},${y} alpha`).toBe(255);
      }
    }
  });
});

describe('push notification art', () => {
  it.each(PUSH_LEAGUES)('%s has an icon and a badge that both exist', (navSlug) => {
    for (const rel of [leaguePushIcon(navSlug), leaguePushBadge(navSlug)]) {
      expect(rel.startsWith('/'), `${rel} must be site-relative`).toBe(true);
      expect(fs.existsSync(path.join(PUBLIC, rel.replace(/^\//, ''))), rel).toBe(true);
    }
  });

  it.each(PUSH_LEAGUES)('%s badge is a translucent stencil, not an opaque block', (navSlug) => {
    const png = readPng(path.join(PUBLIC, leaguePushBadge(navSlug).replace(/^\//, '')));
    let transparent = 0;
    let opaqueNonWhite = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] < 16) transparent++;
      else if (png.data[i] < 240 || png.data[i + 1] < 240 || png.data[i + 2] < 240) opaqueNonWhite++;
    }
    const total = png.width * png.height;
    // Android tints the alpha channel and ignores RGB. An image with no
    // meaningful transparency is a filled square on the device.
    expect(transparent / total, 'transparent fraction').toBeGreaterThan(0.25);
    // ...and the visible part must be white so any platform that DOES honor
    // RGB renders the same silhouette rather than a muddy thumbnail.
    expect(opaqueNonWhite, 'non-white pixels in a stencil').toBe(0);
  });

  it('never reuses a league icon as its badge', () => {
    for (const navSlug of PUSH_LEAGUES) {
      expect(leaguePushBadge(navSlug)).not.toBe(leaguePushIcon(navSlug));
    }
  });

  it('gives each league its own art', () => {
    const icons = new Set(PUSH_LEAGUES.map(leaguePushIcon));
    const badges = new Set(PUSH_LEAGUES.map(leaguePushBadge));
    expect(icons.size).toBe(PUSH_LEAGUES.length);
    expect(badges.size).toBe(PUSH_LEAGUES.length);
  });

  it('the committed art matches what the generator produces', () => {
    // Cheap insurance that a hand-edit of a derived PNG cannot drift from its
    // source favicon: the generator is deterministic.
    expect(() =>
      execFileSync('node', ['scripts/generate-notification-icons.mjs', '--check'], {
        cwd: ROOT,
        encoding: 'utf8',
      }),
    ).not.toThrow();
  });
});

describe('service worker badge contract', () => {
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');

  it('honors a per-payload badge', () => {
    expect(sw).toMatch(/badge:\s*typeof data\.badge === 'string'/);
  });

  it('never falls back to an opaque favicon for the badge', () => {
    const fallback = sw.match(/const DEFAULT_NOTIFICATION_BADGE = '([^']+)'/);
    expect(fallback, 'DEFAULT_NOTIFICATION_BADGE must exist').not.toBeNull();
    const png = readPng(path.join(PUBLIC, fallback![1].replace(/^\//, '')));
    let transparent = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3] < 16) transparent++;
    expect(transparent / (png.width * png.height)).toBeGreaterThan(0.25);
  });
});
