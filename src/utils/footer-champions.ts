/**
 * Champion spotlight data for the site footer.
 *
 * The footer's champions band renders one card per CHAMPION TEAM, not one per
 * title. A club that wins the AFL Championship and its division has done the
 * Double even though a rival holds the Premier League that same season, so
 * titles are grouped by team first and each group becomes a single card
 * carrying every trophy that team won.
 *
 * Which titles earn a card, and which merely ride along, is decided by the
 * existing AFL award tiers (see src/utils/afl-awards.ts):
 *
 *   gold        AFL Championship / AFL Cup / Premier League   → earns a card
 *   conference  AL / NL Champion                              → rides along
 *   division    the six divisions                             → rides along
 *   silver      D-League / NIT                                → excluded
 *
 * Silver is excluded from sweeps deliberately: the NIT is a consolation
 * bracket, and "won the Premier League and the NIT" is not a Double. Without
 * this rule the real 2024 season would have shown Drunk Indians on a Double.
 *
 * The conference title is also dropped from a card that already carries the
 * AFL Championship: you cannot reach the title game without winning your
 * conference, so listing both double-counts one run. That turns the real 2025
 * Ninjas season from a "Quadruple" into the Treble it actually is —
 * championship, Premier League, division.
 *
 * Years: this is results-shaped data, so everything here keys off
 * getCurrentSeasonYear(), never getCurrentLeagueYear().
 */

import type { CanonicalLeagueSlug } from '../config/leagues';
import { getLeagueBySlug } from '../config/leagues';
import { getActiveTeams, getCurrentBannerPath } from './league-assets';
import { extractLeagueChampion } from './toilet-bowl-utils';
import { getCurrentSeasonYear } from './league-year';
import { AWARD_TYPES, type AwardSlug, type AwardSeason } from './afl-awards';
import theleagueAssets from '../data/theleague.assets.json';
import aflAwardsHistory from '../../data/afl-fantasy/awards-history.json';
import aflAssets from '../../data/afl-fantasy/afl.assets.json';

/** A single trophy on a champion's card. */
export interface ChampionTitle {
  /** Display label, e.g. "AFL Champion", "NL West". */
  label: string;
  /** Public path to the badge SVG, or null to fall back to the generic cup. */
  badge: string | null;
  /** Gold-tier titles earn their team a card; the rest ride along. */
  major: boolean;
}

/** One champion team and everything it won that season. */
export interface ChampionSpotlight {
  team: string;
  year: number;
  /** Sorted so the majors lead. Length > 1 renders the sweep ribbon. */
  titles: ChampionTitle[];
  /** Banner artwork (950x158 in this repo), or null if the team has none. */
  banner: string | null;
  /** Where the card links — the bracket/table that produced the top title. */
  href: string;
}

/** Non-champion card for draft-only leagues, which have no title to show. */
export interface DraftSpotlight {
  kind: 'draft';
  label: string;
  detail: string;
  year: number;
  href: string;
}

const AWARD_BY_SLUG = new Map(AWARD_TYPES.map((a) => [a.slug, a]));

/** Tiers that count toward a sweep. Silver (NIT / D-League) is consolation. */
const SWEEP_TIERS = new Set(['gold', 'conference', 'division']);

const badgePath = (file: string) => `/assets/afl/awards/${file}`;

/**
 * Where an AFL title's card should link. The Premier League is decided by the
 * all-play table rather than the bracket, so it gets its own destination.
 */
function aflTitleHref(slug: AwardSlug, prefix: string): string {
  if (slug === 'premier-league') return `${prefix}/standings?view=all_play`;
  const tier = AWARD_BY_SLUG.get(slug)?.tier;
  if (tier === 'conference' || tier === 'division') return `${prefix}/standings`;
  return `${prefix}/playoffs`;
}

