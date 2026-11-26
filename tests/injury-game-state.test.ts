import { describe, expect, it } from 'vitest';
import {
  gameStatesByTeam,
  hasKickedOff,
  INJURY_TEMPLATES_LOCKED_BREAKING,
  INJURY_TEMPLATES_LOCKED_STANDARD,
} from '../scripts/lib/injury-game-state.mjs';

const game = (state: string, home: string, away: string) => ({
  competitions: [
    {
      status: { type: { state } },
      competitors: [{ team: { abbreviation: home } }, { team: { abbreviation: away } }],
    },
  ],
});

describe('gameStatesByTeam / hasKickedOff', () => {
  const states = gameStatesByTeam({
    events: [game('in', 'DET', 'CHI'), game('post', 'DAL', 'NYG'), game('pre', 'KC', 'LV')],
  });

  it('marks in-progress and final games as kicked off', () => {
    expect(hasKickedOff(states, 'CHI')).toBe(true);
    expect(hasKickedOff(states, 'det')).toBe(true);
    expect(hasKickedOff(states, 'NYG')).toBe(true);
  });

  it('leaves upcoming games and byes unlocked', () => {
    expect(hasKickedOff(states, 'KC')).toBe(false);
    expect(hasKickedOff(states, 'SEA')).toBe(false);
    expect(hasKickedOff(gameStatesByTeam(null), 'CHI')).toBe(false);
  });
});

describe('after-kickoff injury copy', () => {
  const injury = {
    name: 'Colston Loveland',
    position: 'TE',
    nflTeam: 'CHI',
    status: 'Out',
    detail: 'Shoulder',
  };
  const pools = [...INJURY_TEMPLATES_LOCKED_BREAKING, ...INJURY_TEMPLATES_LOCKED_STANDARD];

  // Brandon, 2026-11-26: once his game has started nobody can change a
  // lineup for him, so the post must never tell managers to do so, and it
  // reports the injury rather than restating that his points stop here.
  it.each(['in', 'post'])('never asks for a lineup change (%s)', (gameState) => {
    for (const t of pools) {
      const body = t({ ...injury, gameState });
      expect(body).not.toMatch(/adjust|lineup|plan b|new plan|monitor through the week|by game day|counting on him|put up|what counts|points/i);
      expect(body).toContain('Colston Loveland');
    }
  });

  it('says the change came during the game while it is in progress', () => {
    expect(INJURY_TEMPLATES_LOCKED_BREAKING[0]({ ...injury, gameState: 'in' })).toContain(
      'has been ruled out during his game (shoulder)',
    );
  });
});
