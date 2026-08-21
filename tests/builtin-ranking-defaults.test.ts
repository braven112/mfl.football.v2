import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LEAGUES,
  defaultRankingSourcesFor,
  DEFAULT_RANKING_SOURCES_FALLBACK,
} from '../src/config/leagues-data.mjs';
import { SOURCE_LABELS, SOURCE_ABBREVS } from '../src/utils/rankings-lookup';

/**
 * Built-in ranking sources are AVAILABLE in every league; only which ones are
 * ticked into "My Rank" by default varies. These pin the two halves that go
 * wrong silently: a default naming a source that doesn't exist (it just never
 * ticks, with no error), and a default that contradicts how the league drafts.
 */
describe('per-league default ranking sources', () => {
  const snapshot = JSON.parse(
    readFileSync('data/ranking-sources/2026.json', 'utf8'),
  ) as { sources: { id: string; type: string }[] };
  const available = new Map(snapshot.sources.map((s) => [s.id, s.type]));

  it('the snapshot carries every source the UI offers', () => {
    expect([...available.keys()].sort()).toEqual([
      'espn',
      'espn-superflex',
      'fantasycalc',
      'mfl-adp',
      'sharks',
      'sleeper-adp',
    ]);
  });

  it('every league default names a source that actually exists', () => {
    // A typo here is invisible at runtime — syncBuiltinImports simply never
    // matches it, and the league quietly starts with a thinner composite.
    for (const slug of Object.keys(LEAGUES)) {
      for (const id of defaultRankingSourcesFor(slug)) {
        expect(available.has(id), `${slug} defaults to unknown source '${id}'`).toBe(true);
      }
    }
  });

  it('a redraft/keeper league does not default to dynasty values', () => {
    // The AFL re-drafts most of its roster every year, so dynasty trade values
    // are the wrong opening board — they overrate youth on a one-season
    // horizon. FantasyCalc stays AVAILABLE, just not on by default.
    const aflDefaults = defaultRankingSourcesFor('afl-fantasy');
    const dynastyDefaults = aflDefaults.filter((id) => available.get(id) === 'dynasty');
    expect(dynastyDefaults).toEqual([]);
  });

  it('the dynasty league defaults to a dynasty source', () => {
    const defaults = defaultRankingSourcesFor('theleague');
    expect(defaults.some((id) => available.get(id) === 'dynasty')).toBe(true);
  });

  it('superflex is available everywhere but default nowhere', () => {
    // A 2QB board is wrong for every league here; it exists so an owner can
    // opt in, not as a starting point.
    expect(available.has('espn-superflex')).toBe(true);
    for (const slug of Object.keys(LEAGUES)) {
      expect(defaultRankingSourcesFor(slug)).not.toContain('espn-superflex');
    }
  });

  it('an unknown league falls back rather than throwing', () => {
    expect(defaultRankingSourcesFor('not-a-league')).toEqual(DEFAULT_RANKING_SOURCES_FALLBACK);
    for (const id of DEFAULT_RANKING_SOURCES_FALLBACK) {
      expect(available.has(id)).toBe(true);
    }
  });

  it('every snapshot source has a display label and abbreviation', () => {
    // Without this the table renders the raw id — 'sleeper-adp' and
    // 'espn-superflex' both shipped to the preview that way, because adding a
    // source to the fetch script and labelling it are two separate edits and
    // nothing connected them.
    for (const id of available.keys()) {
      expect(SOURCE_LABELS[id as keyof typeof SOURCE_LABELS], `no label for '${id}'`).toBeTruthy();
      expect(
        SOURCE_ABBREVS[id as keyof typeof SOURCE_ABBREVS],
        `no abbreviation for '${id}'`,
      ).toBeTruthy();
    }
  });

  it('labels are distinct enough to tell two variants apart', () => {
    // ESPN and ESPN Superflex are different boards; identical labels would
    // make the two rows indistinguishable in the table.
    const labels = [...available.keys()].map(
      (id) => SOURCE_LABELS[id as keyof typeof SOURCE_LABELS],
    );
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('no built-in source is typed "overall"', () => {
    // 'overall' is not a ranking type — it's the bookmarklet parser's fallback
    // for an import it can't classify, and the type of the synthetic composite
    // column. A real source carrying it renders a meaningless badge; Sharks
    // shipped that way (its ranks are season-long redraft).
    for (const [id, type] of available) {
      expect(type, `source '${id}' is typed 'overall'`).not.toBe('overall');
    }
  });

  it('every built-in type is one the table can badge', () => {
    for (const [id, type] of available) {
      expect(['dynasty', 'redraft', 'adp'], `source '${id}'`).toContain(type);
    }
  });
});
