/**
 * Set Lineup matchup cards — the game strip above the slots, built once and
 * shared by both lineup pages (`/theleague/lineup`, `/afl-fantasy/lineup`).
 *
 * One card per game the owner plays that week. PLURAL is the whole point:
 * both leagues schedule DOUBLE-HEADER weeks (TheLeague 2026 weeks 1-3 and 13,
 * the AFL three of its own), where a franchise plays two different opponents
 * off ONE submitted lineup. The page that stopped at the first matchup drew
 * one game and silently dropped the other.
 *
 * Everything league-specific is a parameter — the schedule matchups, the
 * roster feed, the scoring maps, and `brandFor` (TheLeague resolves throwback
 * identities, the AFL reads its config). Nothing in here imports a league.
 */

import type { PlayerIdentity } from './player-map';
import type { FaceoffSide } from '../components/theleague/FaceoffComposite.astro';
import { extractLineupStarters, type WeekMatchup } from './lineup-sources';
import {
  buildPositionDemand,
  buildPositionRankIndex,
  castBestScoredModel,
  castTopRankedModel,
  isCompositable,
  scoreFaceoffSides,
  type FaceoffScoreSource,
  type FaceoffStatCandidate,
} from './hero-casting';

/** The franchise identity a card's panel wears (name chip, tint, crest). */
export interface MatchupCardBrand {
  name: string;
  color?: string;
  watermark?: string;
}

/** One game's card on the strip: the composite (when it casts) plus the band. */
export interface MatchupCard {
  opponentFranchiseId: string;
  /** null when neither side has a compositable player — band-only card. */
  faceoff: { away: FaceoffSide; home: FaceoffSide; statSource: FaceoffScoreSource } | null;
  awayChip: string;
  homeChip: string;
  title: string;
  /** Which panel is ours — the accent, and the total the client recomputes. */
  userScoreSide: 'away' | 'home';
  awayProjTotal: number;
  homeProjTotal: number;
  hasProjTotals: boolean;
}

