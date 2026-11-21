/**
 * The breaking-story hero's story, for ONE viewer of ONE league.
 *
 * Shared by every league whose hero profile climbs the `breaking-story` rung
 * (TheLeague, the AFL). The page asks this BEFORE resolving the hero, so the
 * resolver stays feed-free and takes a boolean (`hasBreakingStory`); the story
 * and its cast player then ride to `BreakingStoryHero`.
 *
 * Injury posts are filtered per viewer first (breaking-injury-relevance.ts):
 * a non-star's injury leads only the hero of an owner who rosters him.
 */
import type { CanonicalLeagueSlug } from '../config/leagues';
import { getLeagueBySlug } from '../config/leagues';
import { leagueFeedPath, loadLeagueData } from './league-data';
import { getOwnersByPlayer, preloadOffseasonHeroData, OWNERSHIP_FEEDS, selectBreakingStory, type BreakingStory } from './offseason-hero-data';
import { castStoryModel, type HeroModel } from './hero-casting';
import type { PlayerIdentity } from './player-map';
import { computeStarPlayerIds, isBreakingPostForViewer } from './breaking-injury-relevance';

export interface ViewerBreakingStory {
  story: BreakingStory;
  model: HeroModel;
  /** The page's reference date (honors `?testDate=`), for the "N hrs ago" eyebrow. */
  referenceDate: Date;
}

export interface ViewerBreakingStoryInput {
  league: CanonicalLeagueSlug;
  posts: unknown[] | null | undefined;
  now: Date;
  /** The SIGNED-IN owner's franchise in this league (`franchiseIdForLeague`), or null. */
  viewerFranchiseId: string | null | undefined;
  /** The league year — MFL feed directories and ranking sources are keyed by it. */
  leagueYear: number;
  players: Map<string, PlayerIdentity>;
  windowHours?: number;
}

export async function resolveViewerBreakingStory(input: ViewerBreakingStoryInput): Promise<ViewerBreakingStory | null> {
  const { league, now, viewerFranchiseId, leagueYear, players, windowHours = 48 } = input;
  const posts = Array.isArray(input.posts) ? input.posts : [];
  if (posts.length === 0) return null;

  const [rankingFile, ytdFile] = await Promise.all([
    loadLeagueData<any>(`data/ranking-sources/${leagueYear}.json`).catch(() => null),
    loadLeagueData<any>(leagueFeedPath(getLeagueBySlug(league)!.dataPath, leagueYear, 'playerScores-ytd.json')).catch(() => null),
    // Current ownership, as a LIST: an AFL player is routinely rostered in
    // both conferences, so the post's own franchiseIds can name only one.
    preloadOffseasonHeroData(league, [leagueYear], OWNERSHIP_FEEDS).catch(() => undefined),
  ]);
  const starIds = computeStarPlayerIds({
    positionOf: (id) => players.get(id)?.position,
    rankingSources: rankingFile?.sources,
    ytdScores: [ytdFile?.playerScores?.playerScore ?? []].flat(),
  });
  // Every roster status counts: the injured player is often on the owner's
  // IR or taxi squad by the time the post is read, and is still his.
  const owners = viewerFranchiseId ? getOwnersByPlayer(leagueYear, league, { activeOnly: false }) : new Map<string, string[]>();

  const relevant = posts.filter((post) =>
    isBreakingPostForViewer(post, {
      franchiseId: viewerFranchiseId,
      starIds,
      ownersOf: (playerId) => owners.get(playerId) ?? [],
    }),
  );
  const story = selectBreakingStory(relevant, now, windowHours, (ids) => !!castStoryModel(ids, players));
  const model = story ? castStoryModel(story.playerIds, players) : null;
  return story && model ? { story, model, referenceDate: now } : null;
}
