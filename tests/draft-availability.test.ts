/**
 * Draftable-player resolution for the My Draft List board.
 *
 * The case that matters most is the AFL one: it is a duplicate-player league,
 * so "on a roster" is not the same question as "unavailable to me". 60 of the
 * AFL's 108 rostered players are on two rosters at once, and a player held
 * only in the other conference is still fully draftable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isInDraftPool,
  resolveDraftAvailability,
  selectPushablePlayers,
} from '../src/utils/draft-availability';

const root = join(__dirname, '..');
const feed = (league: string, file: string) =>
  JSON.parse(readFileSync(join(root, `data/${league}/mfl-feeds/2026/${file}`), 'utf-8'));

interface FeedPlayer { id: string; status?: string }

const playersOf = (league: string): FeedPlayer[] =>
  feed(league, 'players.json').players.player.map((p: any) => ({ id: p.id, status: p.status }));

describe('isInDraftPool', () => {
  it('Rookie admits only current-league-year rookies', () => {
    expect(isInDraftPool('Rookie', { id: '1', status: 'R' })).toBe(true);
    expect(isInDraftPool('Rookie', { id: '2' })).toBe(false);
  });

  it('Veteran is the complement', () => {
    expect(isInDraftPool('Veteran', { id: '1', status: 'R' })).toBe(false);
    expect(isInDraftPool('Veteran', { id: '2' })).toBe(true);
  });

  it('Both, and any pool value we do not model, invents no limit', () => {
    for (const pool of ['Both', 'SomethingMFLAddedLater']) {
      expect(isInDraftPool(pool, { id: '1', status: 'R' })).toBe(true);
      expect(isInDraftPool(pool, { id: '2' })).toBe(true);
    }
  });
});

describe('resolveDraftAvailability — TheLeague (Rookie pool, one shared pool)', () => {
  const result = resolveDraftAvailability({
    players: playersOf('theleague'),
    leagueJson: feed('theleague', 'league.json'),
    rostersJson: feed('theleague', 'rosters.json'),
    franchiseId: '0001',
  })!;

  it('resolves', () => {
    expect(result).not.toBeNull();
    expect(result.pool).toBe('Rookie');
    expect(result.perConference).toBe(false);
  });

  it('admits only rookies', () => {
    const byId = new Map<string, FeedPlayer>(playersOf('theleague').map((p) => [p.id, p]));
    for (const id of result.availableIds) {
      expect(byId.get(id)?.status, `player ${id}`).toBe('R');
    }
  });

  it('excludes anyone already on a roster', () => {
    const rostered = new Set<string>();
    for (const f of feed('theleague', 'rosters.json').rosters.franchise) {
      for (const p of [].concat(f.player ?? [])) rostered.add((p as any).id);
    }
    expect(result.availableIds.some((id) => rostered.has(id))).toBe(false);
  });
});

describe('resolveDraftAvailability — AFL (Both pool, duplicate-player conferences)', () => {
  const players = playersOf('afl-fantasy');
  const leagueJson = feed('afl-fantasy', 'league.json');
  const rostersJson = feed('afl-fantasy', 'rosters.json');

  it('scopes per conference', () => {
    const result = resolveDraftAvailability({ players, leagueJson, rostersJson, franchiseId: '0001' })!;
    expect(result.pool).toBe('Both');
    expect(result.perConference).toBe(true);
  });

  it('a player held ONLY in the other conference is still available to me', () => {
    // The whole point of the conference scoping. Find a player on exactly one
    // conference's rosters, then check each conference's view of him.
    // franchise -> division lives on LEAGUE.json; the rosters feed carries no
    // `division` field, so mapping from it silently lumps every franchise into
    // one bucket and the conference distinction disappears. (It did, on the
    // first draft of this test.)
    const divToConf: Record<string, string> = {};
    for (const d of leagueJson.league.divisions.division) divToConf[d.id] = d.conference;
    const confOf: Record<string, string> = {};
    for (const f of leagueJson.league.franchises.franchise) confOf[f.id] = divToConf[f.division];

    const heldBy: Record<string, Set<string>> = {};
    for (const f of rostersJson.rosters.franchise) {
      const c = confOf[f.id];
      expect(c, `franchise ${f.id} must map to a conference`).toBeDefined();
      (heldBy[c] ??= new Set());
      for (const p of [].concat(f.player ?? [])) heldBy[c].add((p as any).id);
    }
    expect(Object.keys(heldBy).length).toBe(2);

    const [c0, c1] = Object.keys(heldBy).sort();
    const onlyInC1 = [...heldBy[c1]].find((id) => !heldBy[c0].has(id));
    expect(onlyInC1, 'expected a player held in exactly one conference').toBeDefined();

    const franchiseIn = (conf: string) =>
      rostersJson.rosters.franchise.find((f: any) => confOf[f.id] === conf).id;

    const availableToC0 = resolveDraftAvailability({
      players, leagueJson, rostersJson, franchiseId: franchiseIn(c0),
    })!.availableIds;
    const availableToC1 = resolveDraftAvailability({
      players, leagueJson, rostersJson, franchiseId: franchiseIn(c1),
    })!.availableIds;

    expect(availableToC0).toContain(onlyInC1);
    expect(availableToC1).not.toContain(onlyInC1);
  });

  it('does not restrict to rookies', () => {
    const result = resolveDraftAvailability({ players, leagueJson, rostersJson, franchiseId: '0001' })!;
    const byId = new Map<string, FeedPlayer>(players.map((p) => [p.id, p]));
    expect(result.availableIds.some((id) => byId.get(id)?.status !== 'R')).toBe(true);
  });
});

describe('fails closed rather than hiding players wrongly', () => {
  it('returns null on a roster payload it cannot trust', () => {
    for (const rostersJson of [
      {},
      { rosters: { franchise: [] } },
      { rosters: { franchise: [{ id: '0001', player: [] }] } }, // partial + empty
    ]) {
      expect(
        resolveDraftAvailability({
          players: [{ id: '1', status: 'R' }],
          leagueJson: feed('theleague', 'league.json'),
          rostersJson,
          franchiseId: '0001',
        }),
      ).toBeNull();
    }
  });

  it('returns null for a franchise it cannot place in a conference', () => {
    expect(
      resolveDraftAvailability({
        players: playersOf('afl-fantasy'),
        leagueJson: feed('afl-fantasy', 'league.json'),
        rostersJson: feed('afl-fantasy', 'rosters.json'),
        franchiseId: '9999',
      }),
    ).toBeNull();
  });
});

describe('selectPushablePlayers — what a push actually sends', () => {
  const board = ['10', '20', '30', '40'];

  it('sends the whole board when the filter is off', () => {
    expect(selectPushablePlayers(board, null)).toEqual(board);
  });

  it('narrows to the draftable pool when the filter is on', () => {
    expect(selectPushablePlayers(board, new Set(['20', '40']))).toEqual(['20', '40']);
  });

  it('preserves board ORDER — the order is the ranking', () => {
    expect(selectPushablePlayers(['40', '10', '30'], new Set(['10', '30', '40'])))
      .toEqual(['40', '10', '30']);
  });

  it('returns empty rather than silently sending everything when nothing qualifies', () => {
    // pushDraftList refuses an empty list, so this surfaces as a blocked push
    // with a message — never as an accidental full-board overwrite.
    expect(selectPushablePlayers(board, new Set())).toEqual([]);
  });
});

describe('the position filter must never reach the push', () => {
  it('the board computes its push list from the availability pool alone', () => {
    // Pushing while looking at QBs would replace the owner's whole MFL list
    // with quarterbacks. The push list is a pure function of (order, pool);
    // this pins that positionFilter is not wired into it.
    const src = readFileSync(
      join(root, 'src/components/theleague/custom-rankings/CustomRankingsPage.tsx'),
      'utf-8',
    );
    const decl = src.slice(src.indexOf('const pushableRankings'));
    const body = decl.slice(0, decl.indexOf('  );') + 4);
    expect(body).toContain('selectPushablePlayers(rankings, activePool)');
    expect(body).not.toContain('positionFilter');
  });
});
