/**
 * Owner tenures — turning franchise SLOTS into owner TENURES.
 *
 * A franchise page answers "what has franchise 0010 done?". It cannot answer
 * "what did the Witch City Warlocks' owner do?", because `attributeYear()`
 * deliberately refuses to let a new owner inherit the previous one's record.
 * That refusal is correct and it left 110 of TheLeague's 320 franchise-seasons
 * and 230 of the AFL's 576 — 14 championships and 73 division titles — with no
 * page to live on.
 *
 * This module reads the unattributed season ledger and segments each slot's
 * history into tenures, so every owner (current AND former) becomes an
 * addressable thing with a record.
 *
 * `.mjs` on purpose: `scripts/compute-owner-tenures.mjs` and the `.astro`
 * pages both import it. Types live in `src/types/owner-tenures.ts`.
 *
 * ── What this module does NOT know ────────────────────────────────────────
 * Whether two adjacent identities were really the same person. Nothing in the
 * data says so, and no test can check it. Inference makes a defensible default
 * split; `src/data/owners-registry.json` is where a human overrides it, and
 * claims there always win. See docs/plans/owners-feature.md.
 */
import { normalizeIdentity, HISTORICAL_TEAM_ICON_FALLBACK } from './identity-normalize.mjs';

export { normalizeIdentity };

/** Open-ended year, matching the existing `ownerHistory` convention. */
export const OPEN_ENDED_YEAR = 9999;

/**
 * A "punitive" rebrand is the league's last-place forfeit: the owner is made
 * to wear a humiliating name for a season. It is transparently the same
 * person, which is why it bridges a tenure boundary rather than starting a new
 * one. There is no `punitive` flag in the config — the signal is the rebrand
 * reason.
 */
export const isPunitiveEntry = (entry) => entry?.rebrand?.reason === 'last-place';

const rebrandGroupOf = (entry) => entry?.rebrand?.group ?? null;

/** URL-safe slug segment. */
export const kebab = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by NFKD
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '') || 'owner';

// ───────────────────────────────────────────────────────────────────────────
// The ownership boundary
// ───────────────────────────────────────────────────────────────────────────

/**
 * Infer the year the current owner took over. Ported VERBATIM from
 * `scripts/compute-franchise-history.mjs` — including the `sameEra` clause,
 * which the `afl-awards.ts` copy is missing (see trap 3 in the plan doc).
 *
 * Keeping this definitionally equal to `attributeYear` is the whole point:
 * `tests/owner-boundary-parity.test.ts` pins the equality, so PR 3 can migrate
 * the other four copies onto this one and prove nothing moved.
 *
 *   1. Explicit `currentOwnerSince` wins.
 *   2. If the team has an ownerHistory: earliest yearStart across entries.
 *   3. Else if the most recent history entry's name matches the current
 *      top-level name: walk backwards including consecutive entries that share
 *      the same name OR the same ownerEra → earliest yearStart of that run.
 *   4. Else if there's a history but no name match: yearEnd of the last history
 *      entry + 1 (current owner started after the prior owner).
 *   5. Else (no history at all): null → include all years.
 */
export const inferCurrentOwnerSince = (team) => {
  if (typeof team.currentOwnerSince === 'number') {
    return team.currentOwnerSince;
  }
  if (Array.isArray(team.ownerHistory) && team.ownerHistory.length > 0) {
    return Math.min(...team.ownerHistory.map((h) => h.yearStart));
  }
  if (!Array.isArray(team.history) || team.history.length === 0) {
    return null;
  }
  const sorted = [...team.history].sort((a, b) => a.yearStart - b.yearStart);
  const last = sorted[sorted.length - 1];
  const currentNorm = normalizeIdentity(team.name);
  if (normalizeIdentity(last.name) !== currentNorm) {
    return last.yearEnd + 1;
  }
  let i = sorted.length - 1;
  while (i > 0) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const sameName = normalizeIdentity(prev.name) === normalizeIdentity(cur.name);
    const sameEra =
      prev.ownerEra != null && cur.ownerEra != null && prev.ownerEra === cur.ownerEra;
    if (sameName || sameEra) i--;
    else break;
  }
  return sorted[i].yearStart;
};

/**
 * Build the season attributor for a league. `attributeSeason` is the exact
 * counterpart of `attributeYear` in compute-franchise-history.mjs.
 */
