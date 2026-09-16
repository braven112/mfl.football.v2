/**
 * The franchise-history derived chain is committed whole, by one script.
 *
 * franchise-history.json + season-ledger.json -> owner-tenures.json ->
 * division-strength.json. Their data tests demand row-for-row agreement, so a
 * commit carrying part of a regenerated chain breaks main. Sept 2026: the
 * Schefter nightly committed TheLeague's history without its ledger,
 * fetch-owner-names committed tenures + division strength against a stale
 * ledger, and nothing committed the AFL's history, all while roster-sync
 * committed the schedules division strength replays. Verified that week:
 * regenerating the whole chain passes every guard suite, regenerating any
 * prefix of it fails one.
 *
 * scripts/recompute-derived-chain.mjs owns the order, the file list and the
 * guard suites. This pins the script, and pins every workflow to it.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { EMIT_MILESTONE_POSTS_FLAG } from '../scripts/lib/franchise-milestone-posts.mjs';
import {
  CHAIN_FILES,
  CHAIN_GUARD_TESTS,
  chainDerivedFiles,
  chainLeagues,
  chainOutputs,
  chainSteps,
  isTimestampOnlyChange,
} from '../scripts/recompute-derived-chain.mjs';

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');

const slugs = (leagues: any[]) => leagues.map((l) => l.slug);

describe('the chain script', () => {
  it('covers every league with a franchise history, and no other', () => {
    const expected = (ALL_LEAGUES as any[]).filter((l) =>
      existsSync(path.join(ROOT, l.dataPath, 'derived', 'franchise-history.json'))
    );
    expect(slugs(chainLeagues())).toEqual(slugs(expected));
    // Both full-management leagues; best-ball excluded structurally.
    expect(slugs(chainLeagues())).toEqual(expect.arrayContaining(['theleague', 'afl-fantasy']));
    expect(slugs(chainLeagues())).not.toContain('best-ball-1');
  });

  it('runs every league history before owner tenures, and tenures before division strength', () => {
    const scripts = chainSteps().map((s) => s.script);
    const lastHistory = scripts.lastIndexOf('scripts/compute-franchise-history.mjs');
    const tenures = scripts.indexOf('scripts/compute-owner-tenures.mjs');
    const division = scripts.indexOf('scripts/compute-division-strength.mjs');
    expect(scripts.filter((s) => s === 'scripts/compute-franchise-history.mjs')).toHaveLength(
      chainLeagues().length
    );
    expect(lastHistory).toBeLessThan(tenures);
    expect(tenures).toBeLessThan(division);
    expect(division).toBe(scripts.length - 1);
  });

  it('forwards the milestone flag to the history runs only, and only when asked', () => {
    for (const step of chainSteps()) expect(step.args).not.toContain(EMIT_MILESTONE_POSTS_FLAG);
    for (const step of chainSteps({ emitMilestonePosts: true })) {
      const isHistory = step.script === 'scripts/compute-franchise-history.mjs';
      expect(step.args.includes(EMIT_MILESTONE_POSTS_FLAG), step.label).toBe(isHistory);
    }
  });

  it('lists every chain file of every league, and each one exists', () => {
    const files = chainDerivedFiles();
    expect(files).toHaveLength(chainLeagues().length * CHAIN_FILES.length);
    for (const league of chainLeagues() as any[]) {
      for (const file of CHAIN_FILES) {
        const rel = path.posix.join(league.dataPath, 'derived', file);
        expect(files).toContain(rel);
        expect(existsSync(path.join(ROOT, rel)), rel).toBe(true);
      }
    }
  });

  it('commits the feed milestone posts are written to, beside the snapshot', () => {
    const theleague = (ALL_LEAGUES as any[]).find((l) => l.slug === 'theleague');
    expect(chainOutputs()).toContain(theleague.schefterFeedPath);
  });

  it('gates on suites that exist, including the two that pin agreement', () => {
    for (const suite of CHAIN_GUARD_TESTS) expect(existsSync(path.join(ROOT, suite)), suite).toBe(true);
    expect(CHAIN_GUARD_TESTS).toEqual(
      expect.arrayContaining(['tests/season-ledger.test.ts', 'tests/division-strength-data.test.ts'])
    );
  });
});

/**
 * prebuild runs the same producers, step by step, and commits nothing. That
 * duplication is deliberate — `pipelineScripts()` derives the set a preview
 * build must watch from prebuild's own `pnpm run` names, so hiding the
 * producers behind the chain script would let an edit to one preview against
 * the stale committed file. This pins the two lists together.
 */
