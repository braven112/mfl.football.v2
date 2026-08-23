import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * A committed plan must never contradict that season's locked reveal.
 *
 * The reveal is the schedule the league is shown and the commissioner pastes;
 * `data/<league>/schedule-plan/<year>-schedule.json` is only ever the draw that
 * PRODUCED it. When the two disagree, the plan is a decoy: it is named like this
 * year's schedule, it validates, it carries a ready-to-paste `text` block — and
 * it describes a season nobody will play.
 *
 * That shipped. The AFL's 2026 plan came from the CLI run in the PR, the paste
 * came from a later annealing draw, and all fourteen weeks differed. Because the
 * optimiser is stochastic, nothing about either file says which one MFL is
 * running, so the only way to notice is to compare them — which is what this
 * does. Two things now keep the pair honest: the release workflow does not draw
 * a plan for a season that is already revealed, and this test fails the build if
 * one turns up anyway.
 *
 * The reveal is authoritative. If this test goes red, the plan is what is wrong:
 * delete it, or replace it with one that agrees. Never edit the archive to match
 * a plan — the archive is the lock (docs/claude/rules/schedule-optimization.md).
 */

const ROOT = process.cwd();

/** Order-free signature of a season: every week, every pairing, sides ignored. */
function signature(weeks: Record<string, { away: string; home: string }[]>): string {
  return Object.entries(weeks)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([w, games]) => {
      const pairs = games.map((g) => [g.away, g.home].sort().join('-')).sort();
      return `${w}:${pairs.join(',')}`;
    })
    .join('|');
}

const pairs = Object.values(LEAGUES).flatMap((league) => {
  const dir = path.join(ROOT, league.dataPath, 'schedule-release');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => {
      const year = f.slice(0, 4);
      return {
        slug: league.slug,
        year,
        archive: path.join(dir, f),
        plan: path.join(ROOT, league.dataPath, 'schedule-plan', `${year}-schedule.json`),
      };
    });
});

describe('a committed plan never contradicts its locked reveal', () => {
  it('finds at least one locked reveal to check (else this suite is vacuous)', () => {
    expect(pairs.length).toBeGreaterThan(0);
  });

  for (const { slug, year, archive, plan } of pairs) {
    it(`${slug} ${year}`, () => {
      // No plan is the expected steady state once a season is revealed — the
      // archive carries `text` and `weeks`, so nothing reads the plan any more.
      if (!fs.existsSync(plan)) return;

      const reveal = JSON.parse(fs.readFileSync(archive, 'utf8'));
      const drawn = JSON.parse(fs.readFileSync(plan, 'utf8'));
      expect(signature(drawn.weeks), `${path.relative(ROOT, plan)} describes a different season than the locked reveal — the reveal wins; delete or redraw the plan`).toBe(
        signature(reveal.weeks),
      );
      expect(drawn.doubleheaderWeeks).toEqual(reveal.doubleheaderWeeks);
    });
  }
});
