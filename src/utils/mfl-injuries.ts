/**
 * MFL injury designations — the shared reader for `injuries.json`.
 *
 * An NFL injury designation (Questionable / Doubtful / Out / IR) is NOT the
 * same thing as MFL's roster bucket (`status: 'INJURED_RESERVE'`). The bucket
 * says which section of the roster a player sits in; the designation says
 * whether he is expected to play on Sunday. The AFL roster page rendered the
 * bucket and nothing else, so a player could read as a healthy active starter
 * while MFL itself showed him on IR with a torn ACL (reported 2026-09-22,
 * Charbonnet).
 *
 * **The feed is keyed by the NEWEST year on disk, not the league year.** The
 * designation is NFL-wide — `data/theleague/.../injuries.json` and
 * `data/afl-fantasy/.../injuries.json` are byte-identical, both refreshed by
 * the roster-sync workflow — but the two leagues' pages do NOT run on the same
 * year. The AFL's rosters page is pinned to 2025 (`FALLBACK_YEAR`, because the
 * 2026 AFL league does not exist on MFL yet) while `injuries.json` is only ever
 * written for the current year, 2026. Keying this lookup off the page's
 * selected year — the obvious move — therefore finds nothing at all on the AFL
 * and fails silently, which is the bug this module exists to prevent.
 */

/** One player's NFL injury designation, as MFL reports it. */
export interface PlayerInjury {
  /** 'Questionable' | 'Doubtful' | 'Out' | 'IR' | 'Retired' | … (MFL's own wording). */
  injuryStatus: string;
  /** Free text from MFL, e.g. 'Knee - ACL'. May be absent. */
  injuryBodyPart?: string;
  /** Free text from MFL, e.g. 'Oct 11, 2026'. May be absent. */
  expectedReturn?: string;
}

/** MFL player id → designation. Players with no designation are absent. */
export type InjuryMap = Record<string, PlayerInjury>;

/**
 * Eagerly globbed per league, because `import.meta.glob` needs a literal
 * pattern — a registry `dataPath` cannot be interpolated here. Adding a league
 * means adding its glob; `loadInjuryMap` returns {} for any slug with no entry,
 * so a league with no feed degrades to "no badges" rather than throwing.
 */
const INJURY_FEEDS: Record<string, Record<string, unknown>> = {
  theleague: import.meta.glob('../../data/theleague/mfl-feeds/*/injuries.json', {
    eager: true,
  }),
  'afl-fantasy': import.meta.glob('../../data/afl-fantasy/mfl-feeds/*/injuries.json', {
    eager: true,
  }),
};

/**
 * The injury map for a league, taken from the newest year present on disk.
 *
 * Total: an unknown slug, a missing feed or a malformed payload all yield an
 * empty map, so every caller's "no designation" path is the same path.
 *
 * @param slug Registry league slug ('theleague' | 'afl-fantasy' | …).
 */
export function loadInjuryMap(slug: string): InjuryMap {
  const feeds = INJURY_FEEDS[slug];
  if (!feeds) return {};

  let newestYear = -1;
  let newest: InjuryMap = {};

  for (const [path, mod] of Object.entries(feeds)) {
    const matched = path.match(/mfl-feeds\/(\d{4})\//);
    const year = matched ? Number(matched[1]) : -1;
    if (year <= newestYear) continue;

    const data = (mod as { default?: unknown })?.default ?? mod;
    const injuries = (data as { injuries?: unknown } | null)?.injuries;
    if (!injuries || typeof injuries !== 'object') continue;

    newestYear = year;
    newest = injuries as InjuryMap;
  }

  return newest;
}

/**
 * The badge's visible text — the designation's first letter, in parentheses.
 *
 * One definition on purpose: TheLeague's roster page has rendered
 * `(${status.substring(0, 1)})` since this badge shipped, and the AFL copy is
 * meant to be indistinguishable from it. Two leagues rendering the same datum
 * two ways is the drift this repo keeps paying for.
 */
export function injuryBadgeLabel(injuryStatus: string): string {
  return `(${injuryStatus.substring(0, 1)})`;
}

/** The badge's `title` / tooltip: status, plus the body part when MFL has one. */
export function injuryBadgeTitle(injury: PlayerInjury): string {
  return `${injury.injuryStatus}${injury.injuryBodyPart ? ` - ${injury.injuryBodyPart}` : ''}`;
}

/**
 * The badge as an HTML string, for the client-side renders that build rows
 * with `innerHTML` (`buildPlayerCellHTML`'s `afterName`, `buildBenchRowHTML`).
 *
 * `interactive: true` produces the roster page's button, which opens the injury
 * modal. The lineup pages pass `false`: their slots are themselves tap targets
 * that open the player picker, so a focusable button inside one either swallows
 * the tap or needs its own `stopPropagation` — a second way to mis-set a lineup
 * in the week it matters. A `<span>` with a `title` states the designation
 * without competing for the tap.
 */
export function injuryBadgeHTML(
  injury: PlayerInjury,
  { interactive = false }: { interactive?: boolean } = {},
): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const title = escape(injuryBadgeTitle(injury));
  const label = escape(injuryBadgeLabel(injury.injuryStatus));

  if (!interactive) {
    return `<span class="injury-indicator injury-indicator--static" title="${title}" aria-label="${title}">${label}</span>`;
  }
  return `<button type="button" class="injury-indicator" data-injury-status="${escape(injury.injuryStatus)}" data-injury-body-part="${escape(injury.injuryBodyPart ?? '')}" title="${title}" aria-label="${title}">${label}</button>`;
}
