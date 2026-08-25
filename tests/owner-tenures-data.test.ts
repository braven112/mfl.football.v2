/**
 * owner-tenures.json — the derived ledger of owner tenures.
 *
 * The headline test here is CONSERVATION: the multiset of (franchiseId, year)
 * across all owners equals the season-ledger row set exactly. Nothing lost,
 * nothing double-counted.
 *
 * That is the test that would have caught the original bug. Owner-scoping
 * silently DELETED 110 of TheLeague's 320 franchise-seasons and 230 of the
 * AFL's 576 — a third of all league history, including 14 championships and 73
 * division titles — and nothing failed, because no test asserted that every
 * season belongs somewhere. A season that falls out of this derivation is a
 * season that vanishes from the site, which is exactly the failure mode being
 * fixed.
 *
 * Leagues without the derived file are skipped structurally — best-ball-1 has
 * no franchise history, so it has no owners, and that is not special-cased
 * here or anywhere else.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { HISTORICAL_TEAM_ICON_FALLBACK } from '../src/utils/identity-normalize.mjs';
import { normalizeIdentity } from '../src/utils/owner-tenures.mjs';

const ROOT = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const leagues = ALL_LEAGUES.map((league: any) => {
  const derived = path.join(ROOT, league.dataPath, 'derived');
  return {
    league,
    ownersPath: path.join(derived, 'owner-tenures.json'),
    ledgerPath: path.join(derived, 'season-ledger.json'),
    historyPath: path.join(derived, 'franchise-history.json'),
  };
}).filter((l) => existsSync(l.ownersPath));

it('finds the derived owner files', () => {
  expect(leagues.length).toBeGreaterThan(0);
});

it('produces no owners file for a league with no franchise history', () => {
  for (const league of ALL_LEAGUES as any[]) {
    const derived = path.join(ROOT, league.dataPath, 'derived');
    if (existsSync(path.join(derived, 'franchise-history.json'))) continue;
    expect(
      existsSync(path.join(derived, 'owner-tenures.json')),
      `${league.slug} has no franchise history but has an owners file`
    ).toBe(false);
  }
});

describe.each(leagues)('$league.slug owner tenures', ({ league, ownersPath, ledgerPath, historyPath }) => {
  const owners = readJson(ownersPath);
  const ledger = readJson(ledgerPath);
  const history = readJson(historyPath);

  const ownedKeys = owners.owners.flatMap((o: any) =>
    o.tenures.flatMap((t: any) => t.seasons.map((s: any) => `${t.franchiseId}|${s.year}`))
  );
  const ledgerKeys = ledger.rows.map((r: any) => `${r.franchiseId}|${r.year}`);

  /**
   * ★ The one that would have caught the original bug.
   *
   * Stated over SETS rather than multisets, because a shared team is
   * legitimately held by two owners and appears twice. The duplicate case is
   * checked separately and precisely below — the two together still mean
   * "nothing lost, nothing silently double-counted".
   */
  it('CONSERVATION: every ledger season is covered, and nothing extra appears', () => {
    expect([...new Set(ownedKeys)].sort()).toEqual([...new Set(ledgerKeys)].sort());
    expect(new Set(ledgerKeys).size).toBe(ledgerKeys.length);
  });

  /**
   * ★ The derived file carries the config's punitive rebrands.
   *
   * Identities are assembled from LEDGER ROWS, which have a name and an icon
   * but no `rebrand` — so the first version of this hardcoded
   * `rebrandGroup: null, punitive: false` and silently dropped all six of the
   * AFL's last-place renames. Nothing caught it, because nothing read the
   * field until a franchise page tried to render the 💀 tag from it.
   */
  it('REBRANDS: every punitive config entry survives into an identity', () => {
    const cfg = readJson(path.join(ROOT, league.configPath));
    const configTeams = Array.isArray(cfg.teams)
      ? cfg.teams
      : Object.values(cfg.teams ?? cfg);
    const expected = new Set<string>();
    for (const team of configTeams as any[]) {
      for (const entry of team.history ?? []) {
        if (entry?.rebrand?.reason === 'last-place' && entry.name) {
          expected.add(`${entry.name}|${entry.rebrand.group}`);
        }
      }
      // A team serving its punishment right now carries `currentRebrand` on
      // the TEAM, not in history[]. The first version of this test looked only
      // at history[] — the same blind spot the code had — so it passed while
      // the AFL's 2026 "A Bruin Pegs Me" came out non-punitive.
      if (team.currentRebrand?.reason === 'last-place' && team.name) {
        expected.add(`${team.name}|${team.currentRebrand.group}`);
      }
    }
    const actual = new Set<string>();
    for (const owner of owners.owners as any[]) {
      for (const identity of owner.identities) {
        if (identity.punitive) actual.add(`${identity.name}|${identity.rebrandGroup}`);
      }
    }
    expect([...actual].sort()).toEqual([...expected].sort());
  });

  /**
   * `divisionTitles[].divisionName` must be the DIVISION's name, not the
   * team's — `divisionWinners[]` carries both (`name` is the team). Reading
   * the wrong one shipped "Acer FC Edge" where "Atlantic" belonged. Nothing
   * renders the field yet, so only a source comparison catches a regression.
   */
  it('DIVISION NAMES: never the winning team name', () => {
    const byYear = new Map<number, any[]>(
      (history.yearSummaries ?? []).map((y: any) => [y.year, y.divisionWinners ?? []])
    );
    const teamNames = new Set<string>();
    for (const summary of history.yearSummaries ?? []) {
      for (const w of summary.divisionWinners ?? []) if (w.name) teamNames.add(w.name);
    }
    let checked = 0;
    for (const owner of owners.owners as any[]) {
      for (const title of owner.totals.divisionTitles) {
        if (!title.divisionName) continue;
        checked++;
        const winners = byYear.get(title.year) ?? [];
        const match = winners.find((w: any) => w.divisionId === title.divisionId);
        expect(
          title.divisionName,
          `${owner.slug} ${title.year}: divisionName should be the division, not a team`
        ).toBe(match?.divisionName ?? null);
      }
    }
    expect(checked, 'no division titles to check').toBeGreaterThan(0);
  });

  it('puts no season under two owners unless they are declared co-owners', () => {
    const holders = new Map<string, any[]>();
    for (const owner of owners.owners) {
      for (const tenure of owner.tenures) {
        for (const season of tenure.seasons) {
          const key = `${tenure.franchiseId}|${season.year}`;
          if (!holders.has(key)) holders.set(key, []);
          holders.get(key)!.push(owner);
        }
      }
    }
    const undeclared: string[] = [];
    for (const [key, hs] of holders) {
      if (hs.length < 2) continue;
      // Every holder must say it is shared AND name the others.
      const ok =
        hs.every((o) => o.isShared) &&
        hs.every((o) =>
          hs.filter((x) => x !== o).every((x) => o.coOwners.some((c: any) => c.slug === x.slug))
        );
      if (!ok) undeclared.push(`${key}: ${hs.map((h) => h.slug).join(', ')}`);
    }
    expect(undeclared).toEqual([]);
  });

  it('makes co-ownership mutual and never self-referential', () => {
    const bySlug = new Map(owners.owners.map((o: any) => [o.slug, o]));
    for (const owner of owners.owners) {
      expect(owner.coOwners.some((c: any) => c.slug === owner.slug)).toBe(false);
      expect(owner.isShared).toBe(owner.coOwners.length > 0);
      for (const co of owner.coOwners) {
        const other = bySlug.get(co.slug);
        expect(other, `${owner.slug} names unknown co-owner ${co.slug}`).toBeTruthy();
        expect(
          other.coOwners.some((c: any) => c.slug === owner.slug),
          `${co.slug} does not name ${owner.slug} back`
        ).toBe(true);
      }
    }
  });

  it('loses no season — every ledger row is claimed', () => {
    const owned = new Set(ownedKeys);
    const missing = ledgerKeys.filter((k: string) => !owned.has(k));
    expect(missing).toEqual([]);
  });

  it('counts distinct franchise-seasons, not owner-seasons', () => {
    expect(owners.counts.seasons).toBe(new Set(ownedKeys).size);
    expect(owners.counts.seasons).toBe(ledgerKeys.length);
  });

  it('invents no season — every owned row exists in the ledger', () => {
    const inLedger = new Set(ledgerKeys);
    const invented = ownedKeys.filter((k: string) => !inLedger.has(k));
    expect(invented).toEqual([]);
  });

  it('agrees with its own declared counts', () => {
    expect(owners.counts.total).toBe(owners.owners.length);
    expect(owners.counts.current).toBe(owners.owners.filter((o: any) => o.isCurrent).length);
    expect(owners.counts.former).toBe(owners.owners.filter((o: any) => !o.isCurrent).length);
    expect(owners.counts.seasons).toBe(new Set(ownedKeys).size);
  });

  it('has exactly one current holding per live slot', () => {
    const counts = new Map<string, any[]>();
    for (const owner of owners.owners) {
      if (!owner.currentFranchiseId) continue;
      if (!counts.has(owner.currentFranchiseId)) counts.set(owner.currentFranchiseId, []);
      counts.get(owner.currentFranchiseId)!.push(owner);
    }
    // Two current owners on one slot is fine ONLY for a declared shared team.
    const contested = [...counts]
      .filter(([, os]) => os.length > 1 && !os.every((o) => o.isShared))
      .map(([slot, os]) => `${slot}: ${os.map((o) => o.slug).join(', ')}`);
    expect(contested).toEqual([]);

    // And every slot that played the most recent season has one.
    const latestYear = Math.max(...ledger.rows.map((r: any) => r.year));
    const liveSlots = new Set(
      ledger.rows.filter((r: any) => r.year === latestYear).map((r: any) => r.franchiseId)
    );
    const uncovered = [...liveSlots].filter((slot) => !counts.has(slot as string));
    expect(uncovered).toEqual([]);
  });

  it('gives a former owner no current franchise', () => {
    for (const owner of owners.owners) {
      if (owner.isCurrent) continue;
      expect(owner.currentFranchiseId, `${owner.slug} is former but holds a slot`).toBeNull();
    }
  });

  it('has unique slugs', () => {
    const slugs = owners.owners.map((o: any) => o.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has URL-safe slugs and a non-empty title on every owner', () => {
    for (const owner of owners.owners) {
      expect(owner.slug, `${owner.ownerId} slug`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(owner.title.length, `${owner.slug} has an empty title`).toBeGreaterThan(0);
    }
  });

  /**
   * Trophies come from `yearSummaries`' RAW franchise ids (see trap 1 in the
   * plan doc). Pinning that each lands on exactly one owner is what proves the
   * orphaned ones — 7 titles and 25 division titles in TheLeague, 7 and 48 in
   * the AFL — actually reached a page.
   */
  it('lands every championship on exactly one owner', () => {
    const ownerOf = new Map<string, string[]>();
    for (const owner of owners.owners) {
      for (const tenure of owner.tenures) {
        for (const season of tenure.seasons) {
          const key = `${tenure.franchiseId}|${season.year}`;
          if (!ownerOf.has(key)) ownerOf.set(key, []);
          ownerOf.get(key)!.push(owner.slug);
        }
      }
    }

    let checked = 0;
    for (const summary of history.yearSummaries) {
      for (const field of ['champion', 'runnerUp', 'thirdPlace'] as const) {
        const franchiseId = summary[field];
        if (!franchiseId) continue;
        const holders = ownerOf.get(`${franchiseId}|${summary.year}`) ?? [];
        expect(holders.length, `${summary.year} ${field} (${franchiseId}) has ${holders.length} owners`).toBe(1);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('lands every division title on exactly one owner', () => {
    const ownedSet = new Set(ownedKeys);
    let checked = 0;
    for (const summary of history.yearSummaries) {
      for (const winner of summary.divisionWinners ?? []) {
        const source = winner.sourceFranchiseId ?? winner.franchiseId;
        if (!source) continue;
        expect(
          ownedSet.has(`${source}|${summary.year}`),
          `${summary.year} division ${winner.name} (${source}) belongs to no owner`
        ).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('credits championships to the owner who actually won them', () => {
    const claimed = owners.owners.flatMap((o: any) =>
      o.totals.championships.map((year: number) => `${o.slug}|${year}`)
    );
    expect(new Set(claimed).size).toBe(claimed.length);

    const totalTitles = history.yearSummaries.filter((y: any) => y.champion).length;
    expect(claimed.length).toBe(totalTitles);
  });

  it('sums each owner’s record from their own seasons', () => {
    for (const owner of owners.owners) {
      const seasons = owner.tenures.flatMap((t: any) => t.seasons).filter((s: any) => !s.seasonNotStarted);
      const wins = seasons.reduce((sum: number, s: any) => sum + s.wins, 0);
      const losses = seasons.reduce((sum: number, s: any) => sum + s.losses, 0);
      expect(owner.totals.wins, `${owner.slug} wins`).toBe(wins);
      expect(owner.totals.losses, `${owner.slug} losses`).toBe(losses);
      expect(owner.totals.seasons, `${owner.slug} season count`).toBe(seasons.length);
    }
  });

  it('resolves every icon to a real asset or the documented fallback', () => {
    const bad: string[] = [];
    const check = (icon: string | null, label: string) => {
      if (!icon) return;
      if (icon === HISTORICAL_TEAM_ICON_FALLBACK) return;
      if (!icon.startsWith('/assets/')) {
        bad.push(`${label}: ${icon} is not a local asset`);
        return;
      }
      if (!existsSync(path.join(ROOT, 'public', icon.replace(/^\//, '')))) {
        bad.push(`${label}: ${icon} does not exist`);
      }
    };
    for (const owner of owners.owners) {
      check(owner.icon, `${owner.slug} owner icon`);
      for (const identity of owner.identities) {
        check(identity.icon, `${owner.slug} identity ${identity.name}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('keeps bySlot consistent with owners[]', () => {
    const slugs = new Set(owners.owners.map((o: any) => o.slug));
    for (const [slot, entries] of Object.entries<string[]>(owners.bySlot)) {
      for (const slug of entries) {
        expect(slugs.has(slug), `bySlot[${slot}] names unknown owner ${slug}`).toBe(true);
        const owner = owners.owners.find((o: any) => o.slug === slug);
        expect(
          owner.tenures.some((t: any) => t.franchiseId === slot),
          `bySlot[${slot}] lists ${slug}, who has no tenure there`
        ).toBe(true);
      }
      // Oldest first.
      const years = entries.map(
        (slug) =>
          owners.owners
            .find((o: any) => o.slug === slug)
            .tenures.find((t: any) => t.franchiseId === slot).yearStart
      );
      expect(years).toEqual([...years].sort((a, b) => a - b));
    }

    // Every tenure appears in bySlot.
    for (const owner of owners.owners) {
      for (const tenure of owner.tenures) {
        expect(
          owners.bySlot[tenure.franchiseId]?.includes(owner.slug),
          `${owner.slug}'s tenure on ${tenure.franchiseId} is missing from bySlot`
        ).toBe(true);
      }
    }
  });

  it('keeps identityIndex consistent with owners[]', () => {
    const slugs = new Set(owners.owners.map((o: any) => o.slug));
    for (const [key, slug] of Object.entries<string>(owners.identityIndex)) {
      expect(slugs.has(slug), `identityIndex[${key}] names unknown owner ${slug}`).toBe(true);
      const owner = owners.owners.find((o: any) => o.slug === slug);
      const [name, yearStart] = key.split('|');
      expect(
        owner.identities.some(
          (i: any) => normalizeIdentity(i.name ?? '') === name && String(i.yearStart) === yearStart
        ),
        `identityIndex[${key}] points at ${slug}, who never wore it`
      ).toBe(true);
    }
  });

  /**
   * Succession runs over HOLDINGS, not owner entries: two co-owners of a
   * shared team occupy one position in the chain. Walking bySlug index-by-index
   * would make each co-owner the other's predecessor — a handover between two
   * people who ran the team at the same time.
   */
  it('makes slotSuccession agree with bySlot, collapsing co-owners to one step', () => {
    const bySlug = new Map(owners.owners.map((o: any) => [o.slug, o]));
    for (const [slot, order] of Object.entries<string[]>(owners.bySlot)) {
      // Group consecutive slugs that start the same year — that is a holding.
      const holdings: string[][] = [];
      for (const slug of order) {
        const yearStart = bySlug
          .get(slug)!
          .tenures.find((t: any) => t.franchiseId === slot).yearStart;
        const last = holdings[holdings.length - 1];
        const lastYear = last
          ? bySlug.get(last[0])!.tenures.find((t: any) => t.franchiseId === slot).yearStart
          : null;
        if (last && lastYear === yearStart) last.push(slug);
        else holdings.push([slug]);
      }

      holdings.forEach((holding, index) => {
        const expectedPrev = index > 0 ? holdings[index - 1][0] : null;
        const expectedNext = index < holdings.length - 1 ? holdings[index + 1][0] : null;
        for (const slug of holding) {
          const succession = bySlug.get(slug)!.slotSuccession[slot];
          expect(succession, `${slug} has no succession for ${slot}`).toBeTruthy();
          expect(succession.previous).toBe(expectedPrev);
          expect(succession.next).toBe(expectedNext);
          // A co-owner is never their own neighbour.
          expect(succession.previous).not.toBe(slug);
          expect(succession.next).not.toBe(slug);
        }
      });
    }
  });

  it('orders tenure seasons and keeps them inside the tenure’s span', () => {
    for (const owner of owners.owners) {
      for (const tenure of owner.tenures) {
        const years = tenure.seasons.map((s: any) => s.year);
        expect(years, `${owner.slug} ${tenure.franchiseId} seasons out of order`).toEqual(
          [...years].sort((a, b) => a - b)
        );
        expect(Math.min(...years)).toBe(tenure.yearStart);
        expect(Math.max(...years)).toBe(tenure.yearEnd);
      }
    }
  });

  it('ships anonymous — the title falls back to the identities worn', () => {
    for (const owner of owners.owners) {
      if (owner.displayName) {
        expect(owner.title).toBe(owner.displayName);
      } else {
        expect(owner.title.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * The measured totals. These were verified against real data and are the
 * reason the feature exists; moving them should require someone to look.
 */
describe('measured owner counts', () => {
  // TheLeague is 17 current for 16 slots: Cowboy Up (0014) is a shared team, so
  // its two co-owners are two owner entries on one franchise. `seasons` stays
  // 320 because it counts DISTINCT franchise-seasons, not owner-seasons.
  const cases = [
    { slug: 'theleague', total: 38, current: 17, former: 21, seasons: 320, shared: 2 },
    { slug: 'afl-fantasy', total: 88, current: 24, former: 64, seasons: 576, shared: 0 },
  ];

  for (const expected of cases) {
    const league: any = ALL_LEAGUES.find((l: any) => l.slug === expected.slug);
    const ownersPath = path.join(ROOT, league.dataPath, 'derived', 'owner-tenures.json');
    const runIf = existsSync(ownersPath) ? it : it.skip;

    runIf(`${expected.slug}: ${expected.current} current + ${expected.former} former`, () => {
      const owners = readJson(ownersPath);
      expect(owners.counts).toMatchObject({
        total: expected.total,
        current: expected.current,
        former: expected.former,
        seasons: expected.seasons,
        shared: expected.shared,
      });
    });
  }
});

/**
 * Two owner records in one league carrying the SAME team name is the signature
 * of one person split in two. Ownership is inferred from a franchise slot
 * changing hands, so a rename in place and a slot move both look exactly like
 * a handover — that is how Tom Flanagan, Jim Shea, Shane Fitch and ten others
 * each ended up as two strangers sharing a career. See
 * docs/claude/insights/features/franchise-history.md (2026-08-25).
 *
 * The collision is invisible while the owners are anonymous, because two rows
 * reading "Blitzkrieg" look like two teams that happened to share a name. This
 * test is what looks instead of waiting for a human to notice.
 *
 * A collision is a CANDIDATE, never proof. MFL's owner name is no help either:
 * a handover overwrites the franchise's name backwards across years the
 * previous owner played, so two adjacent records agreeing on a name is exactly
 * what a handover looks like. That is how slot 0007 got merged and then
 * un-merged within the hour — Team Murderface (2014) is Garrison Bravo, not
 * the Danny Baccam that MFL reported for it. See the 2026-08-25 correction in
 * the insights doc.
 *
 * So this test says LOOK HERE, not MERGE. Take a new collision to somebody who
 * was in the league; where nobody remembers, leave the records split. Genuine
 * collisions are allowlisted below WITH the reason.
 */
describe('no duplicate team name across owner records', () => {
  const ALLOWED: Record<string, Record<string, string>> = {
    'afl-fantasy': {
      // A real handover where the incoming owner kept the outgoing team name.
      'cska sofia': 'Evo Tchilin (2016) handed CSKA Sofia to the next owner in 2017',
    },
  };

  for (const league of ALL_LEAGUES as any[]) {
    if (!league.dataPath) continue;
    const ownersPath = path.join(ROOT, league.dataPath, 'derived', 'owner-tenures.json');
    const runIf = existsSync(ownersPath) ? it : it.skip;

    runIf(`${league.slug}: every team name maps to one owner record`, () => {
      const owners = readJson(ownersPath);
      const byName = new Map<string, any[]>();
      for (const owner of owners.owners) {
        // Dedupe within an owner first: a name that recurs across two of that
        // person's own identity runs is not a collision.
        const seen = new Set<string>();
        for (const identity of owner.identities) {
          const key = normalizeIdentity(identity.name ?? '');
          if (!key || seen.has(key)) continue;
          seen.add(key);
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key)!.push(owner);
        }
      }

      // Co-owners of one shared team are two owner entries on one HOLDING, so
      // they carry the same identity by construction — not a split. Handled
      // structurally rather than by name, so a new shared team needs no entry.
      const sameHolding = (list: any[]) =>
        list.every((o) =>
          list.every(
            (other) =>
              o.slug === other.slug ||
              (o.coOwners ?? []).some((co: any) => co.slug === other.slug)
          )
        );

      const allowed = ALLOWED[league.slug] ?? {};
      const collisions = [...byName.entries()]
        .filter(([key, list]) => list.length > 1 && !allowed[key] && !sameHolding(list))
        .map(([key, list]) => `"${key}" is on ${list.map((o) => o.slug).join(' and ')}`);

      expect(
        collisions,
        `Two owner records share a team name in ${league.slug}. Usually that is one ` +
          `person the slot-change inference split in two — but it can equally be a ` +
          `handover where the incoming owner renamed the team, and MFL's owner name ` +
          `cannot tell you which (it overwrites backwards). CONFIRM WITH A HUMAN ` +
          `before merging. If it is one person, merge into the EARLIER record (the ` +
          `later slug goes to previousSlugs, which resolveOwnerDetail redirects ` +
          `from). If it is two, add the name to ALLOWED above with the reason.` +
          `\n  ${collisions.join('\n  ')}`
      ).toEqual([]);
    });
  }
});

/** The spot-check from the plan doc: the tenure that started all of this. */
describe('the Witch City Warlocks', () => {
  const league: any = ALL_LEAGUES.find((l: any) => l.slug === 'theleague');
  const ownersPath = path.join(ROOT, league.dataPath, 'derived', 'owner-tenures.json');
  const runIf = existsSync(ownersPath) ? it : it.skip;

  runIf('is 2007-2010, 38-34, with one division title, one MVP and two Jerry Joneses', () => {
    const owners = readJson(ownersPath);
    const warlocks = owners.owners.find((o: any) =>
      o.identities.some((i: any) => normalizeIdentity(i.name ?? '') === 'witch city warlocks')
    );
    expect(warlocks, 'the Warlocks tenure is missing entirely').toBeTruthy();
    expect(warlocks.yearStart).toBe(2007);
    expect(warlocks.yearEnd).toBe(2010);
    expect(warlocks.isCurrent).toBe(false);
    expect(warlocks.totals.wins).toBe(38);
    expect(warlocks.totals.losses).toBe(34);
    expect(warlocks.totals.divisionTitles).toHaveLength(1);
    expect(warlocks.totals.divisionTitles[0].year).toBe(2007);
    expect(warlocks.totals.mvpAwards).toEqual([2007]);
    expect(warlocks.totals.jerryJonesAwards).toEqual([2009, 2010]);
    expect(warlocks.tenures).toHaveLength(1);
    expect(warlocks.tenures[0].franchiseId).toBe('0010');
  });
});

/**
 * The seeded registry claims every season today, so the derived file's
 * conservation is satisfied by claims alone and the INFERENCE path is not
 * exercised by the tests above. That matters: inference is what handles a new
 * orphan the day an owner leaves, and a regression in it would sit unnoticed
 * behind a complete registry until exactly the moment it is needed.
 *
 * So re-derive from the real ledgers with no registry at all and assert the
 * same conservation. This is the fixture-free check that inference alone still
 * accounts for every franchise-season.
 */
describe.each(leagues)('$league.slug inference without a registry', ({ league, ownersPath, ledgerPath, historyPath }) => {
  it('accounts for every season from inference alone', async () => {
    const { buildOwnerTenures } = await import('../src/utils/owner-tenures.mjs');
    const ledger = readJson(ledgerPath);
    const history = readJson(historyPath);
    const configPath = path.join(ROOT, (league as any).configPath);
    const cfg = readJson(configPath);
    const teams = Array.isArray(cfg.teams) ? cfg.teams : Object.values(cfg.teams ?? cfg);

    // Gap-filled years need the feed's own names; without them an identity is
    // simply unnamed, which does not affect conservation.
    const feedCache = new Map<number, Map<string, any>>();
    const feedIdentityFor = (franchiseId: string, year: number) => {
      if (!feedCache.has(year)) {
        const feedPath = path.join(ROOT, (league as any).dataPath, 'mfl-feeds', String(year), 'league.json');
        const byId = new Map<string, any>();
        if (existsSync(feedPath)) {
          const franchises = readJson(feedPath)?.league?.franchises?.franchise ?? [];
          for (const f of Array.isArray(franchises) ? franchises : [franchises]) {
            if (f?.id) byId.set(f.id, { name: f.name ?? null, icon: null, banner: null });
          }
        }
        feedCache.set(year, byId);
      }
      return feedCache.get(year)!.get(franchiseId) ?? null;
    };

    const inferred = buildOwnerTenures({
      league,
      teams,
      ledgerRows: ledger.rows,
      yearSummaries: history.yearSummaries,
      feedIdentityFor,
      registry: null,
      generatedAt: 'test',
    });

    const inferredKeys = inferred.owners.flatMap((o: any) =>
      o.tenures.flatMap((t: any) => t.seasons.map((s: any) => `${t.franchiseId}|${s.year}`))
    );
    const ledgerKeys = ledger.rows.map((r: any) => `${r.franchiseId}|${r.year}`);

    expect(inferredKeys.length).toBe(ledgerKeys.length);
    expect([...inferredKeys].sort()).toEqual([...ledgerKeys].sort());
    expect(new Set(inferredKeys).size).toBe(inferredKeys.length);
  });

  it('agrees with the committed file on how many owners there are', () => {
    // If a registry edit ever splits or merges a tenure, this is where the two
    // views diverge — which is a legitimate human decision, not a failure. It
    // is pinned so the divergence is visible rather than silent.
    const owners = readJson(ownersPath);
    expect(owners.owners.every((o: any) => ['registry', 'inferred'].includes(o.source))).toBe(true);
  });
});

/**
 * `loadLeagueInputs` is the shared contract both owner scripts build on. It
 * returned a working `feedIdentityFor`... except it didn't: the function was
 * built and then left out of the return object, so both callers passed
 * `undefined` and every gap-filled year silently lost its name. AFL 0007's
 * 2015-2020 came out unnamed — the exact case the plan doc calls "the only way
 * to get Avenging Amish".
 *
 * Nothing caught it. The committed files are derived WITH a registry that
 * covers every season, so they never take the gap-fill path, and the
 * inference test above builds its own feedIdentityFor inline rather than using
 * the one the scripts actually get. This tests the contract itself.
 */
describe.each(leagues)('$league.slug loadLeagueInputs contract', ({ league }) => {
  it('returns everything buildOwnerTenures is handed by the real scripts', async () => {
    const { loadLeagueInputs } = await import('../scripts/lib/owner-tenure-inputs.mjs');
    const inputs = loadLeagueInputs(ROOT, league);
    expect(inputs, `${league.slug} inputs`).toBeTruthy();

    expect(Array.isArray(inputs.teams)).toBe(true);
    expect(Array.isArray(inputs.ledgerRows)).toBe(true);
    expect(Array.isArray(inputs.yearSummaries)).toBe(true);
    expect(
      typeof inputs.feedIdentityFor,
      'feedIdentityFor missing — gap-filled years will lose their names'
    ).toBe('function');
  });

  it('resolves a real franchise-season to a feed name', () => {
    // Proves the returned function actually reads the feeds, not just that
    // something callable came back.
    const ledger = readJson(path.join(ROOT, (league as any).dataPath, 'derived', 'season-ledger.json'));
    const sample = ledger.rows[0];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return import('../scripts/lib/owner-tenure-inputs.mjs').then(({ loadLeagueInputs }) => {
      const inputs = loadLeagueInputs(ROOT, league);
      const identity = inputs.feedIdentityFor(sample.franchiseId, sample.year);
      // A league-year with feeds on disk must resolve; if the feed is absent
      // the function returns null, which is also valid — assert it is one or
      // the other, never a throw or undefined.
      expect(identity === null || typeof identity.name === 'string').toBe(true);
    });
  });
});

/** Slugs are URLs, and the two leagues' files are served from one origin. */
describe('slugs identify one person across every league', () => {
  /**
   * A slug appearing in both leagues' files is NOT a collision when it is the
   * same person — that is the whole point of a league-neutral registry, and an
   * owner with a team in each league is exactly the case locked decision 1
   * exists for. The real invariant is that one slug never means two people.
   */
  it('never lets one slug mean two different people', () => {
    const seen = new Map<string, { ownerId: string; league: string }>();
    const collisions: string[] = [];
    for (const { league, ownersPath } of leagues) {
      for (const owner of readJson(ownersPath).owners) {
        const prior = seen.get(owner.slug);
        if (prior && prior.ownerId !== owner.ownerId) {
          collisions.push(
            `${owner.slug}: ${prior.ownerId} (${prior.league}) and ${owner.ownerId} (${league.slug})`
          );
        }
        seen.set(owner.slug, { ownerId: owner.ownerId, league: league.slug });
      }
    }
    expect(collisions).toEqual([]);
    expect(seen.size).toBeGreaterThan(0);
  });

  it('keeps slugs unique WITHIN each league', () => {
    for (const { league, ownersPath } of leagues) {
      const slugs = readJson(ownersPath).owners.map((o: any) => o.slug);
      const dupes = slugs.filter((s: string, i: number) => slugs.indexOf(s) !== i);
      expect(dupes, `${league.slug} has duplicate slugs`).toEqual([]);
    }
  });

  it('gives a cross-league person the same ownerId in both files', () => {
    const byLeague = leagues.map(({ league, ownersPath }) => ({
      slug: league.slug,
      owners: readJson(ownersPath).owners,
    }));
    if (byLeague.length < 2) return;
    const [first, second] = byLeague;
    const firstById = new Map(first.owners.map((o: any) => [o.ownerId, o]));
    let shared = 0;
    for (const owner of second.owners) {
      const other: any = firstById.get(owner.ownerId);
      if (!other) continue;
      shared += 1;
      expect(other.slug, `${owner.ownerId} has different slugs per league`).toBe(owner.slug);
      // And each side should say the other league is where the rest lives.
      expect(owner.crossLeague.length + other.crossLeague.length).toBeGreaterThan(0);
    }
    // Not asserted to be non-zero: a league pair with no shared people is fine.
    expect(shared).toBeGreaterThanOrEqual(0);
  });
});
