/**
 * Types for the owner-tenures derived data.
 *
 * The producer is `src/utils/owner-tenures.mjs` (plain .mjs so node scripts and
 * .astro pages share one implementation); these interfaces describe what
 * `data/<league>/derived/owner-tenures.json` contains.
 *
 * See docs/plans/owners-feature.md for the why.
 */

/** One identity worn during a tenure — a team name and the years it was used. */
export interface OwnerIdentity {
  name: string | null;
  nameMedium: string | null;
  yearStart: number;
  yearEnd: number;
  years: number[];
  icon: string | null;
  banner: string | null;
  /** `rebrand.group` from the league config, when the entry carried one. */
  rebrandGroup: string | null;
  /** A last-place forfeit rename — transparently the same owner. */
  punitive: boolean;
  /**
   * The name came from the MFL feed rather than a config `history[]` entry,
   * because no entry covered this year. The UI should soften it, and it tells
   * a human where to look to confirm.
   */
  inferredFromFeed: boolean;
}

/** One season as recorded in the ledger, carried through to the owner page. */
export interface OwnerSeason {
  year: number;
  franchiseId: string;
  attributedTo: string | null;
  name: string | null;
  nameMedium: string | null;
  icon: string | null;
  banner: string | null;
  isHistorical?: boolean;
  sourceFranchiseId: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  regSeasonRank: number | null;
  divisionId: string | null;
  divisionName: string | null;
  wonDivision: boolean;
  playoffResult: string;
  seasonNotStarted: boolean;
  inferredFromFeed?: boolean;
}

/** One continuous stint on ONE franchise slot. */
export interface OwnerTenure {
  franchiseId: string;
  franchiseName: string | null;
  yearStart: number;
  yearEnd: number;
  identities: OwnerIdentity[];
  seasons: OwnerSeason[];
}

export interface OwnerDivisionTitle {
  year: number;
  divisionId: string | null;
  divisionName: string | null;
}

export interface OwnerTotals {
  seasons: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  playoffAppearances: number;
  championships: number[];
  runnerUps: number[];
  thirdPlaces: number[];
  divisionTitles: OwnerDivisionTitle[];
  mvpAwards: number[];
  jerryJonesAwards: number[];
  osweilerAwards: number[];
}

/** Previous / next owner of a given slot, for the succession footer. */
export interface SlotSuccession {
  previous: string | null;
  next: string | null;
}

/** A claim this person holds in a DIFFERENT league. */
export interface CrossLeagueClaim {
  league: string;
  franchiseId: string;
  yearStart: number;
  yearEnd: number;
}

export interface Owner {
  /** Opaque and stable. `own-NNNN` from the registry, or `auto:…` when inferred. */
  ownerId: string;
  /** URL segment. Frozen once seeded into the registry. */
  slug: string;
  /** Old slugs that should 301 to the current one. */
  previousSlugs: string[];
  /** Null until a human adds a name — the feature ships anonymous. */
  displayName: string | null;
  /** `displayName` when set, otherwise the identities worn, joined. */
  title: string;
  dominantName: string | null;
  icon: string;
  isCurrent: boolean;
  /** Where this owner came from: a registry claim, or inference. */
  source: 'registry' | 'inferred';
  notes: string | null;
  yearStart: number;
  yearEnd: number;
  /**
   * The slot this person holds TODAY, or null if they are gone. Not the same
   * as "has a tenure on this slot" — an owner who moved slots is still current
   * but is no longer the current owner of the slot they left.
   */
  currentFranchiseId: string | null;
  identities: OwnerIdentity[];
  tenures: OwnerTenure[];
  totals: OwnerTotals;
  slotSuccession: Record<string, SlotSuccession>;
  crossLeague: CrossLeagueClaim[];
  /**
   * A shared team — this tenure is run by more than one person. The record is
   * the TEAM's and counts in full for every co-owner, which is why the file's
   * `counts.seasons` is distinct franchise-seasons rather than a sum.
   */
  isShared: boolean;
  /** The other people who share this tenure. Always mutual. */
  coOwners: { slug: string; title: string; displayName: string | null }[];
}

export interface OwnerTenuresFile {
  generatedAt: string;
  league: string;
  counts: {
    total: number;
    current: number;
    former: number;
    /** DISTINCT franchise-seasons covered, not summed per owner. */
    seasons: number;
    /** Owner entries that share a team with someone else. */
    shared: number;
  };
  owners: Owner[];
  /** franchiseId → owner slugs, oldest first. */
  bySlot: Record<string, string[]>;
  /**
   * `${normalizeIdentity(name)}|${yearStart}` → owner slug. Keyed exactly as
   * `buildHistoricalIdentities()` returns, so the franchises index can resolve
   * a former identity to its owner page in one lookup.
   */
  identityIndex: Record<string, string>;
}

/** A hand-edited claim in src/data/owners-registry.json. */
export interface OwnerClaim {
  league: string;
  franchiseId: string;
  yearStart: number;
  /** 9999 = open-ended, matching the existing ownerHistory convention. */
  yearEnd: number;
  /**
   * This franchise is co-owned. Two people may claim the same season ONLY when
   * BOTH claims set this — otherwise the overlap is indistinguishable from a
   * typo handing one owner's tenure to somebody else, and the build fails.
   */
  shared?: boolean;
}

export interface RegistryPerson {
  id: string;
  slug: string;
  previousSlugs: string[];
  displayName: string | null;
  claims: OwnerClaim[];
  seededFrom: string | null;
  notes: string | null;
}

export interface OwnersRegistry {
  version: number;
  people: RegistryPerson[];
}
