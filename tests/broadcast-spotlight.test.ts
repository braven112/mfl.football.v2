import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StripPage, StripRow } from '../src/utils/broadcast-layout';
import { isMomentFresh } from '../src/utils/broadcast-moments';
import {
  SPOTLIGHT_GAP_MS,
  SPOTLIGHT_HOLD_MS,
  spotlightCandidates,
  spotlightMoment,
  spotlightText,
} from '../src/utils/broadcast-spotlight';
import { ownStatLines } from '../src/utils/broadcast-board';

const row = (over: Partial<StripRow>): StripRow => ({
  key: 'a:0001:p1',
  leagueId: 'a',
  leagueName: 'The League',
  side: 'mine',
  playerId: 'p1',
  name: 'Colston Loveland',
  position: 'TE',
  nflTeam: 'CHI',
  headshot: '',
  crest: '',
  points: 14.2,
  clock: '9:41 - 3rd',
  state: 'in-progress',
  ...over,
});

const page = (rows: StripRow[], kind: 'mine' | 'opponent' = 'mine'): StripPage => ({
  key: `page:${rows.map((r) => r.key).join(',')}`,
  kind,
  label: kind,
  rows,
});

describe('spotlightCandidates', () => {
  it('keeps only my players whose game is in progress, once each, in strip order', () => {
    const pages = [
      page([
        row({ key: 'a:1', name: 'Live One' }),
        row({ key: 'a:2', name: 'Not Started', state: 'not-started' }),
        row({ key: 'a:3', name: 'Done', state: 'final' }),
      ]),
      page([row({ key: 'b:4', name: 'Theirs', side: 'opponent' })], 'opponent'),
      page([row({ key: 'b:5', name: 'Live Two' }), row({ key: 'a:1', name: 'Live One' })]),
    ];
    expect(spotlightCandidates(pages).map((r) => r.name)).toEqual(['Live One', 'Live Two']);
  });

  it('is empty when none of my players is on the field', () => {
    expect(spotlightCandidates([page([row({ state: 'final' })])])).toEqual([]);
  });
});

describe('spotlightMoment', () => {
  const m = spotlightMoment(row({}), '0001', 'Pacific Pigskins');

  it('is mine, in the row league and franchise, so the takeover finds its colours', () => {
    expect(m).toMatchObject({
      side: 'mine',
      leagueId: 'a',
      franchiseId: '0001',
      franchiseName: 'Pacific Pigskins',
      playerId: 'p1',
      playerName: 'Colston Loveland',
    });
  });

  it('shows points and the real clock, never a play or a score delta', () => {
    expect(m.text).toBe('14.2 pts so far');
    expect(m.clock).toBe('9:41 - 3rd');
    expect(m.scoreValue).toBe(0);
  });

  it('can never pass for a fresh play', () => {
    expect(m.key.startsWith('spotlight:')).toBe(true);
    expect(isMomentFresh(m, Date.now())).toBe(false);
  });
});

describe('spotlight stats', () => {
  it('puts the box score after the points', () => {
    expect(spotlightText(18.4, '6 rec (8 tgt), 84 yds, 1 TD')).toBe(
      '18.4 pts \u00b7 6 rec (8 tgt), 84 yds, 1 TD',
    );
    expect(spotlightMoment(row({}), '0001', 'P', '3 car, 12 yds').text).toBe(
      '14.2 pts \u00b7 3 car, 12 yds',
    );
  });

  it('ships only my own starters with a line, never an opponent', () => {
    const box = {
      mine1: { statLine: '6 rec (8 tgt), 84 yds' },
      mine2: { statLine: '' },
      theirs: { statLine: '20/31, 240 yds' },
    };
    expect(ownStatLines(new Set(['mine1', 'mine2', 'absent']), box)).toEqual({
      mine1: '6 rec (8 tgt), 84 yds',
    });
    expect(ownStatLines(new Set(['mine1']), undefined)).toEqual({});
  });
});

describe('the island', () => {
  const src = readFileSync('src/components/shared/live-broadcast/LiveBroadcast.tsx', 'utf8');

  it('lets a real reveal outrank the spotlight and keeps it off the handheld board', () => {
    expect(src).toMatch(/spotlightAllowed = !current && !isQuiet && mode === 'tv'/);
  });

  it('holds for less time than the scoreboard gets between spotlights', () => {
    expect(SPOTLIGHT_HOLD_MS).toBeLessThan(SPOTLIGHT_GAP_MS);
  });
});
