/**
 * AFL waiver order — the merge rule and the safety rails on the write.
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
 * previous season". The base order is per-conference (two 12-team orders) and
 * the waiver order is one list of 24, so the merge is an interpretation —
 * commissioner's ruling 2026-08-31 was strict alternation, led by the
 * conference holding the league's worst team. These tests pin that ruling.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAflWaiverOrder,
  buildFranchisesWaiverXml,
  setAflWaiverOrderUrl,
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

describe('buildAflWaiverOrder — the merge rule', () => {
  it('alternates conferences, led by the conference holding the worst team', () => {
    // 0014 is the National League's, so National takes every odd slot.
    const order = buildAflWaiverOrder([AM, NA], '0014');
    expect(order.map((e) => e.conference)).toEqual(
      [...Array(12)].flatMap(() => ['01', '00'])
    );
    expect(order[0]).toMatchObject({ position: 1, franchiseId: '0021', conference: '01' });
    expect(order[1]).toMatchObject({ position: 2, franchiseId: '0006', conference: '00' });
    expect(order[23]).toMatchObject({ position: 24, franchiseId: '0007', conference: '00' });
  });

  it('leads with the other conference when the worst team belongs to it', () => {
    const order = buildAflWaiverOrder([AM, NA], '0006');
    expect(order[0].franchiseId).toBe('0006');
    expect(order[1].franchiseId).toBe('0021');
  });

  it('is order-of-argument independent — only the lead franchise decides', () => {
    const a = buildAflWaiverOrder([AM, NA], '0014');
    const b = buildAflWaiverOrder([NA, AM], '0014');
    expect(b.map((e) => e.franchiseId)).toEqual(a.map((e) => e.franchiseId));
  });

  it('preserves each conference base order exactly, and numbers 1..N with no gaps', () => {
    const order = buildAflWaiverOrder([AM, NA], '0014');
    expect(order.map((e) => e.position)).toEqual([...Array(24)].map((_, i) => i + 1));
    for (const conf of [AM, NA]) {
      const seen = order.filter((e) => e.conference === conf.conference).map((e) => e.franchiseId);
      expect(seen).toEqual(conf.franchiseIds);
    }
  });

  it('gives each conference exactly half the slots', () => {
    const order = buildAflWaiverOrder([AM, NA], '0014');
    expect(order.filter((e) => e.conference === '00')).toHaveLength(12);
    expect(order.filter((e) => e.conference === '01')).toHaveLength(12);
  });

  it('lands both conference champions in the last two slots', () => {
    // Each champion is forced to its own conference's last base slot, so
    // alternation necessarily puts them at 23 and 24.
    const order = buildAflWaiverOrder([AM, NA], '0014');
    expect(order.slice(22).map((e) => e.franchiseId).sort()).toEqual(['0007', '0015']);
  });

  it('refuses inputs that would produce a wrong-but-plausible order', () => {
    expect(() => buildAflWaiverOrder([AM], '0006')).toThrow(/exactly 2 conferences/);
    expect(() =>
      buildAflWaiverOrder([AM, { conference: '01', franchiseIds: NA.franchiseIds.slice(0, 11) }], '0006')
    ).toThrow(/same size/);
    expect(() => buildAflWaiverOrder([AM, NA], '9999')).toThrow(/not in either conference/);
    expect(() =>
      buildAflWaiverOrder([AM, { conference: '01', franchiseIds: [...NA.franchiseIds.slice(0, 11), '0006'] }], '0006')
    ).toThrow(/more than one base-order slot/);
    expect(() =>
      buildAflWaiverOrder([{ conference: '00', franchiseIds: [] }, { conference: '01', franchiseIds: [] }], '0006')
    ).toThrow(/empty/);
    expect(() =>
      buildAflWaiverOrder([AM, { ...NA, conference: '00' }], '0006')
    ).toThrow(/one conference is missing/);
  });
});

describe('the write payload and URL', () => {
  it('emits one franchise element per slot carrying only id and waiverSortOrder', () => {
    const xml = buildFranchisesWaiverXml(buildAflWaiverOrder([AM, NA], '0014'));
    expect(xml).toMatch(/^<franchises>\n/);
    expect(xml).toMatch(/<\/franchises>$/);
    expect(xml.match(/<franchise /g)).toHaveLength(24);
    expect(xml).toContain('<franchise id="0021" waiverSortOrder="1" />');
    expect(xml).not.toMatch(/name=|logo=|icon=|division=/);
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
