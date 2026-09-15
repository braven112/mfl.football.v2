/**
 * Runs the REAL compute-franchise-history.mjs against the committed feeds, with
 * every write re-rooted into a temp directory (`--output-root`).
 *
 * Two things only the producer itself can prove (Copilot, PR #1093):
 *
 * 1. The milestone write policy. tests/milestone-emission-lane.test.ts scans
 *    source; it would stay green if Phase 5 ignored the resolver and wrote the
 *    feed anyway. Here both runs get byte-identical inputs — a previous snapshot
 *    with every badge stripped, so every award is "new", and a feed with no
 *    posts — and only the flag differs.
 * 2. The season-complete wiring. tests/badges-season-complete.test.ts feeds
 *    `seasonComplete` in by hand, and the committed-snapshot data test skips
 *    until a post-#1090 snapshot is committed. This reads what the producer
 *    actually emits today.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isSeasonComplete } from '../scripts/lib/theleague-season-complete.mjs';
import { EMIT_MILESTONE_POSTS_FLAG } from '../scripts/lib/franchise-milestone-posts.mjs';

const SNAPSHOT = 'data/theleague/derived/franchise-history.json';
const FEED = 'src/data/theleague/schefter-feed.json';

type Award = { year?: number };
type Badge = { id: string; tier: string; awards: Award[] };
type Snapshot = {
  generatedAt: string;
  yearSummaries: { year: number; champion: string | null; seasonComplete?: unknown }[];
  franchises: Record<string, { badges?: Badge[] }>;
};

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const roots: string[] = [];

const run = (extraArgs: string[]) => {
  const root = mkdtempSync(join(tmpdir(), 'franchise-history-producer-'));
  roots.push(root);

  const previous = readJson(SNAPSHOT) as Snapshot;
  for (const fr of Object.values(previous.franchises)) fr.badges = [];
  mkdirSync(join(root, 'data/theleague/derived'), { recursive: true });
  writeFileSync(join(root, SNAPSHOT), JSON.stringify(previous));

  mkdirSync(join(root, 'src/data/theleague'), { recursive: true });
  const seededFeed = JSON.stringify({ ...readJson(FEED), posts: [] }, null, 2) + '\n';
  writeFileSync(join(root, FEED), seededFeed);

  const log = execFileSync(
    process.execPath,
    ['scripts/compute-franchise-history.mjs', `--output-root=${root}`, ...extraArgs],
    { encoding: 'utf8' }
  );

  return {
    log,
    seededFeed,
    feedAfter: readFileSync(join(root, FEED), 'utf8'),
    output: readJson(join(root, SNAPSHOT)) as Snapshot,
  };
};

let plain: ReturnType<typeof run>;
let emitting: ReturnType<typeof run>;

beforeAll(() => {
  plain = run([]);
  emitting = run([EMIT_MILESTONE_POSTS_FLAG]);
}, 60_000);

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('milestone write policy, observed on the real producer', () => {
  it('leaves the feed byte-identical without the flag, even with every award new', () => {
    expect(plain.feedAfter).toBe(plain.seededFeed);
    expect(plain.log).toContain('milestone posts not requested');
  });

  it('writes milestone posts with the flag, from the same inputs', () => {
    const posts = JSON.parse(emitting.feedAfter).posts as { id: string }[];
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.id.startsWith('sf_milestone_'))).toBe(true);
  });

  it('never writes the committed files', () => {
    expect(plain.log).not.toContain(join(process.cwd(), SNAPSHOT));
  });
});

describe('the producer writes the season-complete gate it is judged by', () => {
  it('every year summary carries the isSeasonComplete verdict as a boolean', () => {
    const producedIn = new Date(plain.output.generatedAt).getFullYear();
    const wrong = plain.output.yearSummaries
      .filter(
        (y) =>
          typeof y.seasonComplete !== 'boolean' ||
          y.seasonComplete !== isSeasonComplete(y.year, { champion: y.champion }, producedIn)
      )
      .map((y) => y.year);
    expect(plain.output.yearSummaries.length).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });

  it('awards no single-season badge for a season its own summary calls unfinished', () => {
    const incomplete = new Set(
      plain.output.yearSummaries.filter((y) => y.seasonComplete === false).map((y) => y.year)
    );
    const offenders = Object.entries(plain.output.franchises).flatMap(([fid, fr]) =>
      (fr.badges ?? [])
        .filter((b) => b.tier === 'season')
        .flatMap((b) => b.awards.filter((a) => a.year != null && incomplete.has(a.year)))
        .map((a) => `${fid}:${a.year}`)
    );
    expect(offenders).toEqual([]);
  });
});
