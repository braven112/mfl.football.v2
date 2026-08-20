/**
 * ESPN athlete-id coverage guard.
 *
 * `PlayerIdentity.nflEspnId` is the join key for every ESPN-backed surface —
 * the live-scoring box score, scoring-play attribution, player news. A missing
 * id does not fail loudly: the player simply stops appearing in features he
 * belongs in. That is how D'Andre Swift, Tony Pollard and three STARTING
 * KICKERS (Cameron Dicker, Jake Elliott, Daniel Carlson) went unnoticed, and
 * how the AFL play "Tre Tucker 26 Yd pass from Geno Smith" shipped crediting
 * only Geno Smith.
 *
 * So the coverage bar is enforced here rather than trusted:
 *
 *   - **Every ROSTERED player in every league must resolve.** No exceptions,
 *     no allowlist. If somebody owns him, we can join him.
 *   - **The wider pool must stay above 95%.**
 *
 * MFL's own feed does not clear either bar on its own (23 of 976 skill players
 * carry no `espn_id`, 13 of them rostered), so the numbers below depend on the
 * generated backfill at data/theleague/derived/espn-nfl-id-backfill.json. If
 * this test fails on a fresh clone, run `pnpm fetch:espn-ids` — prebuild does
 * it automatically.
 *
 * The one sanctioned shortfall is a player who has NEVER been on an NFL
 * roster: ESPN has no NFL athlete entity for him at all, so there is nothing
 * to resolve rather than something we failed to find. Those are recognizable
 * from the feed itself (`team: FA` and a rookie flag) and are excluded from the
 * pool percentage — never from the rostered bar, because a franchise rostering
 * him means somebody expects to see him.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPlayerMap } from '../src/utils/player-map';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { getCurrentLeagueYear } from '../src/utils/league-year';

/** Positions that can have an ESPN athlete id. DEF units never can. */
const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'PK']);

/** Pool coverage floor. Rostered players are held to 100% separately. */
const POOL_COVERAGE_FLOOR = 0.95;

const year = getCurrentLeagueYear();
const identities = getPlayerMap(year);

const readJson = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
};

const asArray = <T>(x: T | T[] | undefined | null): T[] =>
  Array.isArray(x) ? x : x == null ? [] : [x];

/** Raw MFL rows for the current year, so we can see `team` / `status`. */
const rawRows: Map<string, Record<string, string>> = (() => {
  const map = new Map<string, Record<string, string>>();
  const raw = readJson(join(process.cwd(), `data/theleague/mfl-feeds/${year}/players.json`));
  for (const p of (raw?.players?.player ?? []) as Array<Record<string, string>>) {
    if (p?.id) map.set(p.id, p);
  }
  return map;
})();

/**
 * A player who has never appeared on an NFL roster: MFL parks him at `FA` and
 * flags him a rookie. ESPN has no NFL athlete for him, so his absence is a
 * fact about the world rather than a gap in our data.
 */
function neverOnAnNflRoster(mflId: string): boolean {
  const row = rawRows.get(mflId);
  if (!row) return false;
  return String(row.team ?? '').toUpperCase().startsWith('FA') && row.status === 'R';
}

/** Every player rostered by any franchise in a league, at a skill position. */
function rosteredSkillPlayers(dataPath: string): string[] {
  const raw = readJson(join(process.cwd(), dataPath, 'mfl-feeds', String(year), 'rosters.json'));
  const out: string[] = [];
  for (const f of asArray<any>(raw?.rosters?.franchise)) {
    for (const p of asArray<any>(f?.player)) {
      const id = p?.id ? String(p.id) : '';
      if (!id) continue;
      const pos = identities.get(id)?.position;
      if (pos && SKILL.has(pos)) out.push(id);
    }
  }
  return out;
}

const describeName = (id: string) =>
  `${identities.get(id)?.name ?? id} (${identities.get(id)?.position ?? '?'} ${identities.get(id)?.nflTeam ?? '?'}, mfl ${id})`;

