/**
 * ?demo=live — real current rosters paired with a live NFL slate.
 *
 * MFL serves nothing before the season starts: `liveScoring` answers
 * "Live scoring not available until the season starts", and week 1's
 * `weeklyResults` comes back with the matchups but EMPTY starters, because no
 * owner has submitted a lineup. So the only way to put real rostered players in
 * front of a game that is actually being played is to build the board from the
 * rosters on disk. This checks that what comes out is genuinely real — real
 * franchises, real players, real pairings — and that it does not invent the one
 * thing it cannot know: fantasy scoring.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCurrentRosterSample } from '../src/data/live-scoring-sample';
import { getLeagueYearForSlug } from '../src/utils/league-year';

const readJson = (p: string): any => {
  try { return JSON.parse(readFileSync(join(process.cwd(), p), 'utf-8')); } catch { return null; }
};

const LEAGUES = [
  { slug: 'theleague', dataPath: 'data/theleague' },
  { slug: 'afl-fantasy', dataPath: 'data/afl-fantasy' },
];

describe.each(LEAGUES)('getCurrentRosterSample — $slug', ({ slug, dataPath }) => {
  const year = getLeagueYearForSlug(slug);
  const sample = getCurrentRosterSample({ slug, year });
  const rosters = readJson(`${dataPath}/mfl-feeds/${year}/rosters.json`)?.rosters?.franchise ?? [];
  const rosteredByFid = new Map<string, Set<string>>(
    rosters.map((f: any) => [
      String(f.id),
      new Set((Array.isArray(f.player) ? f.player : [f.player]).filter(Boolean).map((p: any) => String(p.id))),
    ]),
  );

  it('builds a board from the real week-1 schedule', () => {
    expect(sample.matchups.length).toBeGreaterThan(0);
    const scheduled = readJson(`${dataPath}/mfl-feeds/${year}/schedule.json`)?.schedule;
    const weeks = Array.isArray(scheduled?.weeklySchedule) ? scheduled.weeklySchedule : [scheduled?.weeklySchedule];
    const week1 = weeks.find((w: any) => String(w?.week) === '1');
    const expected = (Array.isArray(week1?.matchup) ? week1.matchup : []).length;
    expect(sample.matchups.length).toBe(expected);
  });

  it('starts only players the franchise actually rosters', () => {
    // The whole promise of this mode. A starter who is not on the roster would
    // make it a fabrication wearing real team names.
    const wrong: string[] = [];
    for (const [fid, rows] of Object.entries(sample.players)) {
      const owned = rosteredByFid.get(fid);
      for (const r of rows) if (!owned?.has(r.id)) wrong.push(`${fid}:${r.id}`);
    }
    expect(wrong, 'starters not on their franchise roster').toEqual([]);
  });

  it('never breaks the league’s own position limits', () => {
    // The real constraint, and the reason a lineup can come up short: AFL 0004
    // rosters TWO quarterbacks against a 1-QB limit, so only 6 of its 7 keepers
    // can legally start. Fielding 7 there would be the bug.
    const cfg = readJson(`${dataPath}/mfl-feeds/${year}/league.json`)?.league?.starters;
    const total = Number(cfg?.count) || 9;
    const maxByPos = new Map<string, number>();
    for (const row of (Array.isArray(cfg?.position) ? cfg.position : [])) {
      const name = String(row?.name ?? '') === 'Def' ? 'DEF' : String(row?.name ?? '').toUpperCase();
      const limit = String(row?.limit ?? '');
      maxByPos.set(name, Number(limit.split('-')[1] ?? limit) || 0);
    }

    const fids = new Set(sample.matchups.flatMap((m) => [m.home, m.away]));
    expect(fids.size).toBeGreaterThan(0);
    for (const fid of fids) {
      const rows = sample.players[fid] ?? [];
      expect(rows.length, `${fid} exceeds the league starter count`).toBeLessThanOrEqual(total);
      const byPos = new Map<string, number>();
      for (const r of rows) {
        const pos = sample.playerMeta[r.id]?.position ?? '?';
        byPos.set(pos, (byPos.get(pos) ?? 0) + 1);
      }
      for (const [pos, used] of byPos) {
        expect(used, `${fid} starts ${used} at ${pos}`).toBeLessThanOrEqual(maxByPos.get(pos) ?? total);
      }
    }
  });

  it('gives every starter resolvable identity — name and NFL team', () => {
    const ids = Object.values(sample.players).flat().map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const meta = sample.playerMeta[id];
      expect(meta, `no meta for ${id}`).toBeTruthy();
      expect(meta.name).not.toBe('');
      expect(meta.name).not.toBe('Unknown Player');
      expect(meta.nflTeam, `${meta.name} has no NFL team`).toMatch(/^[A-Z]{2,3}$/);
    }
  });

  it('does not duplicate a player within one franchise’s lineup', () => {
    for (const [fid, rows] of Object.entries(sample.players)) {
      const ids = rows.map((r) => r.id);
      expect(new Set(ids).size, `${fid} has a repeated starter`).toBe(ids.length);
    }
  });

  it('INVENTS NO SCORING — MFL has none for a season that has not started', () => {
    // Turning ESPN yards into fantasy points needs each league's own scoring
    // rules, which we do not model. An honest zero beats a plausible fake, the
    // same call made for DEF/ST stat lines.
    expect(Object.values(sample.scores).every((v) => v === 0)).toBe(true);
    expect(Object.values(sample.players).flat().every((r) => r.live === 0)).toBe(true);
    expect(Object.values(sample.playerMeta).every((m) => m.projected === 0)).toBe(true);
  });

  it('presents the week as UNPLAYED, never as final', () => {
    // secondsRemaining 0 makes every downstream consumer read "final", and the
    // matchup header rendered FINAL over 0.0-0.0 — which claims the game ended
    // scoreless rather than that it has not started.
    const rows = Object.values(sample.players).flat();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.secondsRemaining > 0)).toBe(true);
    for (const [fid, list] of Object.entries(sample.players)) {
      expect(sample.remaining[fid], `${fid} remaining`).toBeGreaterThan(0);
      expect(sample.playersYetToPlay[fid], `${fid} yet to play`).toBe(list.length);
    }
  });

  it('ships no NFL games of its own — the live poller supplies the real slate', () => {
    expect(sample.nflGames).toEqual([]);
    expect(sample.detail).toEqual({ boxScore: {}, plays: [] });
  });
});

describe('getCurrentRosterSample — a deep roster fills the board', () => {
  it('theleague fields a full lineup for every franchise', () => {
    // 21-25 players per roster, so nothing here has an excuse to come up short.
    const slug = 'theleague';
    const year = getLeagueYearForSlug(slug);
    const sample = getCurrentRosterSample({ slug, year });
    const total = Number(readJson(`data/theleague/mfl-feeds/${year}/league.json`)?.league?.starters?.count) || 9;
    const fids = new Set(sample.matchups.flatMap((m) => [m.home, m.away]));
    for (const fid of fids) expect(sample.players[fid]?.length, fid).toBe(total);
  });
});

describe('getCurrentRosterSample — degradation', () => {
  it('returns an empty board rather than throwing for an unknown league', () => {
    const out = getCurrentRosterSample({ slug: 'nope', year: 2026 });
    expect(out.matchups).toEqual([]);
    expect(out.players).toEqual({});
  });

  it('returns an empty board for a year with no feeds on disk', () => {
    const out = getCurrentRosterSample({ slug: 'theleague', year: 1999 });
    expect(out.matchups).toEqual([]);
  });
});
