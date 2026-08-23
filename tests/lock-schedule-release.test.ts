import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Guards on the reveal locker — `scripts/lock-schedule-release.mjs`.
 *
 * The archive IS the lock (docs/claude/rules/schedule-optimization.md), so the
 * rules about when it may and may not be overwritten are the whole safety
 * property of Schedule Release Day. Two of them shipped broken and are pinned
 * here:
 *
 *   1. `--from-live` could never run in the case it exists for. The
 *      archive-exists guard runs before the mode dispatch, and a reveal locked
 *      from the wrong draw is BY DEFINITION a state where the archive exists.
 *      The documented repair printed `[skip] already revealed` and exited 0
 *      while Schefter's column stayed deadlocked on a match that can never
 *      happen. `--relock` is the escape hatch — and it must stay welded to
 *      `--from-live`, because relocking from a fresh PLAN would draw a new
 *      season, which is the one thing the lock exists to prevent.
 *
 *   2. The live audit accepted a partly-pasted season. `regularSeasonGames`
 *      drops a week with no matchups and `validateSeason` only walks the weeks
 *      it is handed, so a missing week hides from both global checks: every
 *      franchise loses the SAME game (equal-games holds) and a week with no
 *      division game is invisible to the rivals check too. A 13-week AFL
 *      season audited clean at 192 games and would have locked as truth.
 *
 * These live in the CLI's top-level loop rather than an importable module, so
 * the script is spawned — same approach as tests/ensure-pt-timezone.test.ts.
 */

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts/lock-schedule-release.mjs');
const LEAGUE = 'afl-fantasy';
const YEAR = 2026;
const ARCHIVE = path.join(ROOT, 'data', LEAGUE, 'schedule-release', `${YEAR}.json`);
const FEED = path.join(ROOT, 'data', LEAGUE, 'mfl-feeds', String(YEAR), 'schedule.json');

/** Run the locker. Never without --dry-run: these tests must not write a reveal. */
function lock(...args: string[]): { out: string; status: number } {
  try {
    const out = execFileSync('node', [SCRIPT, `--league=${LEAGUE}`, '--dry-run', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, status: 0 };
  } catch (err: any) {
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, status: err.status ?? 1 };
  }
}

describe('lock-schedule-release: the archive is the lock', () => {
  it('has an AFL 2026 reveal committed, so these tests exercise the already-revealed path', () => {
    expect(fs.existsSync(ARCHIVE)).toBe(true);
  });

  it('refuses to overwrite an existing reveal', () => {
    const { out } = lock();
    expect(out).toContain('already revealed');
    expect(out).not.toContain('would reveal');
  });

  it('still refuses with --from-live alone — the lock is not a mode', () => {
    const { out } = lock('--from-live');
    expect(out).toContain('already revealed');
    expect(out).not.toContain('would reveal');
  });

  it('still refuses with --force, which only bypasses the DATE guard', () => {
    const { out } = lock('--force');
    expect(out).toContain('already revealed');
    expect(out).not.toContain('would reveal');
  });

  it('refuses --relock without --from-live, and says why', () => {
    const { out } = lock('--relock');
    expect(out).toContain('already revealed');
    expect(out).toContain('requires --from-live');
    expect(out).not.toContain('would reveal');
  });

  it('--from-live --relock reaches the draw, and announces the overwrite', () => {
    const { out, status } = lock('--from-live', '--relock');
    expect(status).toBe(0);
    expect(out).toContain('[relock] overwriting');
    expect(out).toContain('would reveal 204 games');
    expect(out).toContain('doubleheaders 1, 2, 12');
  });
});

describe('lock-schedule-release: --from-live will not canonise a partial paste', () => {
  it('refuses a live feed that is missing a regular-season week', () => {
    const original = fs.readFileSync(FEED, 'utf8');
    const backup = path.join(os.tmpdir(), `afl-schedule-feed-${process.pid}.json`);
    fs.writeFileSync(backup, original);
    try {
      // Week 11 is the AFL's interdivision round — it carries no division game,
      // which is exactly what makes its absence invisible to validateSeason.
      const feed = JSON.parse(original);
      feed.schedule.weeklySchedule = feed.schedule.weeklySchedule.filter(
        (w: { week: string }) => Number(w.week) !== 11,
      );
      fs.writeFileSync(FEED, JSON.stringify(feed));

      const { out, status } = lock('--from-live', '--relock');
      expect(out).toContain('missing Week 11');
      expect(out).not.toContain('would reveal');
      // A failed lock is worth a red run — it only ever happens on a day
      // somebody asked for one.
      expect(status).toBe(1);
    } finally {
      fs.writeFileSync(FEED, original);
      fs.rmSync(backup, { force: true });
    }
    // The feed must be byte-identical afterwards or every other suite that
    // reads it is now testing a schedule this one invented.
    expect(fs.readFileSync(FEED, 'utf8')).toBe(original);
  });
});