describe('ESPN athlete id coverage', () => {
  it('the generated backfill artifact exists and is well formed', () => {
    const path = join(process.cwd(), 'data/theleague/derived/espn-nfl-id-backfill.json');
    expect(
      existsSync(path),
      'Missing data/theleague/derived/espn-nfl-id-backfill.json — run `pnpm fetch:espn-ids`',
    ).toBe(true);
    const raw = readJson(path);
    expect(raw?.ids, 'backfill has no `ids` map').toBeTruthy();
    for (const [mflId, espnId] of Object.entries(raw.ids as Record<string, string>)) {
      expect(mflId, `backfill key ${mflId} is not an MFL id`).toMatch(/^\d{1,7}$/);
      expect(espnId, `backfill value for ${mflId} is not an ESPN id`).toMatch(/^\d{1,12}$/);
    }
  });

  it('never overrides an espn_id that MFL itself provides', () => {
    // The backfill fills gaps only. An entry for a player MFL already has an
    // id for would mean we are second-guessing the feed — and quietly swapping
    // one athlete for another is exactly the failure mode this all guards.
    const raw = readJson(join(process.cwd(), 'data/theleague/derived/espn-nfl-id-backfill.json'));
    const overrides = Object.keys(raw?.ids ?? {}).filter((id) => rawRows.get(id)?.espn_id);
    expect(
      overrides.map(describeName),
      'Backfill entries for players who already have an MFL espn_id',
    ).toEqual([]);
  });

  for (const league of Object.values(ALL_LEAGUES) as Array<{ slug: string; dataPath: string }>) {
    const rostered = rosteredSkillPlayers(league.dataPath);

    it(`${league.slug}: every rostered skill player has an NFL ESPN id`, () => {
      if (rostered.length === 0) return; // league has no rosters synced for this year
      const missing = [...new Set(rostered)].filter((id) => !identities.get(id)?.nflEspnId);
      expect(
        missing.map(describeName),
        `Rostered players with no nflEspnId. They will silently vanish from live box ` +
          `scores, scoring-play attribution and player news. Run \`pnpm fetch:espn-ids\`; ` +
          `if a player still will not resolve, check whether ESPN has an NFL athlete for ` +
          `him at all before loosening this test.`,
      ).toEqual([]);
    });
  }

  it(`the wider player pool stays above ${POOL_COVERAGE_FLOOR * 100}% coverage`, () => {
    const pool = [...identities.values()].filter(
      (p) => SKILL.has(p.position) && !neverOnAnNflRoster(p.mflId),
    );
    expect(pool.length, 'no players loaded — is the feed present?').toBeGreaterThan(100);
    const resolved = pool.filter((p) => p.nflEspnId);
    const coverage = resolved.length / pool.length;
    const missing = pool.filter((p) => !p.nflEspnId).map((p) => describeName(p.mflId));
    expect(
      coverage,
      `Coverage ${(coverage * 100).toFixed(1)}% (${resolved.length}/${pool.length}). ` +
        `Missing: ${missing.slice(0, 20).join(', ')}`,
    ).toBeGreaterThanOrEqual(POOL_COVERAGE_FLOOR);
  });

  it('the only unresolved players are ones with no NFL athlete to resolve to', () => {
    // Stated as its own case so a future regression reads as "we lost ids"
    // rather than hiding inside the percentage above.
    const unresolved = [...identities.values()].filter(
      (p) => SKILL.has(p.position) && !p.nflEspnId,
    );
    const unexplained = unresolved.filter((p) => !neverOnAnNflRoster(p.mflId));
    expect(
      unexplained.map((p) => describeName(p.mflId)),
      'Players with no ESPN id who HAVE been on an NFL roster — these are real gaps',
    ).toEqual([]);
  });

  it('resolves the specific starters that were missing when this guard was written', () => {
    // Regression pins. Each of these shipped with no id, and each is a starter.
    const pins: Record<string, string> = {
      '14797': '4259545', // D'Andre Swift    (RB CHI)
      '14085': '3916148', // Tony Pollard     (RB TEN)
      '13718': '3051909', // Daniel Carlson   (PK LV)  — was on no NFL roster; search-resolved
      '15979': '4362081', // Cameron Dicker   (PK LAC)
      '16287': '4428718', // Tre Tucker       (WR LV)  — the AFL ticker miss
    };
    for (const [mflId, espnId] of Object.entries(pins)) {
      const p = identities.get(mflId);
      if (!p) continue; // player left the feed entirely; not this test's business
      expect(p.nflEspnId, `${describeName(mflId)} should resolve to ${espnId}`).toBe(espnId);
    }
  });
});