export interface BuildMatchupCardsInput {
  /** The signed-in owner's franchise, already league-checked by the page. */
  userFranchiseId: string;
  /** Every game this franchise plays this week — `findWeekMatchups`. */
  matchups: WeekMatchup[];
  week: number;
  /** A played week recaps by actual points; an upcoming one previews by projection. */
  weekIsPast: boolean;
  /** Our starters (or the whole roster when no lineup has resolved yet). */
  userSideIds: string[];
  /** Our projected total — the same number on every card (one lineup, N games). */
  userProjTotal: number;
  /** `rosters.franchise[]` for the WHOLE league: salaries + opponent pools. */
  franchiseList: any[];
  /** This week's `weeklyResults` entry, for recorded starters. */
  resultsWeekEntry: any;
  projMap: Map<string, number>;
  playerScoresMap: Map<string, Record<number, number>>;
  identityMap: Map<string, PlayerIdentity>;
  slotPositions: readonly string[];
  slotEligibility: Record<string, readonly string[]>;
  /** Franchise name / tint / crest. Never called for a franchise off the strip. */
  brandFor: (franchiseId: string) => MatchupCardBrand;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export function buildMatchupCards(input: BuildMatchupCardsInput): MatchupCard[] {
  const {
    userFranchiseId, matchups, week, weekIsPast, userSideIds, userProjTotal,
    franchiseList, resultsWeekEntry, projMap, playerScoresMap, identityMap,
    slotPositions, slotEligibility, brandFor,
  } = input;

  const franchises = asArray<any>(franchiseList);

  const salaryById = new Map<string, number>();
  for (const f of franchises) {
    for (const p of asArray<any>(f?.player)) {
      const s = parseFloat(p?.salary);
      if (p?.id && Number.isFinite(s)) salaryById.set(p.id, s);
    }
  }

  const weekStarters = (franchiseId: string) => extractLineupStarters(resultsWeekEntry, franchiseId);

  const faceoffCandidates = (
    franchiseId: string,
    playerIds: string[],
    actualById?: Map<string, number>,
  ): FaceoffStatCandidate[] => playerIds.map((id) => ({
    playerId: id,
    franchiseId,
    projected: projMap.get(id) ?? 0,
    actual: actualById?.get(id) ?? playerScoresMap.get(id)?.[week] ?? 0,
    salary: salaryById.get(id) ?? 0,
  }));

  /**
   * Projected total for the best legal lineup drawable from `playerIds` —
   * fills the starting slots greedily by projection (position slots first,
   * then FLEX with the best remaining RB/WR/TE). Used for the opponent's
   * "current lineup" total when the week isn't locked (their actual set
   * lineup isn't publicly readable for a future week). Sums only what the
   * pool can fill — a thin roster yields fewer starters (and a smaller
   * total), which is the honest answer.
   */
  function bestLineupProjTotal(playerIds: string[]): number {
    const cands = playerIds.map((id) => ({
      id,
      position: identityMap.get(id)?.position ?? '',
      proj: projMap.get(id) ?? 0,
    }));
    const used = new Set<string>();
    let total = 0;

    for (const slotPos of slotPositions) {
      if (slotPos === 'FLEX') continue;
      const pick = cands
        .filter((c) => !used.has(c.id) && (slotEligibility[slotPos] ?? []).includes(c.position))
        .sort((a, b) => b.proj - a.proj)[0];
      if (pick) { used.add(pick.id); total += pick.proj; }
    }

    const flexSlots = slotPositions.filter((p) => p === 'FLEX').length;
    const flexPicks = cands
      .filter((c) => !used.has(c.id) && ['RB', 'WR', 'TE'].includes(c.position))
      .sort((a, b) => b.proj - a.proj);
    for (let i = 0; i < flexSlots && i < flexPicks.length; i++) {
      used.add(flexPicks[i].id);
      total += flexPicks[i].proj;
    }
    return total;
  }

  /** The opponent's starting pool for one game, plus their reported scores. */
  function opponentPool(opponentFranchiseId: string): { ids: string[]; actualById?: Map<string, number> } {
    const recorded = weekStarters(opponentFranchiseId);
    if (recorded.length > 0) {
      return {
        ids: recorded.map((p) => p.id),
        // Only real reported scores go in the map — a null would land as a 0
        // and shadow the playerScoresMap fallback in faceoffCandidates.
        actualById: new Map(
          recorded.filter((p) => p.score !== null).map((p) => [p.id, p.score as number]),
        ),
      };
    }
    const oppFranchise = franchises.find((f: any) => f?.id === opponentFranchiseId);
    // Only active-roster players are legal starters — TAXI_SQUAD and
    // INJURED_RESERVE can't start, so excluding them keeps the presumed
    // lineup (and its projected total) honest.
    return {
      ids: asArray<any>(oppFranchise?.player)
        .filter((p: any) => p?.id && p.status === 'ROSTER')
        .map((p: any) => p.id),
    };
  }

  // Upcoming week previews by projection; a completed week recaps by actual
  // points. Salary is the last-resort tie to keep the panel honest pre-season.
  const faceoffOrder: FaceoffScoreSource[] = weekIsPast
    ? ['actual', 'projected', 'salary']
    : ['projected', 'actual', 'salary'];

  /**
   * Cast the two-player split for one game, or null when either side has
   * nobody compositable (the card then renders as a scoreboard band alone).
   */
  function castFaceoff(
    opponentFranchiseId: string,
    userIsHome: boolean,
    oppPool: { ids: string[]; actualById?: Map<string, number> },
  ): MatchupCard['faceoff'] {
    if (userSideIds.length === 0 || oppPool.ids.length === 0) return null;
    // Cast only from compositable players (ESPN cutout, non-DEF) so the elected
    // stat source matches who castBestScoredModel can actually feature — a DEF's
    // projection shouldn't elect a source the cast then can't honor. Team TOTALS
    // (below) intentionally still count every starter, DEF and PK included.
    const compositableIds = (ids: string[]) =>
      ids.filter((id) => { const p = identityMap.get(id); return !!p && isCompositable(p); });
    const userCands = faceoffCandidates(userFranchiseId, compositableIds(userSideIds));
    const oppCands = faceoffCandidates(opponentFranchiseId, compositableIds(oppPool.ids), oppPool.actualById);
    const scored = scoreFaceoffSides(
      userIsHome ? oppCands : userCands,
      userIsHome ? userCands : oppCands,
      faceoffOrder,
    );
    if (!scored.source) return null;

    // Cast by POSITIONAL RANK MEASURED AGAINST DEMAND, not raw points. Ranking
    // each candidate against every other player at his position (league-wide
    // for projections — MFL's projectedScores feed carries ~600 players) is
    // what varies the faces: raw points always crown the quarterback, so the
    // same two headshots owned the panel every week. Dividing by how many
    // starters the league needs at the position is what keeps it varied — a
    // bare rank re-crowns the QBs, because the league starts 1 QB and 4+
    // RB/WR/TE per team, so QB12 is replacement level where WR12 is a stud.
    // Demand comes from this league's own lineup slots × its team count, so a
    // rules change or an expansion team moves it without an edit here.
    // The rank index is built from the same stat source `scoreFaceoffSides`
    // elected, so the number under the face and the reason he's there agree. A
    // side with nobody ranked (bye weeks, a week with no scores yet, a feed
    // with no franchises) falls back to the old highest-score cast.
    //
    // ONLY a points source can carry a rank. Salary is the cascade's last
    // resort and it wins for months at a time — the whole offseason, before
    // MFL publishes projections for a week — and ranking contract dollars
    // would print `WR1 · CIN · $8500K`, a pay rank wearing a performance
    // rank's clothes. Worse, rank-over-demand would then elect the
    // best-PAID player at the deepest position, which claims nothing about
    // anybody. Salary weeks keep the old highest-value cast and no rank
    // label; the dollar figure is already the honest thing to show.
    const pointsSource = scored.source === 'projected' || scored.source === 'actual';
    const rankPool = !pointsSource
      ? new Map<string, number>()
      : scored.source === 'projected'
        ? projMap
        : new Map<string, number>(
            [...playerScoresMap].map(([id, byWeek]) => [id, byWeek?.[week] ?? 0]),
          );
    const positionDemand = buildPositionDemand(slotPositions, slotEligibility, franchises.length);
    const positionRanks = buildPositionRankIndex(rankPool, identityMap, positionDemand);

    const castSide = (cands: typeof scored.away) =>
      castTopRankedModel(cands, identityMap, positionRanks, undefined, 'Player of the Game')
      ?? (() => {
        const model = castBestScoredModel(cands, identityMap, undefined, 'Player of the Game');
        return model ? { model, rank: null } : null;
      })();

    const awayCast = castSide(scored.away);
    const homeCast = castSide(scored.home);
    if (!awayCast?.model || !homeCast?.model) return null;

    const scoreOf = (side: typeof scored.away, id: string) => side.find((c) => c.playerId === id)?.score ?? 0;
    const statFor = (side: typeof scored.away, id: string) => {
      const v = scoreOf(side, id);
      if (scored.source === 'salary') return `$${Math.round(v / 1000)}K`;
      return `${v.toFixed(1)} ${scored.source === 'projected' ? 'proj' : 'pts'}`;
    };
    const sideFor = (
      cast: NonNullable<typeof awayCast>,
      cands: typeof scored.away,
      franchiseId: string,
    ): FaceoffSide => {
      const brand = brandFor(franchiseId);
      return {
        model: cast.model,
        chip: brand.name || `Franchise ${franchiseId}`,
        color: brand.color,
        watermark: brand.watermark,
        stat: statFor(cands, cast.model.mflId),
        // 'WR3' in place of a bare 'WR' — the meta line then says why this
        // face won the panel, at no extra width.
        positionLabel: cast.rank?.label,
      };
    };
    return {
      away: sideFor(awayCast, scored.away, userIsHome ? opponentFranchiseId : userFranchiseId),
      home: sideFor(homeCast, scored.home, userIsHome ? userFranchiseId : opponentFranchiseId),
      statSource: scored.source,
    };
  }

  const chipFor = (franchiseId: string) => brandFor(franchiseId).name || `Franchise ${franchiseId}`;
  const userChip = matchups.length > 0 ? chipFor(userFranchiseId) : '';

  const cards: MatchupCard[] = [];
  for (const m of matchups) {
    const oppPool = opponentPool(m.opponentFranchiseId);
    const faceoff = castFaceoff(m.opponentFranchiseId, m.userIsHome, oppPool);

    const opponentRecorded = weekStarters(m.opponentFranchiseId);
    const opponentProjTotal = opponentRecorded.length > 0
      ? opponentRecorded.reduce((t, p) => t + (projMap.get(p.id) ?? 0), 0)
      : bestLineupProjTotal(oppPool.ids);

    // Panel order is away/home; the user sits home when the schedule says so —
    // per GAME, because a double-header puts them on both sides of the week.
    const oppChip = chipFor(m.opponentFranchiseId);
    const card: MatchupCard = {
      opponentFranchiseId: m.opponentFranchiseId,
      faceoff,
      awayChip: m.userIsHome ? oppChip : userChip,
      homeChip: m.userIsHome ? userChip : oppChip,
      title: m.userIsHome ? `${oppChip} vs ${userChip}` : `${userChip} vs ${oppChip}`,
      userScoreSide: m.userIsHome ? 'home' : 'away',
      awayProjTotal: m.userIsHome ? opponentProjTotal : userProjTotal,
      homeProjTotal: m.userIsHome ? userProjTotal : opponentProjTotal,
      hasProjTotals: userProjTotal > 0 || opponentProjTotal > 0,
    };
    // A game with neither a cast composite nor a projection has nothing to
    // show; a card that is band-only is still worth rendering, because
    // dropping it would hide half of a double-header.
    if (card.faceoff || card.hasProjTotals) cards.push(card);
  }
  return cards;
}
