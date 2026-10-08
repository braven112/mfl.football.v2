/**
 * Related pages (src/utils/related-pages.ts) — less-used pages promoted on
 * the popular page they belong with, instead of a nav link of their own.
 *
 * The rule a regression would break silently: a card must never link a page
 * the league does not have. Every promoted page is checked against the real
 * route file for every registry league that would show it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RELATED_PAGES, leagueHasRelatedPage, relatedPagesFor } from '../src/utils/related-pages';
import { ALL_LEAGUES } from '../src/config/leagues';

const routeExists = (slug: string, p: string) => {
  const base = path.join(process.cwd(), 'src/pages', slug, p.replace(/^\//, ''));
  return fs.existsSync(`${base}.astro`) || fs.existsSync(path.join(base, 'index.astro'));
};

describe('related pages', () => {
  it('only ever links a page the league actually has', () => {
    for (const [host, spot] of Object.entries(RELATED_PAGES)) {
      for (const league of ALL_LEAGUES) {
        if (!routeExists(league.slug, host)) continue;
        for (const page of spot.pages) {
          if (!leagueHasRelatedPage(league.slug, page.path)) continue;
          expect(routeExists(league.slug, page.path), `${league.slug}${host} promotes ${page.path}, which ${league.slug} does not have`).toBe(true);
        }
      }
    }
  });

  it('puts Sunday Ticket and the broadcast board on Live Scoring', () => {
    const tl = relatedPagesFor('/live-scoring', 'theleague', false)!;
    expect(tl.pages.map((p) => p.href)).toEqual(['/theleague/sunday-ticket', '/theleague/broadcast']);
    // On the league's own domain the prefix is dropped.
    expect(relatedPagesFor('/live-scoring', 'afl-fantasy', true)!.pages[0].href).toBe('/sunday-ticket');
  });

  it('shows best-ball leagues nothing — they have none of these pages', () => {
    const bestBall = ALL_LEAGUES.find((l) => l.bestBall);
    if (bestBall) expect(relatedPagesFor('/live-scoring', bestBall.slug, false)).toBeNull();
  });
});
