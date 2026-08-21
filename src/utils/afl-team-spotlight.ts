/**
 * AFL team snapshot "spotlight" tile — the fourth metric on the homepage's
 * offseason team card.
 *
 * This slot used to be "Keepers — X of 7 protected" and rendered `—` for
 * everyone, forever: the homepage never passed a count, and there was no count
 * to pass. AFL has no MFL keeper construct (`afl-keepers-storage.ts` — the
 * offseason auction wipes the slate); the "keeper plan" is a private Redis
 * scratchpad, so the number measured whether an owner had opened a planning
 * page, not anything about the team. Even sourced from MFL it was dead: the
 * preseason roster feed is exactly 7 players for all 24 franchises, so the
 * tile would have read "7 of 7" league-wide.
 *
 * What replaces it rotates on the league calendar, most timely first, and
 * falls through whenever a tier has nothing to say:
 *
 *   1. `draft`  — June 1 until that franchise's conference draft finishes.
 *                 The base (earned) round-1 slot, asterisked when trades moved
 *                 the owner off it.
 *   2. `title`  — the most recent trophy, with the best one appended when they
 *                 differ. 12 of 24 franchises differ, so both get surfaced.
 *   3. `streak` — an ACTIVE playoff streak only. Deliberately never a drought:
 *                 the franchises that reach this tier are exactly the ones with
 *                 no hardware, and every one of them is currently on a drought
 *                 (the Micks have not made it since 2006). A counter of your own
 *                 misery is not what this slot is for; they fall to `record`.
 *   4. `record` — all-time W-L. Always resolves, so the chain is total.
 *
 * The resolver is pure and data-injected so `tests/afl-team-spotlight.test.ts`
 * can drive every tier without feeds; only `resolveAflTeamSpotlight` touches
 * the bundled award/standings data, and the streak tier's 2.7 MB history file
 * is loaded lazily (see `loadPlayoffResults`) so the ~80% of franchises that
 * own a trophy never pay for it.
 */
import type { AwardSlug } from './afl-awards';
import { getFranchiseTrophyCase } from './afl-awards';
import { getAflCareerStats } from './afl-career-stats';

export type AflSpotlightKind = 'draft' | 'title' | 'streak' | 'record';

export interface AflSpotlight {
  kind: AflSpotlightKind;
  /** Tile label (the small caps line). */
  label: string;
  /** Headline value. */
  value: string;
  /** Sub line under the label. */
  sub: string;
  /** Sprite icon id, without the `icon-` prefix. */
  icon: string;
  href: string;
  /**
   * Long-form description for the tile's `title`/`aria-label`. The asterisk on
   * a traded draft slot is meaningless without one, and "1.10*" alone is not
   * something a screen reader can convey.
   */
  hint: string;
}

/**
 * Priority order for "best" trophy, league-defined. Mirrors the order Brandon
 * specified; `afl-cup` is not in that list because it is retired (2015-17,
 * replaced by the Premier League), and it slots directly under the AFL
 * Championship as the other gold-tier knockout trophy. No franchise's best is
 * currently a Cup, so its exact rank is only a tiebreak today.
 */
const TITLE_PRIORITY: AwardSlug[] = [
  'afl-championship',
  'afl-cup',
  'premier-league',
  'al-champion',
  'nl-champion',
  'al-north',
  'al-central',
  'al-south',
  'nl-east',
  'nl-west',
  'nl-pacific',
  'dleague-champion',
  'nit',
];

/**
 * Compact names used whenever the sub line has to carry TWO trophies. On its
 * own "NIT Champion" reads better than "NIT" and gets the full label; paired
 * with a best-ever tail it would wrap the tile to two lines, so both halves
 * shorten together. Division titles are already short and have no entry.
 */
const SHORT_LABEL: Partial<Record<AwardSlug, string>> = {
  'afl-championship': 'AFL',
  'afl-cup': 'Cup',
  'premier-league': 'Premier',
  'al-champion': 'AL',
  'nl-champion': 'NL',
  'dleague-champion': 'D-League',
  nit: 'NIT',
};

function priorityOf(slug: AwardSlug): number {
  const i = TITLE_PRIORITY.indexOf(slug);
  // An award added to the taxonomy but not to TITLE_PRIORITY ranks last rather
  // than first, which is what `indexOf`'s -1 would otherwise do.
  return i === -1 ? TITLE_PRIORITY.length : i;
}

function shortLabel(slug: AwardSlug, label: string): string {
  return SHORT_LABEL[slug] ?? label;
}

/** Two-digit year for the "· AFL '13" tail. */
function apostropheYear(year: number): string {
  return `'${String(year % 100).padStart(2, '0')}`;
}

// ── Draft slot ──────────────────────────────────────────────────────────────

