/**
 * Server-side assembly for the Monday night spotlight hero — the snapshot and
 * the projections read, the rule applied (`monday-spotlight.ts`), the face cast.
 *
 * Shared by both homepages for the same reason `live-scoring-hero-props.ts` is:
 * one copy of the block, not a forked sibling per league. Best-effort the same
 * way too — any failure, and any Monday with no close game, returns
 * `undefined` and the page keeps the hero it would have shown anyway.
 */
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import { getCurrentSeasonYear } from './league-year';
import { loadLiveScoringPayload } from './live-scoring-source';
import { loadLeagueWeekProjections } from './live/projections';
import { selectMondaySpotlight, type SpotlightGame } from './monday-spotlight';
import { castBestScoredModel, type HeroModel } from './hero-casting';
import { getPlayerMap } from './player-map';
import type { LiveScoringTeamSource } from './live-scoring-hero-props';

export interface SpotlightTeam {
  name: string;
  shortName: string;
  color: string;
}

export interface MondaySpotlightHeroProps {
  league: CanonicalLeagueSlug;
  week: number;
  game: SpotlightGame;
  others: SpotlightGame[];
  teams: Record<string, SpotlightTeam>;
  /** The face: the most projected points still to play in `game` that has a cutout. */
  model: HeroModel | null;
  /** Who the featured player is, even when no cutout could be cast. */
  player: { playerId: string; name: string; franchiseId: string; remainingProjection: number };
}

export interface BuildMondaySpotlightInput {
  league: CanonicalLeagueSlug;
  week: number;
  teams: LiveScoringTeamSource[];
  userFranchiseId?: string;
  scopeFranchiseIds?: string[];
  /** Injectable for tests. */
  loadImpl?: typeof loadLiveScoringPayload;
  projectionsImpl?: typeof loadLeagueWeekProjections;
}

export async function buildMondaySpotlightProps(
  input: BuildMondaySpotlightInput,
): Promise<MondaySpotlightHeroProps | undefined> {
  const { league, week, userFranchiseId, scopeFranchiseIds } = input;
  const registry = getLeagueBySlug(league);
  if (!registry || !(week > 0)) return undefined;
  const load = input.loadImpl ?? loadLiveScoringPayload;
  const loadProjections = input.projectionsImpl ?? loadLeagueWeekProjections;

  try {
    const seasonYear = getCurrentSeasonYear();
    const [data, projections] = await Promise.all([
      load({ leagueId: registry.id, year: seasonYear, week }),
      loadProjections(league, week, seasonYear),
    ]);
    if (data.ok === false) return undefined;

    const spotlight = selectMondaySpotlight({
      matchups: data.matchups,
      players: data.players,
      projections,
      userFranchiseId,
      scopeFranchiseIds,
    });
    if (!spotlight) return undefined;

    const players = getPlayerMap(seasonYear);
    // Most projected points left first; the cast skips anyone with no cutout.
    const model = castBestScoredModel(
      spotlight.players.map((p) => ({ playerId: p.playerId, franchiseId: p.franchiseId, score: p.remainingProjection })),
      players,
      undefined,
      'Still to play',
    );
    const featured = spotlight.players.find((p) => p.playerId === model?.mflId) ?? spotlight.players[0];
    const name = players.get(featured.playerId)?.name ?? '';
    if (!name) return undefined;

    const teams: Record<string, SpotlightTeam> = {};
    for (const t of input.teams) {
      teams[t.franchiseId] = {
        name: t.name,
        shortName: t.nameMedium || t.nameShort || t.name,
        color: t.color ?? '',
      };
    }

    return {
      league,
      week,
      game: spotlight.game,
      others: spotlight.others,
      teams,
      model,
      player: { ...featured, name },
    };
  } catch {
    return undefined;
  }
}