export const buildAttributor = (teams) => {
  const currentTeams = teams ?? [];
  const teamsWithOwnerHistory = currentTeams.filter(
    (t) => Array.isArray(t.ownerHistory) && t.ownerHistory.length > 0
  );

  const currentOwnerSinceMap = new Map();
  for (const team of currentTeams) {
    currentOwnerSinceMap.set(team.franchiseId, inferCurrentOwnerSince(team));
  }

  const attributeSeason = (sourceId, year) => {
    // Cross-franchise ownerHistory claim wins first.
    for (const team of teamsWithOwnerHistory) {
      for (const entry of team.ownerHistory) {
        if (entry.franchiseId === sourceId && year >= entry.yearStart && year <= entry.yearEnd) {
          return team.franchiseId;
        }
      }
    }
    const sourceTeam = currentTeams.find((t) => t.franchiseId === sourceId);
    // If the source team itself has an ownerHistory but none of its entries
    // cover this year, the year belongs to a former owner we don't track.
    if (Array.isArray(sourceTeam?.ownerHistory) && sourceTeam.ownerHistory.length > 0) {
      return null;
    }
    const since = currentOwnerSinceMap.get(sourceId);
    if (since != null && year < since) {
      return null;
    }
    return sourceId;
  };

  return { attributeSeason, currentOwnerSinceMap };
};

