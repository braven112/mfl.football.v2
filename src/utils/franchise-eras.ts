/**
 * Franchise era + historical-identity helpers shared by the franchise
 * detail page and the franchises index.
 *
 * The detail page ([id].astro) builds owner-scoped "eras" from a team's
 * config history (and ownerHistory when the owner moved between franchise
 * slots), then only renders eras that have at least one season in the
 * franchise's yearByYear data. The index page needs the exact same
 * computation to know which `#era-{yearStart}` anchors actually exist
 * before linking to them — a link into an era the detail page filters out
 * lands at the top of the page as a dead-end.
 */

export interface TeamHistoryEntry {
  name: string;
  nameMedium?: string;
  yearStart: number;
  yearEnd: number;
  icon?: string;
  banner?: string;
  /** Groups multiple aliases used by one owner into a single era. */
  ownerEra?: number;
}

export interface OwnerHistoryEntry {
  franchiseId: string;
  yearStart: number;
  yearEnd: number;
}

export interface TeamConfigLike {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  icon?: string;
  banner?: string;
  history?: TeamHistoryEntry[];
  ownerHistory?: OwnerHistoryEntry[];
}

export interface FranchiseEra {
  name: string;
  nameMedium?: string;
  yearStart: number;
  yearEnd: number;
  banner?: string;
  icon?: string;
  isCurrent: boolean;
  sourceFranchiseId?: string | null;
}

export interface HistoricalIdentity {
  franchiseId: string;
  name: string;
  yearStart: number;
  yearEnd: number;
  banner: string | null;
  icon: string | null;
}

