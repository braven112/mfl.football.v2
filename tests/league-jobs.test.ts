/**
 * Recurring jobs read their league lists from the registry
 * (scripts/lib/league-jobs.mjs), so a launched league joins them on its
 * registry entry alone.
 *
 * Three things are pinned:
 *   1. Today's leagues per job — equal to the hand-kept lists these jobs
 *      carried before, so a predicate edit that drops or adds a league (and
 *      with it a sync, or a Claude bill) fails here first.
 *   2. A registry-only league joins the DATA jobs, and the AI/column jobs only
 *      by checkbox — the owner's rule (Oct 2026).
 *   3. The converted workflows carry no hand-kept league list again.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES, LEAGUES } from '../src/config/leagues-data.mjs';
import { JOB_NAMES, formatLeague, leaguesFor } from '../scripts/lib/league-jobs.mjs';

const ROOT = path.resolve(__dirname, '..');
const slugs = (job: string, leagues: Array<Record<string, any>> = ALL_LEAGUES) =>
  leaguesFor(job, leagues).map((l) => String(l.slug));

describe('today’s leagues per job', () => {
  const expected: Record<string, string[]> = {
    'mfl-sync': ['theleague', 'afl-fantasy', 'archies'],
    'salary-sync': ['theleague'],
    // Archie's joined: the player modal that reads it is shared by every league.
    'fantasy-points-allowed': ['theleague', 'afl-fantasy', 'archies'],
    'player-identity-union': ['theleague', 'afl-fantasy', 'archies'],
    // Rules as configured on MFL — Ask Roger's fallback (src/utils/league-rulebook.ts).
    'mfl-settings-digest': ['theleague', 'afl-fantasy', 'archies'],
    'top-players': ['theleague', 'afl-fantasy'],
    'schedule-draw': ['theleague', 'afl-fantasy'],
    'pecking-order': ['theleague', 'afl-fantasy', 'archies'],
    'owners-poll': ['theleague', 'afl-fantasy'],
    'article:schedule-strength': ['theleague', 'afl-fantasy', 'archies'],
    'article:schedule-release': ['theleague', 'afl-fantasy'],
    'article:weekly': ['theleague'],
  };

  it('covers every job', () => {
    expect(Object.keys(expected).sort()).toEqual([...JOB_NAMES].sort());
  });

  for (const [job, leagues] of Object.entries(expected)) {
    it(job, () => expect(slugs(job)).toEqual(leagues));
  }

  it('never includes best ball (draft-only, no live syncing)', () => {
    for (const job of JOB_NAMES) expect(slugs(job)).not.toContain(LEAGUES['best-ball-1'].slug);
  });
});

describe('a registry-only league', () => {
  // The shape scripts/new-league.mjs writes: no page files, no schedule policy.
  const base = {
    ...LEAGUES.archies,
    id: '70707',
    slug: 'phantom',
    navSlug: 'phantom',
    dataPath: 'data/phantom',
    schefterFeedPath: 'data/phantom/schefter-feed.json',
    articleTypes: [],
    peckingOrder: undefined,
  };
  const off = { ...base, features: { ...base.features, powerRankings: false, schefterFeed: false, salaryCap: false } };
  const on = { ...base, features: { ...base.features, powerRankings: true, schefterFeed: true } };

  it('joins every data job it has the pages for', () => {
    for (const job of ['mfl-sync', 'fantasy-points-allowed', 'player-identity-union']) {
      expect(slugs(job, [off]), job).toEqual(['phantom']);
    }
    // No top-players.astro under src/pages/phantom → nothing would read it.
    expect(slugs('top-players', [off])).toEqual([]);
  });

  it('runs no AI job with its boxes unticked', () => {
    for (const job of ['pecking-order', 'owners-poll', 'article:schedule-strength', 'article:schedule-release', 'article:weekly']) {
      expect(slugs(job, [off]), job).toEqual([]);
    }
  });

  it('runs the Pecking Order once its box is ticked, and only the article types it lists', () => {
    expect(slugs('pecking-order', [on])).toEqual(['phantom']);
    // articleTypes: [] → no weekly article types bought yet.
    expect(slugs('article:schedule-strength', [on])).toEqual([]);
    expect(slugs('article:weekly', [on])).toEqual([]);
  });
});

describe('the CLI', () => {
  const cli = (...args: string[]) =>
    execFileSync('node', ['scripts/league-jobs.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });

  it('formats fields, features and the default flag', () => {
    expect(cli('mfl-sync', '--format', '{navSlug}:{features.salaryCap}:{default}').trim().split('\n')).toEqual([
      'theleague:true:true',
      'afl:false:false',
      'archies:false:false',
    ]);
  });

  it('fails loudly on an unknown job or field rather than printing nothing', () => {
    expect(() => cli('no-such-job')).toThrow();
    expect(() => cli('mfl-sync', '--format', '{nope}')).toThrow();
    expect(() => formatLeague('{schefter}', LEAGUES.theleague)).toThrow(/not a scalar/);
  });
});

describe('converted workflows carry no hand-kept league list', () => {
  const WORKFLOWS = ['roster-sync', 'weekly-stats-sync', 'schedule-release', 'schefter-articles'];
  const leagueWords = ALL_LEAGUES.flatMap((l) => [l.slug, l.navSlug]);

  for (const name of WORKFLOWS) {
    it(name, () => {
      const src = readFileSync(path.join(ROOT, '.github/workflows', `${name}.yml`), 'utf8');
      expect(src).toMatch(/league-jobs\.mjs/);
      const code = src.split('\n').filter((line) => !/^\s*#/.test(line));
      for (const line of code) {
        // A `for X in a b c` over league names, or a `--league <name>` literal.
        const loop = line.match(/\bfor \w+ in ([^;]+)/)?.[1] ?? '';
        const offenders = leagueWords.filter(
          (w) => new RegExp(`(^|\\s)${w}(\\s|$)`).test(loop) || new RegExp(`--league[ =]"?${w}\\b`).test(line),
        );
        expect(offenders, `${name}.yml: ${line.trim()}`).toEqual([]);
      }
    });
  }
});