// ───────────────────────────────────────────────────────────────────────────
// Identity segmentation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Do two ADJACENT history entries belong to the same tenure?
 *
 * Any one of these is enough:
 *  - same `ownerEra` — the config author already said so (collapses
 *    TheLeague 0003's Poker in the Rear / Generals / Poker in the Rear);
 *  - same normalized name — a banner refresh, not a new owner;
 *  - same `rebrand.group` — an explicitly tagged rebrand pair;
 *  - either entry is punitive AND the two are YEAR-ADJACENT — a last-place
 *    forfeit rename is transparent and bridges on both sides. This merges AFL
 *    0016's Be Gentle! 2019 / Be Rough! 2020 / Be Gentle. 2021, where only
 *    2020 carries the group tag.
 *
 * THE YEAR-ADJACENCY CLAUSE IS LOAD-BEARING. Without it, AFL 0007's 2014
 * entry bridges a six-year gap to its 2021 punitive entry and swallows a
 * different owner's tenure whole.
 */
export const entriesShareTenure = (a, b) => {
  if (!a || !b) return false;

  if (a.ownerEra != null && b.ownerEra != null && a.ownerEra === b.ownerEra) return true;
  if (normalizeIdentity(a.name) === normalizeIdentity(b.name)) return true;

  const groupA = rebrandGroupOf(a);
  const groupB = rebrandGroupOf(b);
  if (groupA && groupB && groupA === groupB) return true;

  if (isPunitiveEntry(a) || isPunitiveEntry(b)) {
    // Adjacency is measured on the ENTRIES, not on the played years: a gap
    // year between them means a different owner may have sat in between.
    const yearAdjacent = b.yearStart === a.yearEnd + 1 || a.yearStart === b.yearEnd + 1;
    if (yearAdjacent) return true;
  }

  return false;
};

/**
 * Segment one slot's set of years into tenures.
 *
 * @param team           league config entry for the slot
 * @param years          the years to segment (ascending); typically the slot's
 *                       orphaned years
 * @param feedIdentityFor (franchiseId, year) => {name, icon, banner} | null —
 *                       the MFL feed's own name for that season, used for gap
 *                       fill. Accurate in both leagues for every covered year,
 *                       and the only way to name AFL 0007's 2015-2020.
 */
export const segmentSlotTenures = ({ team, years, feedIdentityFor }) => {
  const sortedYears = [...new Set(years)].sort((a, b) => a - b);
  if (sortedYears.length === 0) return [];

  const history = [...(team?.history ?? [])].sort((a, b) => a.yearStart - b.yearStart);
  const coveringEntry = (year) =>
    history.find((h) => year >= h.yearStart && year <= h.yearEnd) ?? null;

  const groups = [];
  let current = null;
  // The last REAL history entry in the current group. Gap-filled years never
  // become the bridging reference — otherwise a feed name would decide whether
  // the next real entry continues the tenure.
  let lastRealEntry = null;

  for (const year of sortedYears) {
    const entry = coveringEntry(year);

    let startNew;
    if (current === null) {
      startNew = true;
    } else if (entry === null) {
      // Gap fill: a played year with no covering history entry extends the
      // preceding group.
      startNew = false;
    } else if (entry === lastRealEntry) {
      startNew = false;
    } else {
      startNew = !entriesShareTenure(lastRealEntry, entry);
    }

    if (startNew) {
      current = { years: [], entries: [], identities: [] };
      groups.push(current);
      lastRealEntry = null;
    }

    const feed = entry === null ? feedIdentityFor?.(team.franchiseId, year) ?? null : null;
    const identityName = entry?.name ?? feed?.name ?? null;

    current.years.push(year);
    if (entry) {
      if (!current.entries.includes(entry)) current.entries.push(entry);
      lastRealEntry = entry;
    }

    // Accumulate identities as contiguous runs of one name.
    const last = current.identities[current.identities.length - 1];
    if (last && normalizeIdentity(last.name) === normalizeIdentity(identityName ?? '')) {
      last.yearEnd = year;
      last.years.push(year);
    } else {
      current.identities.push({
        name: identityName,
        nameMedium: entry?.nameMedium ?? null,
        yearStart: year,
        yearEnd: year,
        years: [year],
        icon: entry?.icon ?? feed?.icon ?? null,
        banner: entry?.banner ?? feed?.banner ?? null,
        rebrandGroup: rebrandGroupOf(entry),
        punitive: isPunitiveEntry(entry),
        // Softens the UI and tells a human where the name came from.
        inferredFromFeed: entry === null,
      });
    }
  }

  return groups;
};

/**
 * The identity a tenure is named for: most seasons wins, earliest breaks ties.
 * A one-season punitive rename never becomes the title of a tenure that also
 * contains a real name.
 */
export const dominantIdentity = (identities) => {
  const real = identities.filter((i) => i.name);
  if (real.length === 0) return null;
  const ranked = [...real].sort((a, b) => {
    const nonPunitive = Number(a.punitive) - Number(b.punitive);
    if (nonPunitive !== 0) return nonPunitive;
    const bySeasons = b.years.length - a.years.length;
    if (bySeasons !== 0) return bySeasons;
    return a.yearStart - b.yearStart;
  });
  return ranked[0];
};

/** Distinct display names for a tenure, in chronological order. */
export const identityTitle = (identities) => {
  const seen = new Set();
  const names = [];
  for (const identity of identities) {
    if (!identity.name) continue;
    const key = normalizeIdentity(identity.name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(identity.name);
  }
  return names.join(' / ');
};

// ───────────────────────────────────────────────────────────────────────────
// Aggregation
// ───────────────────────────────────────────────────────────────────────────

const emptyTotals = () => ({
  seasons: 0,
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  playoffAppearances: 0,
  championships: [],
  runnerUps: [],
  thirdPlaces: [],
  divisionTitles: [],
  mvpAwards: [],
  jerryJonesAwards: [],
  osweilerAwards: [],
});

const addRowToTotals = (totals, row) => {
  if (row.seasonNotStarted) return;
  totals.seasons += 1;
  totals.wins += row.wins ?? 0;
  totals.losses += row.losses ?? 0;
  totals.ties += row.ties ?? 0;
  totals.pointsFor += row.pointsFor ?? 0;
  if (row.playoffResult && row.playoffResult !== 'missed') totals.playoffAppearances += 1;
};

/**
 * Trophies come from `yearSummaries`, whose champion / runnerUp / thirdPlace /
 * mvpFranchise / jerryJonesFranchise / brockOsweilerFranchise are RAW MFL
 * franchise ids — written straight from the bracket and award parse, never run
 * through `attributeYear`. That is exactly why the orphaned trophies are
 * recoverable at all (trap 1). `divisionWinners[]` IS attributed, but carries
 * `sourceFranchiseId` alongside, so it works the same way here.
 */
const attachTrophies = (totals, yearSummaries, ownedSlotYears) => {
  const owns = (franchiseId, year) => ownedSlotYears.has(`${franchiseId}|${year}`);

  for (const summary of yearSummaries ?? []) {
    const { year } = summary;
    if (summary.champion && owns(summary.champion, year)) totals.championships.push(year);
    if (summary.runnerUp && owns(summary.runnerUp, year)) totals.runnerUps.push(year);
    if (summary.thirdPlace && owns(summary.thirdPlace, year)) totals.thirdPlaces.push(year);
    if (summary.mvpFranchise && owns(summary.mvpFranchise, year)) totals.mvpAwards.push(year);
    if (summary.jerryJonesFranchise && owns(summary.jerryJonesFranchise, year)) {
      totals.jerryJonesAwards.push(year);
    }
    if (summary.brockOsweilerFranchise && owns(summary.brockOsweilerFranchise, year)) {
      totals.osweilerAwards.push(year);
    }
    for (const winner of summary.divisionWinners ?? []) {
      const source = winner.sourceFranchiseId ?? winner.franchiseId;
      if (source && owns(source, year)) {
        totals.divisionTitles.push({
          year,
          divisionId: winner.divisionId ?? null,
          // `winner.name` is the TEAM's name, `winner.divisionName` the
          // division's — franchise-history.json's own divisionTitles use the
          // latter, so reading `name` here would put "Acer FC Edge" where
          // "Atlantic" belongs and silently diverge the two shapes.
          divisionName: winner.divisionName ?? null,
        });
      }
    }
  }

  totals.championships.sort((a, b) => a - b);
  totals.runnerUps.sort((a, b) => a - b);
  totals.thirdPlaces.sort((a, b) => a - b);
  totals.mvpAwards.sort((a, b) => a - b);
  totals.jerryJonesAwards.sort((a, b) => a - b);
  totals.osweilerAwards.sort((a, b) => a - b);
  totals.divisionTitles.sort((a, b) => a.year - b.year);
  return totals;
};

/**
 * Default icon resolver. Many config `history[].icon` values are dead
 * `theleague.us` / `mfladdons.com` URLs that 404 — which is why the franchise
 * page carries `resolveRowIcon`. Doing the repair once here removes that page
 * logic and makes it testable.
 *
 * @param assetExists optional (path) => boolean, so the compute script can
 *        verify against the real `public/` tree and fall through to the
 *        documented placeholder rather than emitting a broken path.
 */
export const makeIconResolver = ({ league, teams, assetExists = null }) => {
  const isLocal = (p) => typeof p === 'string' && p.startsWith('/assets/');
  const usable = (p) => isLocal(p) && (!assetExists || assetExists(p));

  const byName = new Map();
  for (const team of teams ?? []) {
    if (usable(team.icon)) byName.set(normalizeIdentity(team.name), team.icon);
    for (const entry of team.history ?? []) {
      const key = normalizeIdentity(entry.name);
      if (!byName.has(key) && usable(entry.icon)) byName.set(key, entry.icon);
    }
  }

  return ({ icon, name, franchiseId }) => {
    if (usable(icon)) return icon;
    const named = byName.get(normalizeIdentity(name ?? ''));
    if (named) return named;
    // Per-slot icons exist for TheLeague; the AFL keys its icons by name, so
    // this simply misses there and falls through to the placeholder.
    const perSlot = `/assets/${league.navSlug}/icons/${franchiseId}.png`;
    if (usable(perSlot)) return perSlot;
    return HISTORICAL_TEAM_ICON_FALLBACK;
  };
};

// ───────────────────────────────────────────────────────────────────────────
// Registry overlay
// ───────────────────────────────────────────────────────────────────────────

/**
 * Index a registry into (league|slot|year) → person. Claims are authoritative
 * where they cover; inference fills the rest.
 *
 * A season claimed by two people is a HARD ERROR, not silent last-wins — the
 * whole point of the conservation guarantee is that a season lands on exactly
 * one owner, and a silent overwrite would break it invisibly.
 */
export const indexRegistryClaims = (registry, leagueSlug) => {
  /** key -> [{ person, shared }] */
  const bySeason = new Map();

  for (const person of registry?.people ?? []) {
    for (const claim of person.claims ?? []) {
      if (claim.league !== leagueSlug) continue;
      const end = claim.yearEnd >= OPEN_ENDED_YEAR ? OPEN_ENDED_YEAR : claim.yearEnd;
      for (let year = claim.yearStart; year <= end; year++) {
        if (year > 3000) break; // open-ended claims are clamped by the caller's year set
        const key = `${claim.franchiseId}|${year}`;
        if (!bySeason.has(key)) bySeason.set(key, []);
        const holders = bySeason.get(key);
        if (holders.some((h) => h.person.id === person.id)) continue;
        holders.push({ person, shared: claim.shared === true });
      }
    }
  }

  // A season held by more than one person is legal ONLY when every claim on it
  // says so. Co-ownership is real — some teams are run by two people — but it
  // has to be DECLARED, because the alternative reading of the same data is a
  // registry typo silently handing one owner's seasons to somebody else.
  const conflicts = [];
  for (const [key, holders] of bySeason) {
    if (holders.length < 2) continue;
    if (holders.every((h) => h.shared)) continue;
    conflicts.push({
      key,
      holders: holders.map((h) => `${h.person.id}${h.shared ? '' : ' (not marked shared)'}`),
    });
  }

  if (conflicts.length > 0) {
    const detail = conflicts
      .map((c) => `  ${leagueSlug} ${c.key} claimed by ${c.holders.join(' and ')}`)
      .join('\n');
    throw new Error(
      `owners-registry.json: ${conflicts.length} season(s) claimed by more than one person ` +
        `without every claim being marked "shared": true:\n${detail}`
    );
  }

  return bySeason;
};

// ───────────────────────────────────────────────────────────────────────────
// The build
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build the full owner-tenures payload for one league.
 *
 * @param league          registry entry (slug, navSlug, dataPath, …)
 * @param teams           league config teams
 * @param ledgerRows      season-ledger.json rows
 * @param yearSummaries   franchise-history.json yearSummaries (raw trophy ids)
 * @param feedIdentityFor (franchiseId, year) => {name, icon, banner} | null
 * @param registry        owners-registry.json (optional)
 * @param resolveIcon     (identity) => string (optional)
 */
export const buildOwnerTenures = ({
  league,
  teams,
  ledgerRows,
  yearSummaries = [],
  feedIdentityFor = null,
  registry = null,
  resolveIcon = null,
  generatedAt = null,
}) => {
  // Attribution is NOT recomputed here. The ledger's `attributedTo` was
  // written by `attributeYear` itself, so reading it keeps one source of truth
  // for the ownership boundary rather than adding a sixth implementation that
  // agrees only by luck. `buildAttributor` is exported for the parity test and
  // for PR 3's migration of the other copies onto it.
  const teamById = new Map((teams ?? []).map((t) => [t.franchiseId, t]));
  const icon =
    resolveIcon ?? makeIconResolver({ league, teams });

  /**
   * Rebrand info for a config identity, looked up by NAME + year overlap.
   *
   * Identities below are assembled from LEDGER ROWS, which carry a name and
   * icon but no `rebrand` — so without this the derived file reports every
   * identity as non-punitive, and the 💀 last-place tag the franchise pages
   * render simply disappears. That is what happened: all six of the AFL's
   * punitive rebrands were dropped from owner-tenures.json.
   *
   * Indexed across ALL teams rather than the identity's own slot, because a
   * punitive rebrand can follow an owner onto a different franchise id — which
   * is exactly what `rebrandGroup` exists to express.
   */
  const rebrandsByName = new Map();
  for (const team of teams ?? []) {
    for (const entry of team.history ?? []) {
      if (!entry?.rebrand || !entry.name) continue;
      const key = normalizeIdentity(entry.name);
      if (!rebrandsByName.has(key)) rebrandsByName.set(key, []);
      rebrandsByName.get(key).push(entry);
    }
  }
  const rebrandFor = (name, yearStart, yearEnd) => {
    const candidates = rebrandsByName.get(normalizeIdentity(name ?? '')) ?? [];
    return (
      candidates.find((e) => e.yearStart <= yearEnd && e.yearEnd >= yearStart) ?? null
    );
  };

  const claimed = indexRegistryClaims(registry, league.slug);
  const registryPeople = new Map((registry?.people ?? []).map((p) => [p.id, p]));

  // ── Partition every played season ────────────────────────────────────────
  // Three destinations: a registry HOLDING, the slot's current owner, or an
  // inferred former-owner tenure. Exactly one, always.
  //
  // A "holding" is the SET of people who hold a season together — usually one
  // person, but a shared team has two. Keying on the set rather than on a
  // single person is what keeps conservation intact: the season still belongs
  // to exactly one holding, and the holding then emits one owner entry per
  // member, all sharing the same tenure.
  const byHolding = new Map(); // "id+id" -> { people: [...], rows: [...] }
  const byCurrentOwner = new Map(); // franchiseId (claimant) -> rows
  const orphanRowsBySlot = new Map(); // franchiseId (raw slot) -> rows

  for (const row of ledgerRows) {
    const key = `${row.franchiseId}|${row.year}`;
    const holders = claimed.get(key);
    if (holders?.length) {
      const people = holders.map((h) => h.person).sort((a, b) => a.id.localeCompare(b.id));
      const holdingKey = people.map((p) => p.id).join('+');
      if (!byHolding.has(holdingKey)) byHolding.set(holdingKey, { people, rows: [] });
      byHolding.get(holdingKey).rows.push(row);
      continue;
    }
    if (row.attributedTo) {
      if (!byCurrentOwner.has(row.attributedTo)) byCurrentOwner.set(row.attributedTo, []);
      byCurrentOwner.get(row.attributedTo).push(row);
      continue;
    }
    if (!orphanRowsBySlot.has(row.franchiseId)) orphanRowsBySlot.set(row.franchiseId, []);
    orphanRowsBySlot.get(row.franchiseId).push(row);
  }

  const owners = [];

  const buildTenuresFromRows = (rows) => {
    // One tenure per franchise SLOT — an owner who moved slots (TheLeague's
    // 0011 owner, who held 0010 from 2011-2015) gets one per stint.
    const bySlot = new Map();
    for (const row of rows) {
      if (!bySlot.has(row.franchiseId)) bySlot.set(row.franchiseId, []);
      bySlot.get(row.franchiseId).push(row);
    }
    return [...bySlot.entries()]
      .map(([franchiseId, slotRows]) => {
        const sorted = [...slotRows].sort((a, b) => a.year - b.year);
        const team = teamById.get(franchiseId);
        const identities = [];
        for (const row of sorted) {
          const last = identities[identities.length - 1];
          if (last && normalizeIdentity(last.name) === normalizeIdentity(row.name ?? '')) {
            last.yearEnd = row.year;
            last.years.push(row.year);
          } else {
            identities.push({
              name: row.name,
              nameMedium: row.nameMedium ?? null,
              yearStart: row.year,
              yearEnd: row.year,
              years: [row.year],
              icon: row.icon ?? null,
              banner: row.banner ?? null,
              // Filled in below, once the identity's full year span is known —
              // a rebrand entry is matched by overlap, and the span grows as
              // adjacent same-name rows fold into this identity.
              rebrandGroup: null,
              punitive: false,
              inferredFromFeed: false,
            });
          }
        }
        for (const identity of identities) {
          identity.icon = icon({ icon: identity.icon, name: identity.name, franchiseId });
          const entry = rebrandFor(identity.name, identity.yearStart, identity.yearEnd);
          identity.rebrandGroup = rebrandGroupOf(entry);
          identity.punitive = isPunitiveEntry(entry);
        }
        return {
          franchiseId,
          franchiseName: team?.name ?? null,
          yearStart: sorted[0].year,
          yearEnd: sorted[sorted.length - 1].year,
          identities,
          seasons: sorted.map((r) => ({ ...r })),
        };
      })
      .sort((a, b) => a.yearStart - b.yearStart);
  };

  const finalizeOwner = ({
    ownerId,
    slug,
    previousSlugs,
    displayName,
    source,
    tenures,
    isCurrent,
    currentFranchiseId,
    notes,
    crossLeague,
    isShared = false,
    coOwnerIds = [],
  }) => {
    const ownedSlotYears = new Set();
    for (const tenure of tenures) {
      for (const season of tenure.seasons) {
        ownedSlotYears.add(`${tenure.franchiseId}|${season.year}`);
      }
    }
    const totals = emptyTotals();
    for (const tenure of tenures) for (const season of tenure.seasons) addRowToTotals(totals, season);
    attachTrophies(totals, yearSummaries, ownedSlotYears);

    const allIdentities = tenures.flatMap((t) => t.identities);
    const dominant = dominantIdentity(allIdentities);
    const title = displayName ?? identityTitle(allIdentities) ?? 'Unknown owner';

    // The slot this person holds TODAY, passed in explicitly rather than
    // guessed from tenure order. An owner who moved slots (AFL 0016's
    // 2017-2018 holder now sits on 0008) is `isCurrent` but no longer the
    // current owner OF 0016 — conflating the two puts two live owners on one
    // slot, which `tests/owner-tenures-data.test.ts` rejects.
    const heldToday = isCurrent ? currentFranchiseId ?? null : null;

    return {
      ownerId,
      slug,
      previousSlugs: previousSlugs ?? [],
      displayName: displayName ?? null,
      title,
      dominantName: dominant?.name ?? null,
      icon: dominant
        ? icon({ icon: dominant.icon, name: dominant.name, franchiseId: tenures[0].franchiseId })
        : HISTORICAL_TEAM_ICON_FALLBACK,
      isCurrent,
      source,
      notes: notes ?? null,
      yearStart: Math.min(...tenures.map((t) => t.yearStart)),
      yearEnd: Math.max(...tenures.map((t) => t.yearEnd)),
      currentFranchiseId: heldToday,
      identities: allIdentities,
      tenures,
      totals,
      slotSuccession: {},
      crossLeague: crossLeague ?? [],
      /** A shared team — this tenure is run by more than one person. */
      isShared,
      /** Filled in below, once every owner entry exists to resolve against. */
      coOwners: [],
      coOwnerIds,
    };
  };

  // ── Registry holdings ────────────────────────────────────────────────────
  // One holding may emit several owner entries — a shared team gives each
  // co-owner their own page, both showing the same tenure and the same record.
  for (const [, holding] of byHolding) {
    const isShared = holding.people.length > 1;

    for (const person of holding.people) {
      // Built per person rather than shared by reference: two owner entries
      // pointing at one tenure object would make any later mutation of one
      // silently rewrite the other.
      const tenures = buildTenuresFromRows(holding.rows);
      if (tenures.length === 0) continue;

      // A person is "current" when one of their claims is open-ended on a slot
      // whose present-day holder is that same slot.
      const openClaim = (person.claims ?? []).find(
        (c) => c.league === league.slug && c.yearEnd >= OPEN_ENDED_YEAR
      );
      const isCurrent = Boolean(openClaim);
      const crossLeague = (person.claims ?? [])
        .filter((c) => c.league !== league.slug)
        .map((c) => ({
          league: c.league,
          franchiseId: c.franchiseId,
          yearStart: c.yearStart,
          yearEnd: c.yearEnd,
        }));
      owners.push(
        finalizeOwner({
          ownerId: person.id,
          slug: person.slug,
          previousSlugs: person.previousSlugs ?? [],
          displayName: person.displayName ?? null,
          source: 'registry',
          tenures,
          isCurrent,
          currentFranchiseId: openClaim?.franchiseId ?? null,
          notes: person.notes ?? null,
          crossLeague,
          isShared,
          // Resolved to slugs/titles in a second pass, once every owner exists.
          coOwnerIds: holding.people.filter((p) => p.id !== person.id).map((p) => p.id),
        })
      );
    }
  }

  // ── Inferred current owners ──────────────────────────────────────────────
  for (const [franchiseId, rows] of byCurrentOwner) {
    const tenures = buildTenuresFromRows(rows);
    if (tenures.length === 0) continue;
    const team = teamById.get(franchiseId);
    const allIdentities = tenures.flatMap((t) => t.identities);
    const dominant = dominantIdentity(allIdentities);
    const firstYear = Math.min(...tenures.map((t) => t.yearStart));
    owners.push(
      finalizeOwner({
        ownerId: `auto:${league.slug}:${franchiseId}:${firstYear}`,
        slug: `${kebab(team?.name ?? dominant?.name ?? franchiseId)}-${firstYear}`,
        previousSlugs: [],
        displayName: null,
        source: 'inferred',
        tenures,
        isCurrent: true,
        currentFranchiseId: franchiseId,
        notes: null,
        crossLeague: [],
      })
    );
  }

  // ── Inferred former owners ───────────────────────────────────────────────
  for (const [franchiseId, rows] of orphanRowsBySlot) {
    const team = teamById.get(franchiseId) ?? { franchiseId, history: [] };
    const years = rows.map((r) => r.year);
    const groups = segmentSlotTenures({ team, years, feedIdentityFor });
    const rowByYear = new Map(rows.map((r) => [r.year, r]));

    for (const group of groups) {
      const seasons = group.years.map((y) => rowByYear.get(y)).filter(Boolean);
      if (seasons.length === 0) continue;
      const sorted = [...seasons].sort((a, b) => a.year - b.year);

      for (const identity of group.identities) {
        identity.icon = icon({ icon: identity.icon, name: identity.name, franchiseId });
      }

      const tenure = {
        franchiseId,
        franchiseName: team.name ?? null,
        yearStart: sorted[0].year,
        yearEnd: sorted[sorted.length - 1].year,
        identities: group.identities,
        // The ledger row already carries the era-correct name; prefer the
        // segmented identity name for gap-filled years, which the ledger
        // cannot know.
        seasons: sorted.map((row) => {
          const identity = group.identities.find((i) => i.years.includes(row.year));
          return identity?.inferredFromFeed && identity.name
            ? { ...row, name: identity.name, inferredFromFeed: true }
            : { ...row };
        }),
      };

      const dominant = dominantIdentity(group.identities);
      owners.push(
        finalizeOwner({
          ownerId: `auto:${league.slug}:${franchiseId}:${tenure.yearStart}`,
          slug: `${kebab(dominant?.name ?? franchiseId)}-${tenure.yearStart}`,
          previousSlugs: [],
          displayName: null,
          source: 'inferred',
          tenures: [tenure],
          isCurrent: false,
          currentFranchiseId: null,
          notes: null,
          crossLeague: [],
        })
      );
    }
  }

  // ── Indexes + succession ─────────────────────────────────────────────────
  // Slug collisions. `kebab(dominantName)-firstYear` is unique in practice but
  // not by construction — two slots can wear the same name from the same year.
  // A collision would silently make one owner's page unreachable, so append the
  // slot id deterministically. Registry slugs are frozen and always win; only
  // inferred slugs get rewritten.
  const slugOwners = new Map();
  for (const owner of owners) {
    if (!slugOwners.has(owner.slug)) slugOwners.set(owner.slug, []);
    slugOwners.get(owner.slug).push(owner);
  }
  for (const [slug, sharing] of slugOwners) {
    if (sharing.length < 2) continue;
    const registryHolders = sharing.filter((o) => o.source === 'registry');
    const rewritable = registryHolders.length > 0 ? sharing.filter((o) => o.source !== 'registry') : sharing.slice(1);
    for (const owner of rewritable) {
      owner.slug = `${slug}-${owner.tenures[0].franchiseId}`;
    }
  }

  owners.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.yearStart !== b.yearStart) return a.yearStart - b.yearStart;
    return a.slug.localeCompare(b.slug);
  });

  const bySlot = {};
  for (const owner of owners) {
    for (const tenure of owner.tenures) {
      if (!bySlot[tenure.franchiseId]) bySlot[tenure.franchiseId] = [];
      bySlot[tenure.franchiseId].push({ slug: owner.slug, yearStart: tenure.yearStart });
    }
  }
  for (const slot of Object.keys(bySlot)) {
    bySlot[slot].sort((a, b) => a.yearStart - b.yearStart);
  }

  // Predecessor / successor per slot, so a page can say "Franchise 0010 today:
  // Computer Jocks →".
  //
  // Succession runs over HOLDINGS, not owner entries. Two co-owners of a
  // shared team occupy ONE position in the chain — walking owner entries
  // instead would make each co-owner the other's predecessor, inventing a
  // handover between two people who ran the team at the same time.
  const ownerBySlug = new Map(owners.map((o) => [o.slug, o]));
  for (const [slot, entries] of Object.entries(bySlot)) {
    const holdings = [];
    for (const entry of entries) {
      const last = holdings[holdings.length - 1];
      if (last && last.yearStart === entry.yearStart) {
        last.slugs.push(entry.slug);
      } else {
        holdings.push({ yearStart: entry.yearStart, slugs: [entry.slug] });
      }
    }
    holdings.forEach((holding, index) => {
      // A neighbouring shared holding contributes its first co-owner as the
      // link target; the page names the rest via that owner's own coOwners.
      const previous = index > 0 ? holdings[index - 1].slugs[0] : null;
      const next = index < holdings.length - 1 ? holdings[index + 1].slugs[0] : null;
      for (const slug of holding.slugs) {
        const owner = ownerBySlug.get(slug);
        if (!owner) continue;
        owner.slotSuccession[slot] = { previous, next };
      }
    });
  }

  // Resolve co-owners now that every owner entry (and its final, possibly
  // disambiguated slug) exists.
  const ownerById = new Map(owners.map((o) => [o.ownerId, o]));
  for (const owner of owners) {
    owner.coOwners = (owner.coOwnerIds ?? [])
      .map((id) => ownerById.get(id))
      .filter(Boolean)
      .map((co) => ({
        slug: co.slug,
        title: co.title,
        displayName: co.displayName,
        // Co-owners of one team wear the SAME identities, so in this league's
        // file their titles are identical ("Co-owned with Cowboy Up" tells the
        // reader nothing). While owners are anonymous, their other league is
        // the only thing that distinguishes them — carry it so the page can
        // say "the AFL franchise 0016 owner" instead.
        crossLeague: co.crossLeague ?? [],
      }));
    delete owner.coOwnerIds;
  }

  // Keyed exactly as buildHistoricalIdentities() returns, so the franchises
  // index can resolve a former identity to its owner page with one lookup.
  const identityIndex = {};
  for (const owner of owners) {
    for (const identity of owner.identities) {
      if (!identity.name) continue;
      const key = `${normalizeIdentity(identity.name)}|${identity.yearStart}`;
      if (!identityIndex[key]) identityIndex[key] = owner.slug;
    }
  }

  const slotIndex = {};
  for (const [slot, entries] of Object.entries(bySlot)) {
    slotIndex[slot] = entries.map((e) => e.slug);
  }

  return {
    generatedAt: generatedAt ?? new Date().toISOString(),
    league: league.slug,
    counts: {
      total: owners.length,
      current: owners.filter((o) => o.isCurrent).length,
      former: owners.filter((o) => !o.isCurrent).length,
      // DISTINCT franchise-seasons covered. A shared team is held by two
      // owners, so summing per-owner season counts would report more seasons
      // than the league has actually played.
      seasons: new Set(
        owners.flatMap((o) =>
          o.tenures.flatMap((t) => t.seasons.map((season) => `${t.franchiseId}|${season.year}`))
        )
      ).size,
      /** Owner entries that share a team with someone else. */
      shared: owners.filter((o) => o.isShared).length,
    },
    owners,
    bySlot: slotIndex,
    identityIndex,
  };
};
