/**
 * MFL's Place Bid deep-link (`options?…&O=43&P=<id>`) may only be offered while
 * the auction window is open.
 *
 * `O=43` is not "join the bidding" — on a player nobody has nominated it OPENS
 * an auction at the league minimum. So it is an acquisition control, and it
 * belongs to exactly one phase of the year.
 *
 * The Free Agents page carried three of these. The main acquisition column had
 * always chosen per phase (`isAuctionSeason ? O=43 : add_drop`). The Value view's
 * Bid column and the Auction view's Bid column had not — and the Auction TAB
 * itself is shown whenever the feed carries any auction data at all
 * (`canShowAuctionView = _hasAuctionData`), which is true year-round. So out of
 * season the page still handed owners a live "Bid ↗".
 *
 * On 2026-09-03, during a waiver week with the free-agent pool locked, an owner
 * used it: MFL recorded `AUCTION_INIT 0006 8851|425000|` — an auction on a
 * player every other owner had to file a blind bid for.
 *
 * Two separate things are pinned below, because hiding a column is NOT the same
 * as not rendering the link:
 *   1. every `O=43` render site is gated on `isAuctionSeason`, so no live link
 *      exists in the DOM out of season (a `display: none` column still holds a
 *      working anchor for find-in-page and the accessibility tree);
 *   2. the columns are hidden too, so neither view shows an orphan header.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = 'src/pages/theleague/players.astro';
const source = fs.readFileSync(path.join(process.cwd(), PAGE), 'utf-8');

/**
 * Every line that BUILDS an MFL Place Bid URL. Matched on the query fragment
 * `&O=43&P=` rather than on a helper name, because the URL is assembled inline
 * at each site — a fourth copy would be written the same way and has to be
 * caught. The `&…&P=` is what keeps prose out: the comments around these lines
 * discuss `O=43` by name and must not be mistaken for call sites.
 */
const bidUrlLines = source
  .split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => line.includes('&O=43&P='));

describe('MFL Place Bid deep-links on Free Agents', () => {
  it('still has the Place Bid sites this test exists to guard', () => {
    // If this drops to zero the assertions below pass vacuously, which is the
    // one way this file could go quiet while the bug came back.
    expect(bidUrlLines.length).toBeGreaterThanOrEqual(3);
  });

  it('renders no Bid link anywhere without an isAuctionSeason gate', () => {
    // Each `O=43` URL is built one or more lines above the `html +=` that emits
    // it, so the gate is looked for in the surrounding block rather than on the
    // same line.
    const lines = source.split('\n');
    for (const { n } of bidUrlLines) {
      const block = lines.slice(Math.max(0, n - 1), n + 12).join('\n');
      expect(
        block,
        `${PAGE}:${n} builds an MFL Place Bid URL but nothing within the next 12 lines gates it on isAuctionSeason`
      ).toContain('isAuctionSeason');
    }
  });

  it('keeps the Value view Place Bid column out of the keep-list out of season', () => {
    // The value view hides every cell and re-shows a keep-list, so the column is
    // gated by whether its selectors are IN that list.
    expect(source).toMatch(
      /isAuctionSeason\s*\?\s*\[\s*'\.players-table th\.col-place-bid',\s*'\.players-table td\.col-place-bid'\s*\]\s*:\s*\[\]/
    );
  });

  it('hides the Auction view Place Bid column out of season', () => {
    // The auction view re-shows all of `.col-group--auction`, so this one needs
    // an explicit hide rather than an omission.
    expect(source).toContain("document.querySelectorAll('.col-auction-placebid')");
    const idx = source.indexOf("document.querySelectorAll('.col-auction-placebid')");
    const before = source.slice(Math.max(0, idx - 200), idx);
    expect(before, 'the .col-auction-placebid hide is not guarded by !isAuctionSeason').toContain(
      '!isAuctionSeason'
    );
  });

  it('leaves the phase-aware acquisition column choosing add_drop out of season', () => {
    // The regression this whole file guards would also be reintroduced by making
    // the main column unconditional, so pin its ternary too.
    expect(source).toMatch(/isAuctionSeason\s*\n?\s*\?\s*`https:\/\/\$\{mflHost\}\/\$\{mflActionYear\}\/options\?L=\$\{mflLeagueId\}&O=43/);
    expect(source).toContain('add_drop?L=${mflLeagueId}');
  });
});