/** Collapse casing, whitespace, and a leading "The " for identity matching. */
export const normalizeIdentity = (s: string): string =>
  (s || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ');

type EraGroup = { entries: TeamHistoryEntry[]; key: string };

// Group history entries by ownerEra (when set) so multiple aliases under one
// owner collapse to a single era with a combined name like "Poker in the
// Rear / Generals". Entries without ownerEra fall back to name-grouping.
// Adjacent-only: two separate stints under the same name stay distinct.
const groupHistory = (history: TeamHistoryEntry[]): EraGroup[] => {
  const groups: EraGroup[] = [];
  for (const h of history) {
    const key = h.ownerEra != null ? `era:${h.ownerEra}` : `name:${normalizeIdentity(h.name)}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.entries.push(h);
    } else {
      groups.push({ key, entries: [h] });
    }
  }
  return groups;
};

const dominantNames = (entries: TeamHistoryEntry[]): [string, number][] => {
  const tally = new Map<string, number>();
  for (const e of entries) {
    const span = e.yearEnd - e.yearStart + 1;
    tally.set(e.name, (tally.get(e.name) || 0) + span);
  }
  return Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
};

/**
 * Build the owner-scoped era list for one franchise — the exact list the
 * franchise detail page renders (before its "has seasons" render filter).
 *
 * @param team        Config entry for the franchise (may be undefined when
 *                    the derived history has a franchise the config lacks).
 * @param allTeams    Every team config entry — needed to resolve identities
 *                    when ownerHistory points at another franchise slot.
 * @param seasonYears Years present in the franchise's yearByYear data.
 * @param currentYear Defaults to the calendar year.
 */
export function buildFranchiseEras(
  team: TeamConfigLike | undefined,
  allTeams: TeamConfigLike[],
  seasonYears: number[],
  currentYear: number = new Date().getFullYear()
): FranchiseEra[] {
  if (!team || seasonYears.length === 0) return [];

  const minYear = Math.min(...seasonYears);
  const maxYear = Math.max(...seasonYears);
  const currentNorm = normalizeIdentity(team.name);
  const eras: FranchiseEra[] = [];

  // Resolve the identity (name/banner/icon) for a given franchise ID + year
  // by reading its config history. Used when one team's owner held a
  // different franchise ID for some years.
  const lookupIdentityFor = (franchiseId: string, year: number) => {
    const t = allTeams.find((x) => x.franchiseId === franchiseId);
    if (!t) return null;
    if (Array.isArray(t.history)) {
      for (const h of t.history) {
        if (year >= h.yearStart && year <= h.yearEnd) {
          return { name: h.name, nameMedium: h.nameMedium ?? h.name, banner: h.banner, icon: h.icon };
        }
      }
    }
    return { name: t.name, nameMedium: t.nameMedium ?? t.name, banner: t.banner, icon: t.icon };
  };

  const buildEraFromGroup = (group: EraGroup): FranchiseEra => {
    const sortedNames = dominantNames(group.entries);
    const dominantName = sortedNames[0][0];
    const displayName =
      sortedNames.length > 1 ? sortedNames.map(([n]) => n).join(' / ') : dominantName;
    const dominantEntry = group.entries.find((e) => e.name === dominantName) ?? group.entries[0];
    return {
      name: displayName,
      nameMedium: displayName,
      yearStart: Math.min(...group.entries.map((e) => e.yearStart)),
      yearEnd: Math.max(...group.entries.map((e) => e.yearEnd)),
      banner: dominantEntry.banner,
      icon: dominantEntry.icon,
      isCurrent: normalizeIdentity(dominantName) === currentNorm,
    };
  };

  const pushOrExtend = (entry: FranchiseEra) => {
    const last = eras[eras.length - 1];
    // Only merge if the name AND the underlying franchise are the same — two
    // separate stints that share a name (e.g. Midwestside on 0010 then on
    // 0011) should remain visually distinct so the gap between them is
    // visible.
    if (
      last &&
      normalizeIdentity(last.name) === normalizeIdentity(entry.name) &&
      (last.sourceFranchiseId ?? null) === (entry.sourceFranchiseId ?? null)
    ) {
      last.yearEnd = Math.max(last.yearEnd, entry.yearEnd);
      last.yearStart = Math.min(last.yearStart, entry.yearStart);
      if (entry.isCurrent) last.isCurrent = true;
      last.banner = entry.banner ?? last.banner;
      last.icon = entry.icon ?? last.icon;
      return;
    }
    eras.push(entry);
  };

  if (Array.isArray(team.ownerHistory) && team.ownerHistory.length > 0) {
    // Owner-driven era construction — one era per ownerHistory entry, with
    // the identity sourced from the relevant franchise's history config.
    // Keeps both stints (e.g. Midwestside Connection on 0010 in 2012-2015
    // and on 0011 in 2019+) on the same page.
    const sortedOwner = [...team.ownerHistory].sort((a, b) => a.yearStart - b.yearStart);
    for (const entry of sortedOwner) {
      const cap = Math.min(entry.yearEnd, maxYear, currentYear);
      if (cap < entry.yearStart) continue;
      const midYear = entry.yearStart + Math.floor((cap - entry.yearStart) / 2);
      const ident = lookupIdentityFor(entry.franchiseId, midYear);
      if (!ident) continue;
      pushOrExtend({
        name: ident.name,
        nameMedium: ident.nameMedium,
        yearStart: entry.yearStart,
        yearEnd: entry.yearEnd >= 9999 ? 9999 : entry.yearEnd,
        banner: ident.banner ?? team.banner,
        icon: ident.icon ?? team.icon,
        isCurrent: entry.franchiseId === team.franchiseId && entry.yearEnd >= 9999,
        sourceFranchiseId: entry.franchiseId !== team.franchiseId ? entry.franchiseId : null,
      });
    }
  } else if (Array.isArray(team.history) && team.history.length > 0) {
    for (const group of groupHistory(team.history)) {
      pushOrExtend(buildEraFromGroup(group));
    }
    const earliestHistoryYear = Math.min(...team.history.map((h) => h.yearStart));
    const latestHistoryYear = Math.max(...team.history.map((h) => h.yearEnd));
    // Append a current era covering the years after the latest config entry.
    // If the current name matches the most recent history entry, this just
    // extends that era's yearEnd via pushOrExtend.
    if (latestHistoryYear < maxYear || latestHistoryYear < currentYear) {
      pushOrExtend({
        name: team.name,
        nameMedium: team.nameMedium ?? team.name,
        yearStart: latestHistoryYear + 1,
        yearEnd: 9999,
        banner: team.banner,
        icon: team.icon,
        isCurrent: true,
      });
    }
    if (minYear < earliestHistoryYear) {
      eras.unshift({
        name: 'Earlier eras',
        nameMedium: 'Earlier eras',
        yearStart: minYear,
        yearEnd: earliestHistoryYear - 1,
        banner: undefined,
        icon: undefined,
        isCurrent: false,
      });
    }
  } else {
    eras.push({
      name: team.name,
      nameMedium: team.nameMedium ?? team.name,
      yearStart: minYear,
      yearEnd: 9999,
      banner: team.banner,
      icon: team.icon,
      isCurrent: true,
    });
  }
  eras.sort((a, b) => a.yearStart - b.yearStart);
  return eras;
}

/**
 * The era anchors the detail page actually renders: it filters eras to
 * those with at least one played season, and each rendered era gets
 * `id="era-{yearStart}"`. Returns that set of yearStarts.
 */
export function renderedEraStarts(
  team: TeamConfigLike | undefined,
  allTeams: TeamConfigLike[],
  seasonYears: number[],
  currentYear: number = new Date().getFullYear()
): Set<number> {
  const eras = buildFranchiseEras(team, allTeams, seasonYears, currentYear);
  return new Set(
    eras
      .filter((e) => seasonYears.some((y) => y >= e.yearStart && y <= e.yearEnd))
      .map((e) => e.yearStart)
  );
}

/**
 * Build the "Former Identities" list for a franchises index page — every
 * distinct historical identity across all teams, excluding groups whose
 * dominant name matches the team's current name (banner refreshes, casing
 * tweaks, "The " prefix changes). Sorted newest-first.
 *
 * Unlike the detail page's adjacency grouping, identities group across
 * non-adjacent stints by name (a name that came back after a gap is still
 * one identity in the strip).
 */
export function buildHistoricalIdentities(teams: TeamConfigLike[]): HistoricalIdentity[] {
  const identities: HistoricalIdentity[] = [];
  for (const team of teams) {
    if (!Array.isArray(team.history)) continue;
    const currentNorm = normalizeIdentity(team.name);
    const groups = new Map<string, TeamHistoryEntry[]>();
    for (const h of team.history) {
      const groupKey =
        h.ownerEra != null ? `era:${h.ownerEra}` : `name:${normalizeIdentity(h.name)}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(h);
    }
    for (const entries of groups.values()) {
      const sortedNames = dominantNames(entries);
      const dominantName = sortedNames[0][0];
      if (normalizeIdentity(dominantName) === currentNorm) continue;
      const displayName =
        sortedNames.length > 1 ? sortedNames.map(([n]) => n).join(' / ') : dominantName;
      const dominantEntry =
        entries.find((e) => e.name === dominantName && e.icon) ??
        entries.find((e) => e.icon) ??
        entries[0];
      identities.push({
        franchiseId: team.franchiseId,
        name: displayName,
        yearStart: Math.min(...entries.map((e) => e.yearStart)),
        yearEnd: Math.max(...entries.map((e) => e.yearEnd)),
        banner: entries[0].banner ?? null,
        icon: dominantEntry.icon ?? null,
      });
    }
  }
  identities.sort((a, b) => b.yearEnd - a.yearEnd || b.yearStart - a.yearStart);
  return identities;
}
