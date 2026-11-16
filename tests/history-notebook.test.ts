/**
 * Buck's Notebook (src/utils/league-history/notebook.mjs): the Tuesday
 * history facts. Brandon, 2026-11-16: something new each week, random and
 * unique for each league, every number checked by code.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runQuery } from '../src/utils/league-history/ask-query.mjs';
import { buildNotebook, FACT_KEYS, factId, MIN_SEASONS, notebookText } from '../src/utils/league-history/notebook.mjs';

const load = (league: string, file: string) =>
  JSON.parse(readFileSync(new URL(`../data/${league}/derived/${file}`, import.meta.url), 'utf8'));

const ds = load('theleague', 'league-history.json');
const players = load('theleague', 'league-history-players.json');
const base = { ds, players, league: 'theleague', year: 2026 };

describe("Buck's Notebook", () => {
  it('draws the same issue for the same league and week', () => {
    const a = buildNotebook({ ...base, week: 12, games: 11 });
    const b = buildNotebook({ ...base, week: 12, games: 11 });
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it('draws a different mix for another league', () => {
    const differs = [5, 8, 11, 14].some((week) => {
      const ours = buildNotebook({ ...base, week, games: week - 1 })?.facts.map((f) => f.id);
      const theirs = buildNotebook({ ...base, league: 'afl-fantasy', week, games: week - 1 })?.facts.map((f) => f.id);
      return JSON.stringify(ours) !== JSON.stringify(theirs);
    });
    expect(differs).toBe(true);
  });

  it('never repeats a fact within a season, and varies how many it carries', () => {
    const earlier: Array<{ factIds: string[]; keys: string[] }> = [];
    const counts = new Set<number>();
    for (let week = 2; week <= 15; week++) {
      const nb = buildNotebook({ ...base, week, games: week - 1, earlier });
      if (!nb) continue;
      counts.add(nb.facts.length);
      for (const f of nb.facts) {
        expect(earlier.flatMap((i) => i.factIds)).not.toContain(f.id);
        expect(FACT_KEYS).toContain(f.key);
      }
      earlier.unshift({ factIds: nb.facts.map((f) => f.id), keys: nb.facts.map((f) => f.key) });
    }
    expect(earlier.length).toBeGreaterThan(10);
    expect(counts.size).toBeGreaterThan(1);
  });

  it("quotes the engine's own number for the week's high score", () => {
    const top = runQuery(ds, {
      unit: 'games',
      where: [{ field: 'week', op: 'eq', value: 12 }],
      sort: [{ field: 'score', dir: 'desc' }],
      columns: ['score', 'team', 'year'],
      limit: 1,
    }).rows[0].cells;
    const score = Number(top[0]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Every league-week issue that draws the fact says that number, and no other score.
    let seen = 0;
    for (const league of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      const fact = buildNotebook({ ...base, league, week: 12, games: 11 })?.facts.find((f) => f.key === 'week-high');
      if (!fact) continue;
      seen++;
      expect(fact.text).toContain(score);
      expect(fact.text).toContain(String(top[1]));
      expect(fact.text).toContain(String(top[2]));
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('leaves out the player facts for a league with no player data', () => {
    for (let week = 2; week <= 15; week++) {
      const nb = buildNotebook({ ...base, players: null, week, games: week - 1 });
      for (const f of nb?.facts ?? []) expect(f.key).not.toMatch(/player|position/);
    }
  });

  it('says nothing for a league with too little history', () => {
    const young = { ...ds, seasons: ds.seasons.slice(-(MIN_SEASONS - 1)) };
    expect(buildNotebook({ ...base, ds: young, week: 12, games: 11 })).toBeNull();
  });

  it('remembers a week fact by week and a start fact by games played', () => {
    expect(factId('week-high', { week: 12, games: 11 })).toBe('week-high@w12');
    expect(factId('start-best', { week: 12, games: 11 })).toBe('start-best@g11');
  });

  it('writes one fact as a sentence and several as a list', () => {
    const one = notebookText({ opener: 'From the vault:', facts: [{ key: 'week-high', id: 'x', text: 'A.' }] }, { week: 3 });
    expect(one).toEqual({ headline: "Buck's Notebook: Week 3", body: 'From the vault:\n\nA.' });
    const many = notebookText(
      { opener: 'From the vault:', facts: [{ key: 'a', id: 'a', text: 'A.' }, { key: 'b', id: 'b', text: 'B.' }] },
      { week: 3 },
    );
    expect(many.body).toBe('From the vault:\n\n• A.\n• B.');
  });
});