describe('prebuild recomputes the same chain, without committing it', () => {
  it('runs every chain producer as a watched step', async () => {
    const { pipelineScripts } = await import('../scripts/prebuild.mjs');
    const watched = pipelineScripts();
    for (const step of chainSteps()) {
      expect(watched.has(step.script), `${step.script} is not a watched prebuild step`).toBe(true);
    }
  });

  it('never passes the milestone flag from the build path', () => {
    expect(readFileSync(path.join(ROOT, 'scripts/prebuild.mjs'), 'utf8')).not.toContain(
      EMIT_MILESTONE_POSTS_FLAG
    );
  });
});

describe('timestamp-only rewrites', () => {
  const doc = (generatedAt: string, rows: unknown[]) =>
    JSON.stringify({ generatedAt, league: 'x', rows }, null, 2);

  it('treats a changed generatedAt alone as no change', () => {
    expect(isTimestampOnlyChange(doc('2026-09-10', [1, 2]), doc('2026-09-15', [1, 2]))).toBe(true);
  });

  it('keeps any content change, including a reorder', () => {
    expect(isTimestampOnlyChange(doc('a', [1, 2]), doc('b', [1, 3]))).toBe(false);
    expect(isTimestampOnlyChange(doc('a', [1, 2]), doc('b', [2, 1]))).toBe(false);
  });

  it('never calls unparseable text unchanged', () => {
    expect(isTimestampOnlyChange('{', '{"a":1}')).toBe(false);
  });
});

describe('every workflow goes through the script', () => {
  const workflows = readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({
      file: f,
      // Comments may explain the chain; only executable lines are judged.
      code: readFileSync(path.join(WORKFLOWS, f), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n'),
    }));

  it('no workflow runs a chain producer directly', () => {
    const producer =
      /compute-(franchise-history|owner-tenures|division-strength)\.mjs|compute:(afl-)?(franchise-history|owner-tenures|division-strength)/;
    expect(workflows.filter((w) => producer.test(w.code)).map((w) => w.file)).toEqual([]);
  });

  it('no workflow names a chain file — it commits what --print-outputs lists', () => {
    const named = new RegExp(CHAIN_FILES.map((f) => f.replace('.', '\\.')).join('|'));
    expect(workflows.filter((w) => named.test(w.code)).map((w) => w.file)).toEqual([]);
  });

  it('every workflow that runs the chain posts milestones, gates on the suites, then commits the outputs', () => {
    const lanes = workflows.filter((w) => w.code.includes('recompute-derived-chain.mjs'));
    expect(lanes.map((w) => w.file)).toEqual(
      expect.arrayContaining([
        'derived-history-chain.yml',
        'backfill-historical-feeds.yml',
        'fetch-owner-names.yml',
      ])
    );
    for (const { file, code } of lanes) {
      const run = code.search(/recompute-derived-chain\.mjs[^\n]*--emit-milestone-posts/);
      const gate = code.indexOf('--print-guard-tests');
      const commit = code.indexOf('--print-outputs');
      expect(run, `${file}: runs the chain with ${EMIT_MILESTONE_POSTS_FLAG}`).toBeGreaterThan(-1);
      expect(gate, `${file}: gates on --print-guard-tests after computing`).toBeGreaterThan(run);
      expect(commit, `${file}: commits --print-outputs after the gate`).toBeGreaterThan(gate);
    }
  });
});
