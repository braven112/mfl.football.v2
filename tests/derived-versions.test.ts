/**
 * Every league gets every feature (Brandon, Nov 2026): "if I had a great
 * idea, I would like it to apply to all leagues always."
 *
 * Ask the History's NFL-team history shipped for the three leagues someone
 * thought to rebuild; Gumbas kept a file without it, and Archie's and Sandbox
 * had never been given the player or moves datasets at all, so Buck could not
 * answer a player question there. Nothing failed.
 *
 * Now each computed dataset carries a version (scripts/lib/derived-versions.mjs)
 * and this suite walks EVERY league the dataset's job runs for — read from the
 * registry, so a league launched tomorrow is covered with no edit here — and
 * fails on a missing file or an old version, naming the command that fixes it.
 * Below that, feature checks run per league rather than against one sample.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DERIVED_DATASETS } from "../scripts/lib/derived-versions.mjs";
import { leaguesFor } from "../scripts/lib/league-jobs.mjs";

const ROOT = join(__dirname, "..");
const derivedPath = (league: any, file: string) =>
  join(ROOT, String(league.dataPath).replace(/^\.?\//, ""), "derived", file);
const readDerived = (league: any, file: string) =>
  JSON.parse(readFileSync(derivedPath(league, file), "utf8"));

describe("every league has every dataset on the current version", () => {
  for (const [file, spec] of Object.entries(DERIVED_DATASETS)) {
    const leagues = leaguesFor(spec.job);
    it(`${file} runs for at least one league`, () => {
      expect(leagues.length).toBeGreaterThan(0);
    });
    for (const league of leagues) {
      it(`${league.slug}: ${file}${spec.version == null ? "" : ` v${spec.version}`}`, () => {
        const fix = spec.rebuild.replace("<slug>", league.slug);
        expect(
          existsSync(derivedPath(league, file)),
          `${league.slug} has no ${file}. Run: ${fix}`,
        ).toBe(true);
        if (spec.version == null) return;
        const { version } = readDerived(league, file);
        expect(
          version,
          `${league.slug}'s ${file} is v${version ?? "(none)"}, code expects v${spec.version}. Run: ${fix}`,
        ).toBe(spec.version);
      });
    }
  }

  it("each versioned generator stamps its version from the table, not a literal", () => {
    for (const file of Object.keys(DERIVED_DATASETS).filter(
      (f) => DERIVED_DATASETS[f].version != null,
    )) {
      const script = DERIVED_DATASETS[file].rebuild.split(" ")[1];
      const src = readFileSync(join(ROOT, script), "utf8");
      expect(
        src,
        `${script} must write "version": derivedVersion('${file}')`,
      ).toContain(`derivedVersion('${file}')`);
    }
  });
});

describe("Ask the History features hold in every league", () => {
  for (const league of leaguesFor("league-history")) {
    it(`${league.slug}: started players carry their NFL team`, () => {
      const d = readDerived(league, "league-history-players.json");
      const seen = new Set<string>();
      let missing = 0;
      for (const [year, , , pid, , flags] of d.weeks) {
        if (!(flags & 1)) continue;
        const key = `${year}|${pid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!d.nflTeams?.[year]?.[pid]) missing += 1;
      }
      expect(seen.size).toBeGreaterThan(0);
      // A player MFL lists as a free agent at season end has no team (~1%).
      expect(
        missing / seen.size,
        `${missing} of ${seen.size} started player-seasons have no NFL team`,
      ).toBeLessThan(0.03);
    });

    it(`${league.slug}: player and moves datasets cover the same seasons as the league history`, () => {
      const history = readDerived(league, "league-history.json");
      const players = readDerived(league, "league-history-players.json");
      const yearsWithWeeks = new Set(players.weeks.map((w: any[]) => w[0]));
      expect(history.seasons.length).toBeGreaterThan(0);
      const missingSeasons = history.seasons
        // `done` counts finished weeks; a season with none (the AFL's 2003) has no box scores.
        .filter((s: any) => s.done > 0)
        .map((s: any) => s.y)
        .filter(
          (y: number) => !yearsWithWeeks.has(y) && !players.missingWeeks?.[y],
        );
      expect(
        missingSeasons,
        `seasons with no player weeks and no missingWeeks note`,
      ).toEqual([]);
    });
  }
});
