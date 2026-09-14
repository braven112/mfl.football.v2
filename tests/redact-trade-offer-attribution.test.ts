import { describe, it, expect } from 'vitest';
import { redactTradeOffer } from '../scripts/lib/redact-trade-offer.mjs';

/**
 * The named team must OWN the named players.
 *
 * The prompt's signal-2 wording asserts ownership — "Hearing the [team] have
 * [Player] on the table" — so pairing a coin-flipped team with a player from
 * either side of the offer publishes a false claim about a real owner's
 * roster. That shipped on 2026-09-05: "the Mavericks have had Colston
 * Loveland on the table", when Loveland is a Pacific Pigskins player and
 * Maverick was trying to ACQUIRE him.
 */

const playerMap = new Map<string, { name: string; position: string; nflTeam: string }>([
  ['17104', { name: 'Colston Loveland', position: 'TE', nflTeam: 'CHI' }],
  ['16613', { name: 'Dylan Laube', position: 'RB', nflTeam: 'LV' }],
]);

const teamMap = new Map<string, { name: string; division?: string }>([
  ['0001', { name: 'Pacific Pigskins', division: 'East' }],
  ['0003', { name: 'Maverick', division: 'West' }],
]);

/**
 * Maverick (0003) offers a pick and asks for Loveland, who is Pigskins' (0001)
 * player. `franchise1_gave_up` is what franchise1 sends.
 */
function offer(id: string) {
  return {
    id,
    franchise: '0003',
    franchise2: '0001',
    franchise1_gave_up: 'FP_0003_2027_3', // Maverick sends a pick
    franchise2_gave_up: '17104',          // Pigskins sends Loveland
    timestamp: '1788624000',
  };
}

/** The redactor can bail with `{ skip: true }`; these fixtures never do. */
const redact = (id: string, exposureCount: number) =>
  redactTradeOffer({
    rawOffer: offer(id),
    offeringFid: '0003',
    playerMap,
    teamMap,
    counts: { ownerOfferCount7d: 1, divisionOfferCount7d: 0, playerHistory: new Map() },
    currentYear: 2026,
    exposureCount,
    adpRankByPlayerId: new Map([['17104', 12]]),
  }).tip!;

describe('a trade-offer post names only players the named team is giving up', () => {
  /**
   * The team is picked by a hash of the offer id, so different ids exercise
   * both branches of the coin flip. Whichever team is named, the players
   * beside it must be that team's own.
   */
  it.each(['1003', '1004', '2001', '7777', 'abc', 'zzz9'])(
    'holds for offer %s, whichever way the coin lands',
    (id) => {
      // exposureCount 2 → signal 3. NOT signal 2: `plannedPlayerCount` names a
      // player every OTHER signal, so at signal 2 `players` is always empty and
      // every assertion below it is unreachable. This case guarded nothing for
      // as long as the cadence has been halved.
      const exposure = redact(id, 2).exposure!;
      expect(exposure.signal).toBe(3);

      // Only Pigskins is giving up a player, so only Pigskins may be paired
      // with one. Maverick is sending a pick and has nobody to shop.
      expect(exposure.players.length).toBeGreaterThan(0);
      expect(exposure.team.name).toBe('Pacific Pigskins');
      expect(exposure.players.map((p) => p.name)).toEqual(['Colston Loveland']);
    },
  );

  it('never names Maverick alongside the player Maverick is trying to acquire', () => {
    for (const id of ['1003', '1004', '2001', '7777', 'abc', 'zzz9']) {
      const exposure = redact(id, 2).exposure!;
      const namesMaverick = exposure.team.name === 'Maverick';
      const namesLoveland = exposure.players.some((p) => p.name === 'Colston Loveland');
      expect(namesMaverick && namesLoveland).toBe(false);
    }
  });

  it('still names a team at signal 1, with no players', () => {
    const exposure = redact('1003', 0).exposure!;
    expect(exposure.signal).toBe(1);
    expect(exposure.players).toEqual([]);
    expect(exposure.team.name).toBeTruthy();
  });

  it('pairs each side with its own player when both sides send one', () => {
    const both = {
      ...offer('5150'),
      franchise1_gave_up: '16613', // Maverick sends Laube
      franchise2_gave_up: '17104', // Pigskins sends Loveland
    };
    const tip = redactTradeOffer({
      rawOffer: both,
      offeringFid: '0003',
      playerMap,
      teamMap,
      counts: { ownerOfferCount7d: 1, divisionOfferCount7d: 0, playerHistory: new Map() },
      currentYear: 2026,
      // exposureCount 2 → signal 3, the first signal that prints a name under
      // the every-other-signal cadence (see plannedPlayerCount).
      exposureCount: 2,
      adpRankByPlayerId: new Map([['17104', 12], ['16613', 40]]),
    }).tip!;
    const { team, players } = tip.exposure!;
    const expected = team.name === 'Maverick' ? 'Dylan Laube' : 'Colston Loveland';
    expect(players.map((p) => p.name)).toEqual([expected]);
  });
});
