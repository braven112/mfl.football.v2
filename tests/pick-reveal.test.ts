import { describe, it, expect } from 'vitest';
import {
  isSplashCutoutEligible,
  resolveSplashColors,
  collectFreshPicks,
  buildSplashItem,
} from '../src/utils/pick-reveal';
import type { DraftRoomPick, DraftRoomPlayer, DraftRoomTeam } from '../src/types/draft-room';

const player = (over: Partial<DraftRoomPlayer> = {}): DraftRoomPlayer => ({
  id: '16000',
  name: 'Ashton Jeanty',
  position: 'RB',
  nflTeam: '',
  headshot: 'https://a.espncdn.com/i/headshots/college-football/players/full/4890973.png',
  isRookie: true,
  ...over,
});

const team = (over: Partial<DraftRoomTeam> = {}): DraftRoomTeam => ({
  franchiseId: '0001',
  name: 'Pacific Pigskins',
  nameMedium: 'Pigskins',
  nameShort: 'Pigskins',
  abbrev: 'PP',
  icon: '/assets/theleague/icons/0001.png',
  colorPrimary: '#bd1f2b',
  colorSecondary: '#181818',
  ...over,
});

const pick = (n: number, playerId: string, franchiseId = '0001'): DraftRoomPick => ({
  round: Math.ceil(n / 17),
  pickInRound: ((n - 1) % 17) + 1,
  overallPickNumber: n,
  franchiseId,
  playerId,
  timestamp: playerId ? '1750000000' : '',
  comments: '',
  isTraded: false,
});

describe('isSplashCutoutEligible', () => {
  it('accepts transparent espncdn headshots (NFL and college)', () => {
    expect(isSplashCutoutEligible(player())).toBe(true);
    expect(
      isSplashCutoutEligible(
        player({ headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/4362628.png' })
      )
    ).toBe(true);
  });

  it('rejects MFL JPGs — baked backgrounds break composites', () => {
    expect(
      isSplashCutoutEligible(
        player({ headshot: 'https://www49.myfantasyleague.com/player_photos_big_2014/16000_thumb.jpg' })
      )
    ).toBe(false);
  });

  it('rejects DEF picks even with an espncdn URL', () => {
    expect(isSplashCutoutEligible(player({ position: 'DEF' }))).toBe(false);
  });

  it('rejects missing player or empty headshot', () => {
    expect(isSplashCutoutEligible(undefined)).toBe(false);
    expect(isSplashCutoutEligible(player({ headshot: '' }))).toBe(false);
  });

  it('rejects lookalike URLs where espncdn.com is not the actual host', () => {
    expect(
      isSplashCutoutEligible(player({ headshot: 'https://evil.com/espncdn.com/x.png' }))
    ).toBe(false);
    expect(
      isSplashCutoutEligible(player({ headshot: 'https://espncdn.com.evil.com/x.png' }))
    ).toBe(false);
    expect(isSplashCutoutEligible(player({ headshot: 'not a url espncdn.com' }))).toBe(false);
  });
});

describe('resolveSplashColors', () => {
  it('prefers the drafting franchise brand', () => {
    expect(resolveSplashColors(team(), player({ nflTeam: 'CIN' }))).toEqual({
      primary: '#bd1f2b',
      secondary: '#181818',
    });
  });

  it('falls back to NFL team colors when the franchise has no brand color', () => {
    const colors = resolveSplashColors(
      team({ colorPrimary: undefined, colorSecondary: undefined }),
      player({ nflTeam: 'CIN' })
    );
    expect(colors.primary).toBe('#fb4f14');
  });

  it('falls back to league blue for teamless rookies with no brand', () => {
    expect(
      resolveSplashColors(team({ colorPrimary: undefined }), player({ nflTeam: '' }))
    ).toEqual({ primary: '#1c497c', secondary: '#0e2440' });
  });
});

describe('collectFreshPicks', () => {
  const scaffold = [pick(1, '16000'), pick(2, ''), pick(3, '')];
  // pick() stamps made picks with timestamp 1750000000 — treat that as "old"
  // by evaluating from 10 minutes later, or "recent" from 30 seconds later.
  const LONG_AFTER_MS = (1750000000 + 600) * 1000;
  const JUST_AFTER_MS = (1750000000 + 30) * 1000;

  it('returns nothing on first observation — the board is history, not news', () => {
    expect(collectFreshPicks(null, 0, scaffold)).toEqual([]);
  });

  it('skips stale picks when the slot array itself appears (joining an in-progress mock)', () => {
    expect(collectFreshPicks(new Set(), 0, scaffold, 3, LONG_AFTER_MS)).toEqual([]);
  });

  it('still splashes a JUST-made pick arriving with the scaffold (live feed publishing at draft start)', () => {
    const fresh = collectFreshPicks(new Set(), 0, scaffold, 3, JUST_AFTER_MS);
    expect(fresh.map((p) => p.overallPickNumber)).toEqual([1]);
  });

  it('returns newly-landed picks in draft order', () => {
    const picks = [pick(1, '16000'), pick(3, '16002'), pick(2, '16001')];
    const fresh = collectFreshPicks(new Set([1]), 3, picks);
    expect(fresh.map((p) => p.overallPickNumber)).toEqual([2, 3]);
  });

  it('skips catch-up bursts larger than maxBurst', () => {
    const picks = [pick(1, 'a'), pick(2, 'b'), pick(3, 'c'), pick(4, 'd')];
    expect(collectFreshPicks(new Set(), 4, picks)).toEqual([]);
  });

  it('splashes a re-pick after an undo (slot leaves then re-enters the filled set)', () => {
    // After undo the caller rebuilds the seen set WITHOUT slot 2
    const afterUndoSeen = new Set([1]);
    const rePicked = [pick(1, '16000'), pick(2, '16099')];
    const fresh = collectFreshPicks(afterUndoSeen, 2, rePicked);
    expect(fresh.map((p) => p.playerId)).toEqual(['16099']);
  });
});

describe('buildSplashItem', () => {
  it('formats the pick label and joins team + player', () => {
    const teams = new Map([['0001', team()]]);
    const players = new Map([['16000', player()]]);
    const item = buildSplashItem(pick(3, '16000'), teams, players);
    expect(item.pickLabel).toBe('1.03');
    expect(item.id).toBe('3-16000');
    expect(item.team?.name).toBe('Pacific Pigskins');
    expect(item.player?.name).toBe('Ashton Jeanty');
  });

  it('left-pads single-digit pick-in-round values to two digits', () => {
    const item = buildSplashItem(pick(20, '16001'), new Map(), new Map());
    expect(item.pickLabel).toBe('2.03');
  });
});
