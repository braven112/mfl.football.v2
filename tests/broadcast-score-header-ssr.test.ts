import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import BroadcastScoreHeader from '../src/components/shared/live-broadcast/BroadcastScoreHeader';
import type { BroadcastLeaguePanel, BroadcastLeagueScore, BroadcastTeam } from '../src/types/live-broadcast';
import type { NflGame, PlayerMeta } from '../src/types/live-scoring';

/**
 * What a cell actually PRINTS, not what the pure helpers return.
 *
 * The two bugs this file exists for were both invisible to the layout tests
 * and to the scan guards: each count and the clock were computed correctly and
 * then placed where they said something else. "1 to play" sat in the cell foot
 * with no team attached to it, and at three cells or more the ladder took the
 * only thing that disambiguated it. Asserting on the rendered STRING is the
 * version of this check that cannot be satisfied by plumbing that is wired up
 * and wrong (same reasoning as `nfl-games-strip-ssr.test.ts`).
 */

const team = (id: string, name: string): BroadcastTeam => ({
  franchiseId: id,
  name,
  nameShort: name,
  abbrev: name.slice(0, 3).toUpperCase(),
  icon: '',
  iconSmall: '',
  primary: '#123456',
  secondary: '#654321',
  swatch: '#abcdef',
  gradient: '',
});

const panel: BroadcastLeaguePanel = {
  leagueId: '13522',
  leagueName: 'The League',
  slug: 'theleague',
  franchiseId: '0001',
  home: true,
  status: 'ok',
  matchups: [{ index: 0, mine: team('0001', 'Pigskins'), opponent: team('0002', 'Pain') }],
};

const meta: Record<string, PlayerMeta> = {
  kc: { id: 'kc', name: 'KC Guy', position: 'RB', nflTeam: 'KC', headshot: '', espnId: null, projected: 10 },
  atl: { id: 'atl', name: 'ATL Guy', position: 'QB', nflTeam: 'ATL', headshot: '', espnId: null, projected: 10 },
};

const games: NflGame[] = [
  // The night game, just kicked off — the one that used to speak for the whole
  // cell while everything else was final.
  { id: 'g1', state: 'in', shortDetail: '1:33 - 1st', period: 1, clock: '1:33', home: { code: 'KC', score: 3 }, away: { code: 'LV', score: 0 }, possession: 'KC', date: '' },
  { id: 'g3', state: 'post', shortDetail: 'Final', period: 4, clock: '0:00', home: { code: 'ATL', score: 24 }, away: { code: 'NO', score: 20 }, possession: null, date: '' },
];

const scores: Record<string, BroadcastLeagueScore> = {
  '13522': {
    leagueId: '13522',
    ok: true,
    live: true,
    winProbability: [0.62],
    teams: {
      '0001': {
        live: 97.2,
        projectedFinal: 112.5,
        remainingPoints: 15.3,
        yetToPlay: 1,
        players: [{ id: 'kc', live: 0, secondsRemaining: 3600, status: 'starter' }],
      },
      '0002': {
        live: 73.5,
        projectedFinal: 140.1,
        remainingPoints: 66.6,
        yetToPlay: 4,
        players: [{ id: 'atl', live: 22, secondsRemaining: 0, status: 'starter' }],
      },
    },
  },
};

const ssr = (over: Record<string, unknown> = {}) =>
  renderToString(
    createElement(BroadcastScoreHeader as any, {
      panels: [panel],
      compact: [],
      hasExtras: false,
      expanded: false,
      onToggleExtras: () => {},
      scores,
      tier: 3,
      hidden: false,
      games,
      meta,
      ...over,
    }),
  );

describe('BroadcastScoreHeader — what the cell prints', () => {
  it('gives EACH team its own to-play count, stacked under that team’s name', () => {
    const html = ssr();
    // Both counts, each immediately after the name it belongs to and inside
    // that name's own column — not loose on the row, where it ellipsised to
    // "1 to ..." against the numerals on a real doubleheader cell.
    expect(html).toMatch(
      /<span class="lbc__who"><span class="lbc__tn">Pigskins<\/span><span class="lbc__ytp">1 to play<\/span><\/span>/,
    );
    expect(html).toMatch(
      /<span class="lbc__who"><span class="lbc__tn">Pain<\/span><span class="lbc__ytp is-opp">4 to play<\/span><\/span>/,
    );
  });

  it('keeps both counts at the ordinary four-cell density', () => {
    // Tier 3 is two leagues with a doubleheader each. `oppytp` was rung one,
    // so this board printed a lone, unattributed "1 to play".
    expect(ssr({ tier: 3 })).not.toMatch(/is-drop-oppytp/);
    expect(ssr({ tier: 4 })).toMatch(/is-drop-oppytp/);
  });

  it('clocks the MATCHUP, not the last game to kick off', () => {
    const html = ssr();
    expect(html).toContain('left</span>');
    // ESPN's own spelling of the night game's clock must not appear.
    expect(html).not.toContain('1:33 - 1st');
  });

  it('prints no clock and no counts when the league’s feed could not be read', () => {
    const html = ssr({ panels: [{ ...panel, status: 'unavailable' }] });
    expect(html).toContain('Feed unavailable');
    expect(html).not.toContain('to play');
    expect(html).not.toContain('left</span>');
  });
});
