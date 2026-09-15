/**
 * Milestone posts may only be written by a run that COMMITS the feed.
 *
 * Sept 2026: prebuild ran compute-franchise-history on every production deploy,
 * and its Phase 5 prepended milestone posts to the DEPLOYED Schefter feed with
 * the build's timestamp. Three week-1 "season honor" posts were live on
 * theleague.us and existed in no commit — git and production disagreed about
 * the feed, and the only way to remove a post was another deploy.
 *
 * Emission is now opt-in (`--emit-milestone-posts`). This pins both halves:
 * the build path never passes it, and the committing workflows always do — a
 * flag nobody passes would silently kill milestone posts outright, which is the
 * producer/consumer trap in the other direction.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  EMIT_MILESTONE_POSTS_FLAG,
  resolveMilestoneEmission,
} from '../scripts/lib/franchise-milestone-posts.mjs';

const read = (p: string) => readFileSync(p, 'utf8');

describe('resolveMilestoneEmission', () => {
  const enabled = { milestonePosts: true };

  it('does not emit without the flag, even for a league with milestone posts on', () => {
    expect(resolveMilestoneEmission([], enabled).emit).toBe(false);
    expect(resolveMilestoneEmission(['--league=theleague'], enabled).emit).toBe(false);
  });

  it('emits only when the flag is passed', () => {
    expect(resolveMilestoneEmission([EMIT_MILESTONE_POSTS_FLAG], enabled).emit).toBe(true);
  });

  it('never emits for a league whose target disables milestone posts', () => {
    expect(resolveMilestoneEmission([EMIT_MILESTONE_POSTS_FLAG], { milestonePosts: false }).emit).toBe(
      false
    );
  });
});

describe('the build path never writes milestone posts', () => {
  it('no package.json script passes the flag (prebuild resolves steps through them)', () => {
    const { scripts } = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const offenders = Object.entries(scripts).filter(([, cmd]) => cmd.includes(EMIT_MILESTONE_POSTS_FLAG));
    expect(offenders).toEqual([]);
  });

  it('prebuild.mjs does not pass the flag', () => {
    expect(read('scripts/prebuild.mjs')).not.toContain(EMIT_MILESTONE_POSTS_FLAG);
  });

  it('compute-franchise-history gates Phase 5 on the resolver, not on the target alone', () => {
    const src = read('scripts/compute-franchise-history.mjs');
    expect(src).toMatch(/resolveMilestoneEmission\(args, TARGET\)/);
    expect(src).not.toMatch(/if \(!TARGET\.milestonePosts\)/);
  });
});

describe('the committing workflows still write them', () => {
  const computeLines = (workflow: string) =>
    read(workflow)
      .split('\n')
      .filter((l) => /run:.*compute-franchise-history\.mjs/.test(l));

  it.each([
    ['.github/workflows/schefter-trade-speculation.yml', 'src/data/theleague/schefter-feed.json'],
    ['.github/workflows/backfill-historical-feeds.yml', 'src/data/theleague/schefter-feed.json'],
  ])('%s passes the flag and commits the feed it writes', (workflow, feed) => {
    const lines = computeLines(workflow);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain(EMIT_MILESTONE_POSTS_FLAG);
    expect(read(workflow)).toContain(feed);
  });
});
