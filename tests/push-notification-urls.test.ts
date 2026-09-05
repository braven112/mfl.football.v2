import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues';
import { astroRouteExists } from './helpers/astro-routes';

/**
 * Every `url:` a push sender attaches has to be a real page.
 *
 * The service worker resolves the url against the origin the subscription was
 * made on (`new URL(url, self.location.origin)`), and each league sits on its
 * own apex domain — so a sender writes the BARE path and the root catch-all
 * (`src/pages/[...path].astro`) maps it into that league's page. Two ways that
 * goes wrong, neither of which anything else notices:
 *
 *   - The path names a route that does not exist. Nothing fails at send time;
 *     the alert arrives, the owner taps it, and gets a 404. That shipped once
 *     already — the game-day alerts pointed at `/live` when the route is
 *     `live-scoring.astro`.
 *   - The path is written league-PREFIXED (`/theleague/lineup`). It resolves
 *     for one league's readers and sends the other league's owners to a page
 *     about a league they are not in. Same failure the What's New link guard
 *     exists to catch.
 *
 * Both are cheap to check and impossible to notice by hand, because the only
 * symptom is on a phone, after a real game.
 */

const SCRIPTS_DIR = path.resolve(__dirname, '../scripts');

/** Every `url: '/…'` literal in the cron senders, with its file for the message. */
function collectSenderUrls(): Array<{ source: string; url: string }> {
  const found: Array<{ source: string; url: string }> = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.mjs')) continue;
      const src = readFileSync(full, 'utf8');
      // Only the object-literal form the senders use. A computed url would not
      // be checkable here, and none exists today.
      for (const m of src.matchAll(/\burl:\s*'(\/[^']*)'/g)) {
        found.push({ source: path.relative(SCRIPTS_DIR, full), url: m[1] });
      }
    }
  };
  walk(SCRIPTS_DIR);
  return found;
}

const senderUrls = collectSenderUrls();

/**
 * Only leagues that can actually receive a push.
 *
 * Defined by having a `/notifications` page, because that page is where an
 * owner subscribes — a league without one has no subscribers, so a path that
 * does not resolve there cannot 404 anybody. Best Ball is the case today: it
 * is draft-only, and has no lineup, news or Pecking Order page to link to.
 * Derived rather than listed, so adding the page to a league also starts
 * checking its routes.
 */
const PUSH_LEAGUES = ALL_LEAGUES.filter((l) => astroRouteExists(`/${l.slug}/notifications`));

describe('push notification target URLs', () => {
  it('has at least the two leagues that send push today', () => {
    expect(PUSH_LEAGUES.length).toBeGreaterThanOrEqual(2);
  });

  it('finds the senders at all — a silent zero would pass every check below', () => {
    expect(senderUrls.length).toBeGreaterThan(4);
  });

  it('every url resolves to a real route in EVERY league that can send it', () => {
    const broken: string[] = [];
    for (const { source, url } of senderUrls) {
      for (const league of PUSH_LEAGUES) {
        if (!astroRouteExists(`/${league.slug}${url}`)) {
          broken.push(`${source}: "${url}" → no /${league.slug}${url}`);
        }
      }
    }
    expect(
      broken,
      'A push alert whose url has no page 404s the owner who taps it:\n  '
        + broken.join('\n  '),
    ).toEqual([]);
  });

  it('no url is league-prefixed — the service worker is already on the right origin', () => {
    const prefixes = ALL_LEAGUES.map((l) => `/${l.slug}`);
    const prefixed = senderUrls.filter(({ url }) =>
      prefixes.some((p) => url === p || url.startsWith(`${p}/`)),
    );
    expect(
      prefixed.map((p) => `${p.source}: ${p.url}`),
      'A league-prefixed push url sends the other league’s owners into a league they are not in',
    ).toEqual([]);
  });
});
