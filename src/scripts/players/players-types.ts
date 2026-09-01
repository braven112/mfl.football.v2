/**
 * Shared types for the free-agent table scripts.
 *
 * These pages were classic `define:vars` blocks until 2026-09-01, so none of
 * this was ever type-checked. The rows come from MFL, reshaped per league in
 * each page's frontmatter, and the two leagues carry different columns
 * (TheLeague has contracts/salary/auction, the AFL has conference and ADP).
 *
 * `PlayerRow` therefore describes the fields both pages actually read and
 * keeps an index signature for the rest, rather than pretending to a precision
 * that isn't there. That is deliberate: an over-tight interface here would
 * have to be loosened at every call site with a cast, which is worse than
 * saying plainly that the tail of this object is untyped.
 */

export interface PlayerRow {
  id: string;
  /** Always emitted by both pages' frontmatter; the renderers assume them. */
  name: string;
  position: string;
  team: string;
  /** Present on the AFL page; absent on TheLeague's. */
  conference?: string | null;
  /**
   * Everything else the two leagues' frontmatter attaches — salary, contract
   * years, auction bid state, ADP, snap counts, and more, differing per
   * league. `any`, not `unknown`, on purpose: `unknown` would force a cast at
   * every one of the ~60 read sites, which buys no safety and hides the real
   * point, which is that this tail has never been typed. Narrowing it is
   * worthwhile work; doing it as part of moving the file was not.
   */
  [key: string]: any;
}

/** One ranking column injected by src/utils/rankings-table over CustomEvents. */
export interface RankingColumnState {
  /** Which imported board this column reads, and the key into `byImport`. */
  importId: string;
  label?: string;
  isAverage?: boolean;
  isComposite?: boolean;
  /** Marks the last member of a composite group, for the group border. */
  isLastCompositeMember?: boolean;
  [key: string]: unknown;
}

/**
 * The rankings state each page keeps. Populated over CustomEvents rather than
 * an import, because these scripts could not import when the bridge was built.
 */
export interface RankingLookupState {
  /** importId -> (playerId -> rank). Absent rank means the board omits them. */
  byImport: Map<string, Map<string, number | null> | undefined>;
  columns: RankingColumnState[];
  available?: boolean;
  [key: string]: unknown;
}
