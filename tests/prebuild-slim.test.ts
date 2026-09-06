/**
 * Guards prebuild's preview-slim decision.
 *
 * Two rules worth pinning mechanically, both of which have already been wrong
 * once in this file's short life:
 *
 * 1. The watched-file set is DERIVED from the step list, not hand-written. The
 *    first version used a path-prefix list (`scripts/(lib/|compute-|fetch-)`)
 *    which did not match `scripts/prebuild.mjs` itself, so a PR editing the
 *    orchestrator previewed against stale derived files. A renamed package
 *    script must not be able to drop silently out of the set.
 * 2. Every uncertain case resolves to FULL. Slim is only ever an optimization;
 *    the moment the decision is unclear it must run everything.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  pipelineScripts,
  isPipelineFile,
  resolveSlimReason,
  changedVsMain,
} from '../scripts/prebuild.mjs';

const preview = (overrides: Record<string, string> = {}) => ({
  VERCEL_ENV: 'preview',
  ...overrides,
});

describe('the watched set is derived, not hand-listed', () => {
  it('includes the orchestrator itself', () => {
    // The exact miss that shipped in the first version.
    expect(pipelineScripts().has('scripts/prebuild.mjs')).toBe(true);
    expect(isPipelineFile('scripts/prebuild.mjs')).toBe(true);
  });

  it('resolves every previewSkip step to a real script path', () => {
    const scripts = pipelineScripts();
    expect(scripts.size).toBeGreaterThan(10);
    for (const file of scripts) {
      expect(file).toMatch(/^scripts\/[\w./-]+\.mjs$/);
      expect(() => readFileSync(file, 'utf8')).not.toThrow();
    }
  });

  it('covers the src/ modules the compute steps import their logic from', () => {
    // These are imported by compute-owner-tenures / -division-strength /
    // -franchise-history; editing one changes the derived output while the
    // scripts themselves are untouched.
    for (const file of [
      'src/utils/owner-tenures.mjs',
      'src/utils/division-strength.mjs',
      'src/utils/playoff-entry-brackets.mjs',
      'src/config/leagues-data.mjs',
    ]) {
      expect(isPipelineFile(file)).toBe(true);
    }
  });

  it('covers scripts/lib/, which every step imports from', () => {
    expect(isPipelineFile('scripts/lib/roster-season-payload.mjs')).toBe(true);
  });

  it('does NOT treat page code as pipeline code', () => {
    // .astro/.ts cannot reach a derived file; if they counted, slim would
    // never engage and the whole optimization would be dead weight.
    for (const file of [
      'src/pages/index.astro',
      'src/pages/theleague/rosters.astro',
      'src/utils/auth.ts',
      'src/components/shared/LiveScoreboard.tsx',
      'public/robots.txt',
    ]) {
      expect(isPipelineFile(file)).toBe(false);
    }
  });
});

describe('slim only when everything is certain', () => {
  it('slims a preview whose diff touches no pipeline file', () => {
    expect(resolveSlimReason(preview(), ['src/pages/index.astro'])).toBeTruthy();
  });

  it.each([
    ['production', { VERCEL_ENV: 'production' }, ['README.md']],
    ['no VERCEL_ENV at all', {}, ['README.md']],
    ['PREBUILD_FULL=1', preview({ PREBUILD_FULL: '1' }), ['README.md']],
  ])('runs FULL for %s', (_label, env, changed) => {
    expect(resolveSlimReason(env, changed)).toBeNull();
  });

  it('runs FULL when the diff cannot be resolved', () => {
    // changedVsMain returns null on a shallow clone with no reachable main.
    expect(resolveSlimReason(preview(), null)).toBeNull();
  });

  it.each([
    'scripts/prebuild.mjs',
    'scripts/compute-owner-tenures.mjs',
    'scripts/lib/roster-season-payload.mjs',
    'src/utils/owner-tenures.mjs',
    'src/config/leagues-data.mjs',
  ])('runs FULL when the diff touches %s', (file) => {
    expect(resolveSlimReason(preview(), ['README.md', file])).toBeNull();
  });
});

describe('changedVsMain fails to null rather than to an empty diff', () => {
  it('returns null when git cannot answer', () => {
    // An empty array would read as "nothing changed" and slim the build.
    const boom = () => {
      throw new Error('not a git repository');
    };
    expect(changedVsMain(boom as unknown as typeof import('child_process').execSync)).toBeNull();
  });
});
