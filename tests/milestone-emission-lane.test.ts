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
import { chainOutputs } from '../scripts/recompute-derived-chain.mjs';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

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

/**
 * Committing workflows reach the producer through recompute-derived-chain.mjs,
 * which commits the snapshot together with the files derived from it
 * (tests/derived-chain-lane.test.ts pins that no workflow calls it directly).
 * Every such run commits the snapshot, so every one must post its awards.
 */
describe('the committing workflows still write them', () => {
  const chainRunLines = (workflow: string) =>
    read(workflow)
      .split('\n')
      .filter((l) => /run:.*recompute-derived-chain\.mjs/.test(l) && !/--print-/.test(l));

  it.each([
    '.github/workflows/derived-history-chain.yml',
    '.github/workflows/backfill-historical-feeds.yml',
    '.github/workflows/fetch-owner-names.yml',
  ])('%s passes the flag and commits the chain outputs, feed included', (workflow) => {
    const lines = chainRunLines(workflow);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain(EMIT_MILESTONE_POSTS_FLAG);
    expect(read(workflow)).toMatch(/recompute-derived-chain\.mjs --print-outputs/);
  });

  it('the chain outputs include the feed milestone posts are written to', () => {
    const theleague = (ALL_LEAGUES as { slug: string; schefterFeedPath: string }[]).find(
      (l) => l.slug === 'theleague'
    )!;
    expect(chainOutputs()).toContain(theleague.schefterFeedPath);
  });

  it('the speculation job no longer commits the snapshot it stopped computing', () => {
    expect(read('.github/workflows/schefter-trade-speculation.yml')).not.toMatch(
      /compute-franchise-history|franchise-history\.json/
    );
  });
});