function aflSpotlights(year: number, prefix: string): ChampionSpotlight[] {
  const seasons = (aflAwardsHistory as { seasons?: AwardSeason[] }).seasons ?? [];
  const season = seasons.find((s) => s.year === year);
  if (!season) return [];

  const active = getActiveTeams(aflAssets as { teams?: any[] });

  // Group every sweep-eligible title by the franchise that won it.
  const byFranchise = new Map<
    string,
    { name: string; entries: Array<{ slug: AwardSlug; label: string; badge: string; major: boolean }> }
  >();

  for (const [rawSlug, winner] of Object.entries(season.awards ?? {})) {
    const slug = rawSlug as AwardSlug;
    const meta = AWARD_BY_SLUG.get(slug);
    if (!meta || !SWEEP_TIERS.has(meta.tier)) continue;
    if (!winner?.franchiseId) continue;

    const bucket = byFranchise.get(winner.franchiseId) ?? {
      name: winner.name ?? '',
      entries: [],
    };
    bucket.name = bucket.name || winner.name || '';
    bucket.entries.push({
      slug,
      label: meta.label,
      badge: badgePath(meta.badge),
      major: meta.tier === 'gold',
    });
    byFranchise.set(winner.franchiseId, bucket);
  }

  const spotlights: ChampionSpotlight[] = [];
  for (const [franchiseId, bucket] of byFranchise) {
    const majors = bucket.entries.filter((e) => e.major);
    // A division-only winner does not get a champion card, or six divisional
    // winners would flood the band every season.
    if (!majors.length) continue;

    // Winning the AFL Championship implies winning your conference to get
    // there, so the conference badge is redundant on that card. Drop it rather
    // than inflate the sweep count with a title the championship already
    // captures. Conference titles still stand alone on a card whose owner lost
    // the final — that team just has no gold title, so it gets no card at all.
    const hasChampionship = bucket.entries.some((e) => e.slug === 'afl-championship');
    const entries = hasChampionship
      ? bucket.entries.filter(
          (e) => e.slug !== 'al-champion' && e.slug !== 'nl-champion'
        )
      : bucket.entries;

    // Majors first, then the rest in canonical AWARD_TYPES order.
    const rank = (slug: AwardSlug) => AWARD_TYPES.findIndex((a) => a.slug === slug);
    const ordered = [...entries].sort((a, b) => {
      if (a.major !== b.major) return a.major ? -1 : 1;
      return rank(a.slug) - rank(b.slug);
    });

    const team = active.find((t: any) => t.id === franchiseId);
    spotlights.push({
      team: bucket.name || team?.name || 'Unknown',
      year,
      titles: ordered.map((e) => ({ label: e.label, badge: e.badge, major: e.major })),
      banner: getCurrentBannerPath(team) ?? null,
      href: aflTitleHref(ordered[0].slug, prefix),
    });
  }

  // Biggest haul leads the band.
  return spotlights.sort((a, b) => b.titles.length - a.titles.length);
}

const theleagueBrackets = import.meta.glob(
  '../../data/theleague/mfl-feeds/*/playoff-brackets.json',
  { eager: true }
);

const unwrap = (mod: any) =>
  mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;

function theleagueSpotlights(year: number, prefix: string): ChampionSpotlight[] {
  const path = Object.keys(theleagueBrackets).find((p) => p.includes(`/${year}/`));
  const bracket = path ? unwrap(theleagueBrackets[path]) : null;
  const teamId = bracket ? extractLeagueChampion(bracket) : '';
  if (!teamId) return [];

  const team = getActiveTeams(theleagueAssets as { teams?: any[] }).find(
    (t: any) => t.id === teamId
  );
  if (!team) return [];

  return [
    {
      team: (team as any).name,
      year,
      titles: [{ label: 'Defending Champion', badge: null, major: true }],
      banner: getCurrentBannerPath(team) ?? null,
      href: `${prefix}/playoffs`,
    },
  ];
}

/**
 * Champion cards for a league's footer, newest settled season first.
 *
 * Falls back one season when the current one hasn't crowned anyone yet — for
 * most of the calendar the "defending" champion is last season's.
 */
export function getFooterChampions(slug: CanonicalLeagueSlug): ChampionSpotlight[] {
  const league = getLeagueBySlug(slug);
  if (!league) return [];
  const prefix = `/${league.slug}`;
  const year = getCurrentSeasonYear();

  const resolve = (y: number): ChampionSpotlight[] =>
    slug === 'afl-fantasy' ? aflSpotlights(y, prefix) : theleagueSpotlights(y, prefix);

  const current = resolve(year);
  return current.length ? current : resolve(year - 1);
}

/** Draft-status card for draft-only leagues, which have no trophy yet. */
export function getFooterDraftStatus(slug: CanonicalLeagueSlug): DraftSpotlight | null {
  const league = getLeagueBySlug(slug);
  if (!league || !league.bestBall) return null;
  return {
    kind: 'draft',
    label: 'Official Draft',
    detail: '25 rounds',
    year: getCurrentSeasonYear(),
    href: `/${league.slug}/draft-room`,
  };
}

/** Whether this league shows a champions band at all. */
export function leagueHasChampionBand(slug: CanonicalLeagueSlug): boolean {
  const league = getLeagueBySlug(slug);
  return Boolean(league) && !league?.bestBall;
}