export interface AflDraftSlot {
  /**
   * Round-1 pick number the franchise EARNED from the official conference
   * order (1-12). Standings-derived, so it is unaffected by trades — that is
   * the whole point of showing it.
   */
  basePick: number;
  /**
   * Round-1 pick numbers the franchise actually holds on MFL's board, ascending.
   * `null` when the board has not been published for this draft year yet: the
   * base slot still renders, it simply cannot be asterisked. An empty array is
   * NOT the same thing — it means the board exists and they traded out of the
   * round entirely.
   */
  heldPicks: number[] | null;
  /** 'AL' or 'NL' — which conference draft this slot belongs to. */
  conferenceShort: string;
  draftYear: number;
}

/** Render a round-1 pick number as MFL's `round.pick` label. */
function pickLabel(pick: number): string {
  return `1.${String(pick).padStart(2, '0')}`;
}

/**
 * Whether the draft slot tier is eligible.
 *
 * "From June until the draft is over" is already the AFL's league-year clock:
 * the registry declares a June 1 hard rollover (`leagueYearRollover`), so the
 * league year equals the calendar year exactly from June 1 onward and names
 * LAST season before it. That comparison IS the June floor — no month
 * arithmetic to re-derive, nothing to bump at rollover.
 *
 * The floor is checked against the calendar rather than inferred from "last
 * year's board is finished". Those coincide in healthy data, but a missing or
 * half-imported prior board reads as unfinished, which would leave a stale
 * draft slot up all winter.
 *
 * Completion is scoped to the viewer's own conference on purpose: the AL and NL
 * boards run a day apart, and an AL owner should not keep seeing a draft slot
 * because the NL is still picking.
 */
export function isAflDraftWindowOpen(opts: {
  /** `getAflLeagueYear(referenceDate)` — flips on June 1 (PT). */
  aflLeagueYear: number;
  /** `referenceDate.getFullYear()`. */
  calendarYear: number;
  conferenceDraftComplete: boolean;
}): boolean {
  return (
    opts.aflLeagueYear === opts.calendarYear && !opts.conferenceDraftComplete
  );
}

export function resolveAflDraftSpotlight(slot: AflDraftSlot): AflSpotlight {
  const base = pickLabel(slot.basePick);
  const held = slot.heldPicks;
  // No board yet → nothing to compare against, so no asterisk. Distinct from a
  // published board that happens to agree with the base order.
  const moved =
    held !== null && !(held.length === 1 && held[0] === slot.basePick);

  const conf = slot.conferenceShort;
  if (!moved) {
    return {
      kind: 'draft',
      label: 'Draft Slot',
      value: base,
      sub: `${conf} · ${slot.draftYear}`,
      icon: 'draft-podium',
      href: '/afl-fantasy/draft-predictor',
      hint: `Your earned slot in the ${slot.draftYear} ${conf} draft: pick ${slot.basePick} of round 1.`,
    };
  }

  const nowPicks = held ?? [];
  if (nowPicks.length === 0) {
    return {
      kind: 'draft',
      label: 'Draft Slot',
      value: `${base}*`,
      sub: 'traded away',
      icon: 'draft-podium',
      href: '/afl-fantasy/draft-predictor',
      hint: `You earned the ${base} slot in the ${slot.draftYear} ${conf} draft but traded out of round 1.`,
    };
  }

  const nowLabels = nowPicks.map(pickLabel);
  return {
    kind: 'draft',
    label: 'Draft Slot',
    value: `${base}*`,
    sub: `traded · now ${nowLabels.join(', ')}`,
    icon: 'draft-podium',
    href: '/afl-fantasy/draft-predictor',
    hint: `You earned the ${base} slot in the ${slot.draftYear} ${conf} draft; after trades you pick ${nowLabels.join(' and ')} in round 1.`,
  };
}

// ── Title ───────────────────────────────────────────────────────────────────

/**
 * Most recent trophy as the headline, best-ever appended to the sub line when
 * it differs. Both matter and they disagree for half the league: Smokane's last
 * title is the 2025 AL North, but the thing worth knowing is the 2013 AFL
 * Championship. Returns null for a franchise with no hardware at all.
 */
export function resolveAflTitleSpotlight(
  franchiseId: string
): AflSpotlight | null {
  const trophies = getFranchiseTrophyCase(franchiseId).filter(
    (t): t is typeof t & { year: number } => typeof t.year === 'number'
  );
  if (!trophies.length) return null;

  // Most recent, with the better trophy winning a same-year tie.
  const recent = [...trophies].sort(
    (a, b) => b.year - a.year || priorityOf(a.slug) - priorityOf(b.slug)
  )[0];
  // Best, with the more recent winning a same-award tie.
  const best = [...trophies].sort(
    (a, b) => priorityOf(a.slug) - priorityOf(b.slug) || b.year - a.year
  )[0];

  const same = best.slug === recent.slug && best.year === recent.year;
  const sub = same
    ? recent.label
    : `${shortLabel(recent.slug, recent.label)} · ${shortLabel(best.slug, best.label)} ${apostropheYear(best.year)}`;
  const hint = same
    ? `Last title: ${recent.label}, ${recent.year}.`
    : `Last title: ${recent.label}, ${recent.year}. Best: ${best.label}, ${best.year}.`;

  return {
    kind: 'title',
    label: 'Last Title',
    value: `${recent.year}`,
    sub,
    icon: 'trophy',
    href: `/afl-fantasy/franchises/${franchiseId}`,
    hint,
  };
}

