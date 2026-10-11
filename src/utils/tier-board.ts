/**
 * The AFL's tier competition (Premier League / D-League all-play, and the
 * combined AFL Cup / All-Play table) as standings-board rows.
 *
 * This is the AFL family's OWN competition (docs/claude/rules/
 * standings-brackets-draft-order.md rule 1c), so its zones, medals and prizes
 * live here rather than in the shared board model. The rules mirror the tier
 * table in StandingsTable.astro, which the board replaces on the AFL page:
 *
 * - A league that DECLARES its movement (the custom-site demo) moves its top
 *   `promote` up and its bottom `relegate` down; the top tier medals 1-3.
 * - The AFL's Premier League medals 1-3, then 9-10 play the relegation
 *   playoff and 11-12 drop. Its D-League promotes 1-2 and sends 3-4 to the
 *   promotion playoff.
 * - The 2017 AFL Cup's top `promotionCutoff` formed the next Premier League.
 *
 * Rows arrive in all-play order from the producer and are never re-sorted.
 */
import { getLeaguePayouts } from '../config/leagues';
import { formatRecord, type BoardTeam, type GroupRow } from './standings-board';

export const PREMIER_LEAGUE_NAME = 'Premier League';
export const D_LEAGUE_NAME = 'D-League';

export interface TierMovement {
  promote: number;
  relegate: number;
}

export interface TierBoardOptions {
  /** The tier's name, as the tier record spells it. */
  tier: string;
  /** Declared movement for this tier (custom leagues); undefined for the AFL's own rules. */
  movement?: TierMovement;
  /** Combined table only: ranks at or above this line were promoted. */
  promotionCutoff?: number;
  /** The league whose payout table prices each rank. */
  leagueSlug: string;
}

/** Prize label per rank (index 0 = rank 1) from the league's payout table. */
export function tierPrizes(leagueSlug: string, tier: string): string[] {
  const prizes: string[] = [];
  for (const prize of getLeaguePayouts(leagueSlug)?.prizes ?? []) {
    if (prize.source.kind !== 'tier-rank' || prize.source.tier !== tier) continue;
    prizes[prize.source.rank - 1] = `$${prize.amount}`;
  }
  return prizes;
}

type Zone = { zone: NonNullable<GroupRow['zone']>; label: string };

function zoneFor(rank: number, count: number, opts: TierBoardOptions): Zone | null {
  const { movement, tier, promotionCutoff } = opts;
  if (movement) {
    if (movement.promote > 0 && rank <= movement.promote) return { zone: 'up', label: 'Moves up' };
    if (movement.relegate > 0 && rank > count - movement.relegate) return { zone: 'down', label: 'Moves down' };
    return null;
  }
  if (tier === PREMIER_LEAGUE_NAME) {
    if (rank === 9 || rank === 10) return { zone: 'danger', label: 'Relegation playoff' };
    if (rank === 11 || rank === 12) return { zone: 'down', label: 'Relegated' };
  } else if (tier === D_LEAGUE_NAME) {
    if (rank <= 2) return { zone: 'up', label: 'Promoted' };
    if (rank === 3 || rank === 4) return { zone: 'danger', label: 'Promotion playoff' };
  } else if (promotionCutoff !== undefined && rank <= promotionCutoff) {
    return { zone: 'up', label: `Top ${promotionCutoff} formed the next Premier League` };
  }
  return null;
}

/** Medals on the top three of the top tier only; a promotion tier's top rows are zoned instead. */
function medals(opts: TierBoardOptions): number {
  if (opts.movement) return opts.movement.promote === 0 ? 3 : 0;
  return opts.tier === PREMIER_LEAGUE_NAME ? 3 : 0;
}

export function buildTierRows(teams: BoardTeam[], opts: TierBoardOptions): GroupRow[] {
  const prizes = tierPrizes(opts.leagueSlug, opts.tier);
  const medalCount = medals(opts);
  let previousZone: string | null = null;
  return teams.map((team, i) => {
    const rank = i + 1;
    const zone = zoneFor(rank, teams.length, opts);
    // A zone's label goes above its first row only.
    const startsZone = zone && zone.label !== previousZone;
    previousZone = zone?.label ?? null;
    const arrow = zone?.zone === 'up' ? 'up' : zone?.zone === 'down' || zone?.zone === 'danger' ? (opts.tier === D_LEAGUE_NAME ? 'up' : 'down') : undefined;
    const ap = team.allPlay;
    return {
      team,
      zone: zone?.zone,
      zoneLabel: startsZone ? { tone: zone.zone, text: zone.label } : undefined,
      rank: medalCount ? { kind: 'medal', n: rank, medals: medalCount } : { kind: 'num', n: rank },
      cells: [
        { text: formatRecord(ap.wins, ap.losses, ap.ties), strong: true },
        { text: ap.pct.toFixed(3).replace(/^0/, ''), hideSm: true },
        { prize: prizes[i] || undefined, arrow },
      ],
    } satisfies GroupRow;
  });
}
