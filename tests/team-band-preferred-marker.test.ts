/**
 * Your own team on a banded standings row: no marker, and one border that must
 * stay suppressed.
 *
 * Three markers were built and each was rejected as clutter on a table that is
 * four to six rows per division and already painted in the club's own colour:
 *
 * 1. An ink ring around the whole row. Legible — the ink is measured against
 *    the fill — but it boxed the band in.
 * 2. A `border-right` in the club's secondary. A border sits at the cell's
 *    OUTER edge, against the CARD, and the trim was the raw secondary: the
 *    seven clubs wearing #e9e9e9 lost it on the white card (1.21:1) and the
 *    sixteen wearing #181818 lost it on the dark one (1.17:1), so their row
 *    read as stopping 6px short rather than as carrying a mark.
 * 3. The same bar floated INSIDE the fill, which fixed (2) for all 40
 *    franchises and was still one line too many.
 *
 * So the band row carries no marker at all. That is a decision, not an
 * oversight, and this file is where it is written down — otherwise the next
 * person to notice the missing marker re-adds shape (2), which looks correct
 * on whichever franchise they happen to be signed in as.
 *
 * What DOES have to hold is the suppression: `.v-std tr.preferred-team` draws
 * its own 3px accent border on the `tr`. The band's original trim edge covered
 * it; with that gone it is a stray coloured sliver against the card, on one row
 * of one division, visible only to the owner of that club. Nobody reviewing a
 * screenshot of someone else's league would ever see it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveTeamBand, teamBandStyle } from '../src/utils/team-band';

const STANDINGS = resolve(__dirname, '../src/components/theleague/standings/StandingsTable.astro');
const css = readFileSync(STANDINGS, 'utf8');

describe('band preferred-team row', () => {
  it('suppresses the row accent border the trim edge used to cover', () => {
    expect(css).toMatch(
      /tbody tr\.st-row--band\.preferred-team,\s*:global\(html\.dark\) tbody tr\.st-row--band\.preferred-team\s*\{[^}]*border-left:\s*none/,
    );
  });

  it('draws no marker of its own on the band', () => {
    // Each of these is one of the three rejected shapes. A new marker is a
    // design decision — make it deliberately and rewrite this test, rather
    // than letting one arrive as a side effect of an unrelated edit.
    const markerRules = [...css.matchAll(/([^{}]*st-row--band\.preferred-team[^{}]*)\{([^{}]*)\}/g)];
    const offenders = markerRules
      .filter(([, , body]) => /box-shadow|::after|border-(right|top|bottom):\s*\d|outline/.test(body))
      .map(([, selector]) => selector.replace(/\s+/g, ' ').trim());
    expect(offenders).toEqual([]);
    expect(css).not.toMatch(/st-row--band\.preferred-team[^{}]*::(after|before)/);
  });
});

describe('the band no longer resolves a colour nothing draws', () => {
  it('emits only the four properties its CSS reads', () => {
    // `trim` (the club's secondary) existed solely for the trim edge and then
    // the your-team bar. With both gone it was removed rather than left
    // resolving and serialising onto every row of every division, unread.
    const style = teamBandStyle(resolveTeamBand('0001', 'theleague'));
    expect(style.split(';').map((d) => d.split(':')[0]).sort()).toEqual([
      '--band-fill',
      '--band-fill-dark',
      '--band-ink',
      '--band-ink-dark',
    ]);
    expect(style).not.toContain('--band-trim');
  });

  it('leaves no dangling reference to the property in the standings CSS', () => {
    expect(css).not.toMatch(/var\(--band-trim/);
  });
});
