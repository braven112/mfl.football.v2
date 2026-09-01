/**
 * AFL waiver order — the serialization rule and the safety rails on the write.
 *
 * The AFL uses WAIVERS_FCFS (rolling "Yahoo style" priority, not blind
 * bidding), so `waiverSortOrder` is not a tiebreaker in this league — it IS
 * the waiver order. MFL does not carry it across a league-year rollover, so a
 * new AFL year starts at MFL's default (reverse franchise id) until someone
 * sets it. That is the bug this code exists to fix, and these tests pin both
 * halves of it: the order that gets built, and the two ways the write could
 * destroy the league if it were built wrong.
 *
 * The constitution says "Initial waiver order = base draft order from the
 * previous season". Both sides of that are PER-CONFERENCE: MFL's Custom Waiver
 * Order page shows two separate conference sections and serializes them into
 * the single `waiverSortOrder` field as one block after the other (American
 * 1-12, National 13-24). Confirmed against the live 2026 AFL league.
 *
 * Conference blocking is harmless here because the AFL is a duplicate-player
 * league scoped by conference — the same player can be rostered by one team in
 * each conference, so teams in different conferences never contend for a claim.
 * Only rank WITHIN a conference matters. An earlier revision interleaved the
 * two orders to keep them "fair"; that solved a non-problem and MFL cannot
 * express it. These tests exist so it is not reintroduced.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAflWaiverOrder,
  buildFranchisesWaiverXml,
  setAflWaiverOrderUrl,
  compareAflWaiverOrder,
  type ConferenceBaseOrder,
} from '../src/utils/afl-waiver-order';
import {
  calculateAFLDraftOrder,
  parseConferenceChampions,
  parseNITResults,
  buildHeadToHeadFromRaw,
} from '../src/utils/afl-draft-utils';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const AM: ConferenceBaseOrder = {
  conference: '00',
  franchiseIds: ['0006', '0004', '0003', '0010', '0009', '0012', '0011', '0002', '0005', '0001', '0008', '0007'],
};
const NA: ConferenceBaseOrder = {
  conference: '01',
  franchiseIds: ['0021', '0014', '0013', '0023', '0024', '0022', '0016', '0019', '0017', '0020', '0018', '0015'],
};

describe('buildAflWaiverOrder — conference-blocked serialization', () => {
  it('emits American League 1-12 then National League 13-24', () => {
    const order = buildAflWaiverOrder([NA, AM]); // argument order must not matter
    expect(order.slice(0, 12).map((e) => e.conference)).toEqual(Array(12).fill('00'));
    expect(order.slice(12).map((e) => e.conference)).toEqual(Array(12).fill('01'));
    expect(order.map((e) => e.franchiseId)).toEqual([...AM.franchiseIds, ...NA.franchiseIds]);
  });

  it('matches the order actually live in MFL', () => {
    // Ground truth: entered by the commissioner on MFL's own Custom Waiver
    // Order page on 2026-08-31 and read back off export?TYPE=league. If this
    // test fails, the builder has drifted from what MFL actually accepts.
    const LIVE_2026 = [
      '0006', '0004', '0003', '0010', '0009', '0012', '0011', '0002', '0005', '0001', '0008', '0007',
      '0021', '0014', '0013', '0023', '0024', '0022', '0016', '0019', '0017', '0020', '0018', '0015',
    ];
    expect(buildAflWaiverOrder([AM, NA]).map((e) => e.franchiseId)).toEqual(LIVE_2026);
  });

  it('preserves each conference base order exactly, and numbers 1..N with no gaps', () => {
    const order = buildAflWaiverOrder([AM, NA]);
    expect(order.map((e) => e.position)).toEqual([...Array(24)].map((_, i) => i + 1));
    for (const conf of [AM, NA]) {
      const seen = order.filter((e) => e.conference === conf.conference).map((e) => e.franchiseId);
      expect(seen).toEqual(conf.franchiseIds);
    }
  });

  it('records each franchise\'s rank within its own conference — the only rank that matters', () => {
    // Cross-conference position is an artifact of MFL's serialization; with
    // per-conference player pools it affects no outcome.
    const order = buildAflWaiverOrder([AM, NA]);
    for (const conf of [AM, NA]) {
      const inConf = order.filter((e) => e.conference === conf.conference);
      expect(inConf.map((e) => e.conferenceBasePosition)).toEqual([...Array(12)].map((_, i) => i + 1));
    }
  });

  it('lands each conference champion last within its own conference', () => {
    const order = buildAflWaiverOrder([AM, NA]);
    const lastOf = (c: string) => order.filter((e) => e.conference === c).at(-1)!.franchiseId;
    expect(lastOf('00')).toBe('0007'); // Avenging Amish
    expect(lastOf('01')).toBe('0015'); // The Mariachi Ninjas
  });

  it('refuses inputs that would produce a wrong-but-plausible order', () => {
    expect(() => buildAflWaiverOrder([AM])).toThrow(/exactly 2 conferences/);
    expect(() => buildAflWaiverOrder([AM, { ...NA, conference: '00' }])).toThrow(/one conference is missing/);
    expect(() =>
      buildAflWaiverOrder([AM, { conference: '01', franchiseIds: NA.franchiseIds.slice(0, 11) }])
    ).toThrow(/same size/);
    expect(() =>
      buildAflWaiverOrder([AM, { conference: '01', franchiseIds: [...NA.franchiseIds.slice(0, 11), '0006'] }])
    ).toThrow(/more than one base-order slot/);
    expect(() =>
      buildAflWaiverOrder([{ conference: '00', franchiseIds: [] }, { conference: '01', franchiseIds: [] }])
    ).toThrow(/empty/);
  });
});

describe('the write payload and URL', () => {
  it('emits one franchise element per slot carrying only id and waiverSortOrder', () => {
    const xml = buildFranchisesWaiverXml(buildAflWaiverOrder([AM, NA]));
    expect(xml).toMatch(/^<franchises>\n/);
    expect(xml).toMatch(/<\/franchises>$/);
    expect(xml.match(/<franchise /g)).toHaveLength(24);
    // Slot 1 is the American League's worst team, not the National League's —
    // conferences serialize as blocks, American first.
    expect(xml).toContain('<franchise id="0006" waiverSortOrder="1" />');
    expect(xml).toContain('<franchise id="0021" waiverSortOrder="13" />');
    expect(xml).not.toMatch(/name=|logo=|icon=|division=/);
  });

  it('emits the bare shape without the wrapper, same rows', () => {
    // MFL's DATA spec is ambiguous and the wrapped form provably no-ops, so the
    // writer tries both. The two shapes must differ ONLY by the wrapper.
    const built = buildAflWaiverOrder([AM, NA]);
    const bare = buildFranchisesWaiverXml(built, 'bare');
    expect(bare).not.toMatch(/<franchises>|<\/franchises>/);
    expect(bare.match(/<franchise /g)).toHaveLength(24);
    expect(buildFranchisesWaiverXml(built, 'wrapped')).toBe(`<franchises>\n${bare}\n</franchises>`);
  });

  it('defaults to the wrapped shape', () => {
    const built = buildAflWaiverOrder([AM, NA]);
    expect(buildFranchisesWaiverXml(built)).toBe(buildFranchisesWaiverXml(built, 'wrapped'));
  });

  it('welds OVERLAY=1 onto the URL — without it MFL erases every unsent franchise field', () => {
    const url = setAflWaiverOrderUrl('www44.myfantasyleague.com', 2026, '19621');
    expect(url).toBe('https://www44.myfantasyleague.com/2026/import?TYPE=franchises&L=19621&OVERLAY=1');
    // There is no parameter that can turn OVERLAY off.
    expect(setAflWaiverOrderUrl('https://www44.myfantasyleague.com', 2026, '19621')).toContain('OVERLAY=1');
  });

  it('rejects the api host, which rejects commissioner imports', () => {
    expect(() => setAflWaiverOrderUrl('api.myfantasyleague.com', 2026, '19621')).toThrow(
      /must target the league's own host/
    );
  });
});

describe('the base order this is built from', () => {
  const league = getLeagueBySlug('afl-fantasy');
  const feeds = path.join(process.cwd(), league.dataPath, 'mfl-feeds', '2025');
  const has = (f: string) => fs.existsSync(path.join(feeds, f));
  // The 2026 draft board is read unconditionally below, so it gates the test too.
  const boardPath = path.join(process.cwd(), league.dataPath, 'mfl-feeds/2026/draftResults.json');
  const ready =
    ['standings.json', 'weekly-results-raw.json', 'playoff-brackets.json'].every(has) &&
    fs.existsSync(boardPath);

  it.runIf(ready)('reproduces MFL\'s real 2026 draft board, so the base order is trustworthy', () => {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(feeds, f), 'utf-8'));
    const cfg = new Map(
      (aflConfig as any).teams.map((t: any) => [
        t.franchiseId,
        { id: t.franchiseId, name: t.name, conference: t.conference, division: t.division },
      ])
    );
    const sd = read('standings.json');
    const standings = Array.isArray(sd.leagueStandings.franchise)
      ? sd.leagueStandings.franchise
      : [sd.leagueStandings.franchise];
    const brackets = read('playoff-brackets.json');
    const orders = calculateAFLDraftOrder(
      standings,
      cfg as any,
      parseConferenceChampions(brackets, cfg as any),
      parseNITResults(brackets, cfg as any),
      buildHeadToHeadFromRaw(read('weekly-results-raw.json'))
    );

    const round = (name: string, n: number) =>
      orders
        .find((o) => o.conference === name)!
        .picks.filter((p: any) => p.round === n)
        .sort((a: any, b: any) => a.pickInRound - b.pickInRound)
        .map((p: any) => p.franchiseId);

    // Round 1 carries the NIT bonus and is what MFL actually drafted — compare
    // against the real board so a regression in the standings chain is caught.
    const actual = JSON.parse(fs.readFileSync(boardPath, 'utf-8'));
    const boardRound1 = (unit: string) =>
      actual.draftResults.draftUnit
        .find((u: any) => u.unit === unit)!
        .draftPick.filter((p: any) => p.round === '01')
        .map((p: any) => p.franchise);
    expect(round('American League', 1)).toEqual(boardRound1('CONFERENCE00'));
    expect(round('National League', 1)).toEqual(boardRound1('CONFERENCE01'));

    // Round 2 is the BASE order (the NIT bonus is round-1 only) — that, not
    // round 1, is what the waiver order is built from.
    expect(round('American League', 2)).toEqual(AM.franchiseIds);
    expect(round('National League', 2)).toEqual(NA.franchiseIds);
  });
});

describe('compareAflWaiverOrder — drift detection', () => {
  const order = buildAflWaiverOrder([AM, NA]);
  /** The live slot map for an order that is exactly right. */
  const slotsFor = (ids: string[]) => new Map(ids.map((id, i) => [id, i + 1]));
  const correct = slotsFor([...AM.franchiseIds, ...NA.franchiseIds]);

  it('reports OK for the order actually live in MFL', () => {
    expect(compareAflWaiverOrder(order, correct).every((r) => r.ok)).toBe(true);
  });

  it('catches MFL\'s reverse-franchise-id default — the exact 2026 bug', () => {
    // What a fresh league year reverts to, and what nobody noticed for months.
    const reverseIds = [...new Set([...AM.franchiseIds, ...NA.franchiseIds])]
      .sort()
      .reverse();
    const results = compareAflWaiverOrder(order, slotsFor(reverseIds));
    expect(results.every((r) => r.ok)).toBe(false);
    expect(results.filter((r) => !r.ok)).toHaveLength(2); // both conferences wrong
  });

  it('catches a single swap inside one conference, and blames only that conference', () => {
    const ids = [...AM.franchiseIds, ...NA.franchiseIds];
    [ids[0], ids[1]] = [ids[1], ids[0]]; // swap the American League's top two
    const results = compareAflWaiverOrder(order, slotsFor(ids));
    expect(results.find((r) => r.conference === '00')!.ok).toBe(false);
    expect(results.find((r) => r.conference === '01')!.ok).toBe(true);
  });

  it('ignores cross-conference renumbering, which affects no outcome', () => {
    // Same order within each conference, but National serialized first. With
    // per-conference player pools this changes nothing, so it is not drift.
    const renumbered = slotsFor([...NA.franchiseIds, ...AM.franchiseIds]);
    expect(compareAflWaiverOrder(order, renumbered).every((r) => r.ok)).toBe(true);
  });

  it('reports a franchise MFL has no slot for, rather than silently reordering', () => {
    const partial = slotsFor([...AM.franchiseIds, ...NA.franchiseIds]);
    partial.delete('0021');
    const na = compareAflWaiverOrder(order, partial).find((r) => r.conference === '01')!;
    expect(na.ok).toBe(false);
    expect(na.missing).toEqual(['0021']);
  });

  it('is deterministic when MFL reports duplicate slots', () => {
    const dupes = new Map([...AM.franchiseIds, ...NA.franchiseIds].map((id) => [id, 1]));
    const a = compareAflWaiverOrder(order, dupes).map((r) => r.actual.join());
    const b = compareAflWaiverOrder(order, dupes).map((r) => r.actual.join());
    expect(a).toEqual(b);
  });
});