// ── Playoff streak ──────────────────────────────────────────────────────────

/** One season's playoff outcome, newest first, as franchise-history records it. */
export interface SeasonPlayoffResult {
  year: number;
  /** franchise-history's `playoffResult`; anything but 'missed' counts. */
  playoffResult: string;
}

/**
 * ACTIVE playoff streak only — a drought never renders here (see the module
 * header). Seasons must be newest-first; a season the franchise did not play is
 * simply absent rather than breaking the streak.
 */
export function resolveAflStreakSpotlight(
  seasons: SeasonPlayoffResult[]
): AflSpotlight | null {
  if (!seasons.length || seasons[0].playoffResult === 'missed') return null;

  let streak = 0;
  for (const season of seasons) {
    if (season.playoffResult === 'missed') break;
    streak += 1;
  }
  if (streak < 1) return null;

  const since = seasons[streak - 1].year;
  return {
    kind: 'streak',
    label: 'Playoffs',
    value: `${streak}`,
    sub: streak === 1 ? 'straight season' : 'straight seasons',
    icon: 'playoff',
    href: '/afl-fantasy/playoffs',
    hint:
      streak === 1
        ? `Made the ${since} playoffs.`
        : `${streak} straight playoff appearances, since ${since}.`,
  };
}

// ── All-time record ─────────────────────────────────────────────────────────

/**
 * Final tier, and the reason the chain is total: every franchise that has
 * played a game has a record. A franchise with no completed season still gets a
 * tile rather than the `—` this slot used to show.
 */
export function resolveAflRecordSpotlight(
  franchiseId: string,
  stats: { wins: number; losses: number; ties: number; firstYear: number | null } | undefined
): AflSpotlight {
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const ties = stats?.ties ?? 0;
  const record = ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const games = wins + losses + ties;
  const pct = games ? (wins + ties * 0.5) / games : 0;

  return {
    kind: 'record',
    label: 'All-Time',
    value: games ? record : '—',
    sub: stats?.firstYear ? `since ${stats.firstYear}` : 'no games yet',
    icon: 'line-chart',
    href: `/afl-fantasy/franchises/${franchiseId}`,
    hint: games
      ? `All-time regular season record ${record} (${pct.toFixed(3).replace(/^0/, '')}) since ${stats?.firstYear}.`
      : 'No completed seasons yet.',
  };
}

// ── Chain ───────────────────────────────────────────────────────────────────

/**
 * franchise-history.json is 2.7 MB and only the streak tier needs it, so it is
 * a dynamic import: the ~80% of franchises holding a trophy resolve at tier 2
 * and never load the chunk. Astro's SSR build splits it out and the franchise
 * detail page already imports the same JSON, so this adds no bundle weight.
 * A checkout without the computed file simply has no streak tier.
 */
async function loadPlayoffResults(
  franchiseId: string
): Promise<SeasonPlayoffResult[]> {
  try {
    const mod = await import('../../data/afl-fantasy/derived/franchise-history.json');
    const history = (mod.default ?? mod) as {
      franchises?: Record<string, { yearByYear?: Array<Record<string, unknown>> }>;
    };
    const rows = history.franchises?.[franchiseId]?.yearByYear ?? [];
    return rows
      .filter((r) => {
        // Skip seasons with no games — franchise-history carries a zeroed row
        // for the upcoming year, and an unplayed season must not read as a
        // missed playoff and break a live streak.
        const games =
          Number(r.wins ?? 0) + Number(r.losses ?? 0) + Number(r.ties ?? 0);
        return games > 0;
      })
      .map((r) => ({
        year: Number(r.year),
        playoffResult: String(r.playoffResult ?? 'missed'),
      }))
      .sort((a, b) => b.year - a.year);
  } catch {
    return [];
  }
}

export interface AflSpotlightOptions {
  franchiseId: string;
  /**
   * Draft slot for this franchise, when the window is open. Omit or pass null
   * to skip the tier — the caller owns `isAflDraftWindowOpen` because only it
   * can read the board.
   */
  draftSlot?: AflDraftSlot | null;
}

/**
 * Walk the tiers most-timely first and return the first that resolves. Always
 * returns a spotlight — `resolveAflRecordSpotlight` is total.
 */
export async function resolveAflTeamSpotlight(
  opts: AflSpotlightOptions
): Promise<AflSpotlight> {
  const { franchiseId, draftSlot } = opts;

  if (draftSlot) return resolveAflDraftSpotlight(draftSlot);

  const title = resolveAflTitleSpotlight(franchiseId);
  if (title) return title;

  const streak = resolveAflStreakSpotlight(await loadPlayoffResults(franchiseId));
  if (streak) return streak;

  return resolveAflRecordSpotlight(
    franchiseId,
    getAflCareerStats().byFranchise.get(franchiseId)
  );
}
