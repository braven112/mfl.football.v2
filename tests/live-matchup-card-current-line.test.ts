/**
 * Guard: a matchup card's "today's name" line is all-or-nothing PER CARD.
 *
 * Throwback Week (2026-10-02) dresses a club in an era name, and Live Scoring
 * prints the present-day name under it (`LiveTeam.currentName`). When only ONE
 * side of a card had been renamed, that side's row grew a second line and the
 * other did not, so the two rows of the card sat at different heights.
 *
 * The rule: if either side carries `currentName`, the other side renders an
 * empty, aria-hidden placeholder line; if neither does, no line at all, so a
 * normal week's card is unchanged.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LvMatchupCard from '../src/components/shared/live/LvMatchupCard';
import type { LiveMatchup, LiveTeam } from '../src/types/live';

function team(id: string, name: string, currentName?: string): LiveTeam {
  return {
    franchiseId: id,
    name,
    nameShort: name,
    initials: name.slice(0, 2).toUpperCase(),
    icon: '',
    iconAlt: '',
    rung: 'text',
    ...(currentName ? { currentName } : {}),
    live: 50,
    projectedFinal: 90,
    remainingPoints: 40,
    yetToPlay: 3,
    players: [],
    bench: [],
  } as LiveTeam;
}

function render(a: LiveTeam, b: LiveTeam): string {
  const matchup = { index: 0, sides: [a, b], viewerSide: null, p0: 0.5 } as unknown as LiveMatchup;
  return renderToStaticMarkup(createElement(LvMatchupCard, { matchup, onOpen: () => {} }));
}

const lines = (html: string) => html.match(/class="lv-side__current[^"]*"/g) ?? [];

describe('LvMatchupCard current-name line', () => {
  it('gives the un-renamed side a hidden placeholder when only one side is renamed', () => {
    const html = render(team('0001', 'The Executioners', 'Today Name'), team('0002', 'Da Dangsters'));
    expect(lines(html)).toHaveLength(2);
    expect(html).toContain('>Today Name<');
    expect(html).toMatch(/class="lv-side__current lv-side__current--empty" aria-hidden="true"/);
  });

  it('renders both real lines when both sides are renamed', () => {
    const html = render(team('0001', 'Era A', 'Now A'), team('0002', 'Era B', 'Now B'));
    expect(lines(html)).toEqual(['class="lv-side__current"', 'class="lv-side__current"']);
  });

  it('renders no extra line on a normal week', () => {
    const html = render(team('0001', 'Alpha'), team('0002', 'Beta'));
    expect(lines(html)).toHaveLength(0);
  });
});
