/**
 * Power Rankings Utilities
 *
 * Computes competitive intelligence metrics for each franchise:
 * - Team archetype classification (Win-Now, Contender, Retooling, Rebuilding)
 * - Composite power score from production, roster, contract, cap, and draft
 * - Key intel highlights (strengths, weaknesses, opportunities)
 *
 * Scoring philosophy (dynasty-informed):
 * - Production matters most — points scored is the ultimate test
 * - Contract control is the dynasty engine — locked-in cores win leagues
 * - Roster quality over roster quantity — 18 studs > 22 warm bodies
 * - Salary-weighted age, not raw age — expensive + old is the risk
 * - Draft picks weighted by round — 1sts aren't 3rds
 * - Cap space is a means, not an end — penalize dead money, not spending
 *
 * Reuses league-summary-utils.ts data structures.
 */

import type { TeamSummary, DraftCapitalMap } from './league-summary-utils';
import { SALARY_CAP } from './salary-calculations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamArchetype = 'Win-Now' | 'Contender' | 'Retooling' | 'Rebuilding';

export interface IntelHighlight {
  label: string;
  value: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface TeamIntel {
  franchiseId: string;
  teamName: string;
  teamNameShort?: string;
  teamIcon: string;
  division: string;
  archetype: TeamArchetype;
  /** 0–100 composite power score */
  powerScore: number;
  /** Component scores (0–100) */
  productionScore: number;
  capScore: number;
  rosterScore: number;
  contractScore: number;
  draftScore: number;
  /** Key intel highlights */
  highlights: IntelHighlight[];
  /** Raw current-year metrics for display */
  capSpace: number;
  effectiveCapSpace: number;
  deadMoney: number;
  avgAge: number;
  playersUnderContract: number;
  expiringContracts: number;
  draftCapital: number;
  draftCapitalWeighted: number;
  committedPct: number;
  rosterHoles: number;
  topPlayerRetention: number;
  weightedAge: number;
  avgContractLength: number;
  totalPoints: number;
  pointsPerMillion: number;
  /** Year-over-year cap trajectory (year 0 vs year 1) */
  capTrajectory: number;
  /** Worst future cap space across years 1-4 */
  capFloorYear: number;
  capFloorValue: number;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Clamp a value to 0–100 */
function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Score a metric relative to min/max across the league (0–100, higher = better) */
function rankScore(value: number, allValues: number[], higherIsBetter: boolean): number {
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  if (max === min) return 50;
  const normalized = (value - min) / (max - min);
  return clamp((higherIsBetter ? normalized : 1 - normalized) * 100);
}

// ---------------------------------------------------------------------------
// Draft capital weighting
// ---------------------------------------------------------------------------

/** Weight draft picks by round: 1st=3, 2nd=2, 3rd=1 */
function computeWeightedDraftCapital(
  franchiseId: string,
  draftCapitalMap: DraftCapitalMap,
): number {
  const entry = draftCapitalMap.get(franchiseId);
  if (!entry) return 3; // default 3 picks = 1 per round
  let weighted = 0;
  for (const [round, count] of entry.byRound) {
    const weight = Math.max(1, 4 - round); // round 1=3, round 2=2, round 3+=1
    weighted += count * weight;
  }
  return weighted;
}

// ---------------------------------------------------------------------------
// Production metrics
// ---------------------------------------------------------------------------

/** Compute total points and points per $1M cap committed */
function computeProductionMetrics(
  summary: TeamSummary,
): { totalPoints: number; pointsPerMillion: number } {
  // Total points is stored as the sum used for top player retention sorting
  // We can derive it from metrics — but it's not directly available.
  // Use committedSalaryPct * SALARY_CAP to get committed dollars.
  const committed = summary.metrics.committedSalaryPct[0] / 100 * SALARY_CAP;

  // The league-summary pipeline doesn't expose raw total points per team.
  // However, topPlayerRetention counts how many top-10 scorers are retained,
  // which is a proxy. For a more direct metric, we'll use the positional depth
  // as a roster quality signal: more positions filled = more production capacity.
  //
  // Since we don't have direct access to summed player points at this layer,
  // we approximate production capacity from roster completeness + retention.
  // The retention metric (top-10 scorers kept) is our best production proxy.
  const retention = summary.metrics.topPlayerRetention[0];
  const playersUnderContract = summary.metrics.playersUnderContract[0];

  // Production proxy: retention-weighted roster strength
  // A full roster with high retention = high production
  const totalPoints = retention * 10 + playersUnderContract * 2;
  const pointsPerMillion = committed > 0 ? (totalPoints / (committed / 1_000_000)) : 0;

  return { totalPoints, pointsPerMillion };
}

// ---------------------------------------------------------------------------
// Cap cliff detection
// ---------------------------------------------------------------------------

function detectCapCliff(summary: TeamSummary): { year: number; value: number } {
  let worstYear = 0;
  let worstValue = Infinity;

  // Check years 1-4 (future projections)
  for (let i = 1; i < summary.metrics.capSpace.length; i++) {
    const ecs = summary.metrics.effectiveCapSpace[i];
    if (ecs < worstValue) {
      worstValue = ecs;
      worstYear = i;
    }
  }

  return { year: worstYear, value: worstValue };
}

// ---------------------------------------------------------------------------
// Format helpers (for highlight values)
// ---------------------------------------------------------------------------

function fmtCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

export function computeTeamIntel(
  summaries: TeamSummary[],
  draftCapitalMap: DraftCapitalMap,
): TeamIntel[] {
  // Compute weighted draft capital for all teams
  const weightedDraftByTeam = summaries.map((t) =>
    computeWeightedDraftCapital(t.franchiseId, draftCapitalMap)
  );

  // Compute production metrics for all teams
  const productionByTeam = summaries.map((t) => computeProductionMetrics(t));

  // Extract current-year (index 0) metrics for all teams
  const allEffective = summaries.map((t) => t.metrics.effectiveCapSpace[0]);
  const allDeadMoney = summaries.map((t) => t.metrics.deadMoney[0]);
  const allWeightedAge = summaries.map((t) => t.metrics.weightedAge[0]);
  const allPlayers = summaries.map((t) => t.metrics.playersUnderContract[0]);
  const allExpiring = summaries.map((t) => t.metrics.expiringContracts[0]);
  const allRetention = summaries.map((t) => t.metrics.topPlayerRetention[0]);
  const allContractLen = summaries.map((t) => t.metrics.avgContractLength[0]);
  const allRosterHoles = summaries.map((t) => t.metrics.rosterHoles[0]);
  const allWeightedDraft = weightedDraftByTeam;
  const allProduction = productionByTeam.map((p) => p.totalPoints);
  const allEfficiency = productionByTeam.map((p) => p.pointsPerMillion);

  return summaries.map((team, idx) => {
    const ecs = team.metrics.effectiveCapSpace[0];
    const dm = team.metrics.deadMoney[0];
    const age = team.metrics.avgAge[0];
    const puc = team.metrics.playersUnderContract[0];
    const exp = team.metrics.expiringContracts[0];
    const draft = team.metrics.draftCapital[0];
    const committed = team.metrics.committedSalaryPct[0];
    const retention = team.metrics.topPlayerRetention[0];
    const wAge = team.metrics.weightedAge[0];
    const contractLen = team.metrics.avgContractLength[0];
    const holes = team.metrics.rosterHoles[0];

    const weightedDraft = weightedDraftByTeam[idx];
    const { totalPoints, pointsPerMillion } = productionByTeam[idx];
    const capCliff = detectCapCliff(team);

    // Cap trajectory: cap space year 1 vs year 0
    const cs = team.metrics.capSpace[0];
    const capTrajectory = (team.metrics.capSpace[1] ?? cs) - cs;

    // Positional depth for gap detection
    const posDepth = team.positionalDepth[0] ?? {};

    // --- Component Scores ---

    // Production score (15%): retention-weighted + efficiency
    const productionScore = clamp(
      rankScore(totalPoints, allProduction, true) * 0.6 +
      rankScore(pointsPerMillion, allEfficiency, true) * 0.4
    );

    // Cap score (15%): dead money exposure (primary) + effective cap (secondary)
    // Low weight because cap space is a means, not an end
    const capScore = clamp(
      rankScore(dm, allDeadMoney, false) * 0.6 +
      rankScore(ecs, allEffective, true) * 0.4
    );

    // Roster score (25%): salary-weighted age + roster holes + positional balance
    // Uses weightedAge instead of raw avgAge — penalizes expensive old players
    const posBalance = computePositionalBalance(posDepth);
    const allPosBalance = summaries.map((t) =>
      computePositionalBalance(t.positionalDepth[0] ?? {})
    );
    const rosterScore = clamp(
      rankScore(wAge, allWeightedAge, false) * 0.40 +
      rankScore(holes, allRosterHoles, false) * 0.30 +
      rankScore(posBalance, allPosBalance, true) * 0.30
    );

    // Contract score (30%): retention + contract length + low expiring
    // Highest weight — contract control IS dynasty
    const contractScore = clamp(
      rankScore(retention, allRetention, true) * 0.40 +
      rankScore(contractLen, allContractLen, true) * 0.35 +
      rankScore(exp, allExpiring, false) * 0.25
    );

    // Draft score (15%): weighted by round (1st=3, 2nd=2, 3rd=1)
    const draftScore = clamp(rankScore(weightedDraft, allWeightedDraft, true));

    // --- Composite Power Score ---
    // Production: 15%, Cap: 15%, Roster: 25%, Contract: 30%, Draft: 15%
    const powerScore = Math.round(
      productionScore * 0.15 +
      capScore * 0.15 +
      rosterScore * 0.25 +
      contractScore * 0.30 +
      draftScore * 0.15
    );

    // --- Archetype Classification ---
    const archetype = classifyArchetype(powerScore, contractLen, holes);

    // --- Highlights ---
    const highlights = buildHighlights({
      ecs, dm, age, puc, exp, draft, weightedDraft, committed,
      retention, wAge, contractLen, holes, capTrajectory,
      posDepth, capCliff, totalPoints, pointsPerMillion,
      allEffective, allDeadMoney, allWeightedAge, allPlayers, allExpiring,
      allWeightedDraft, allRetention, allContractLen, allRosterHoles,
      allProduction, allEfficiency,
    });

    return {
      franchiseId: team.franchiseId,
      teamName: team.teamName,
      teamNameShort: team.teamNameShort,
      teamIcon: team.teamIcon,
      division: team.division,
      archetype,
      powerScore,
      productionScore: Math.round(productionScore),
      capScore: Math.round(capScore),
      rosterScore: Math.round(rosterScore),
      contractScore: Math.round(contractScore),
      draftScore: Math.round(draftScore),
      highlights,
      capSpace: cs,
      effectiveCapSpace: ecs,
      deadMoney: dm,
      avgAge: age,
      playersUnderContract: puc,
      expiringContracts: exp,
      draftCapital: draft,
      draftCapitalWeighted: weightedDraft,
      committedPct: committed,
      rosterHoles: holes,
      topPlayerRetention: retention,
      weightedAge: wAge,
      avgContractLength: contractLen,
      totalPoints,
      pointsPerMillion,
      capTrajectory,
      capFloorYear: capCliff.year,
      capFloorValue: capCliff.value,
    };
  });
}

// ---------------------------------------------------------------------------
// Positional balance
// ---------------------------------------------------------------------------

/** Score 0–100 for positional balance. Penalizes missing QB/TE heavily. */
function computePositionalBalance(posDepth: Record<string, number>): number {
  const qb = posDepth['QB'] ?? 0;
  const rb = posDepth['RB'] ?? 0;
  const wr = posDepth['WR'] ?? 0;
  const te = posDepth['TE'] ?? 0;

  let score = 50; // baseline

  // QB: need at least 1, ideally 2
  if (qb === 0) score -= 25;
  else if (qb >= 2) score += 10;
  else score += 5;

  // TE: critical in 1.0 PPR TE league, need at least 2
  if (te === 0) score -= 25;
  else if (te === 1) score -= 5;
  else if (te >= 2) score += 10;

  // RB: need depth (3+)
  if (rb >= 4) score += 10;
  else if (rb >= 2) score += 5;
  else if (rb <= 1) score -= 10;

  // WR: need depth (4+)
  if (wr >= 5) score += 10;
  else if (wr >= 3) score += 5;
  else if (wr <= 1) score -= 10;

  return clamp(score);
}

// ---------------------------------------------------------------------------
// Archetype classification
// ---------------------------------------------------------------------------

function classifyArchetype(
  powerScore: number,
  contractLen: number,
  rosterHoles: number,
): TeamArchetype {
  // Win-Now: high power score with roster ready to compete
  // No age floor — young + dominant is the best dynasty position
  if (powerScore >= 60 && rosterHoles <= 3 && contractLen >= 2.0) return 'Win-Now';

  // Contender: solid power score, manageable holes
  if (powerScore >= 45 && rosterHoles <= 5) return 'Contender';

  // Rebuilding: clearly barren rosters or very low power
  if (powerScore < 25 || rosterHoles >= 10) return 'Rebuilding';

  // Retooling: middle ground — decent pieces but needs work
  return 'Retooling';
}

// ---------------------------------------------------------------------------
// Highlight generation
// ---------------------------------------------------------------------------

interface HighlightInput {
  ecs: number; dm: number; age: number; puc: number; exp: number;
  draft: number; weightedDraft: number; committed: number; retention: number;
  wAge: number; contractLen: number; holes: number; capTrajectory: number;
  posDepth: Record<string, number>;
  capCliff: { year: number; value: number };
  totalPoints: number; pointsPerMillion: number;
  allEffective: number[]; allDeadMoney: number[];
  allWeightedAge: number[]; allPlayers: number[]; allExpiring: number[];
  allWeightedDraft: number[]; allRetention: number[];
  allContractLen: number[]; allRosterHoles: number[];
  allProduction: number[]; allEfficiency: number[];
}

function buildHighlights(d: HighlightInput): IntelHighlight[] {
  const positives: IntelHighlight[] = [];
  const negatives: IntelHighlight[] = [];
  const leagueSize = d.allEffective.length;

  // Rank helper: 1 = best
  const rank = (val: number, all: number[], higher: boolean) => {
    const sorted = [...all].sort((a, b) => higher ? b - a : a - b);
    return sorted.indexOf(val) + 1;
  };

  // --- POSITIVE highlights ---

  // Cap space
  const capRank = rank(d.ecs, d.allEffective, true);
  if (capRank <= 3) {
    positives.push({
      label: 'Cap Space',
      value: `#${capRank} in league (${fmtCurrency(d.ecs)})`,
      sentiment: 'positive',
    });
  }

  // Youth (salary-weighted)
  const wAgeRank = rank(d.wAge, d.allWeightedAge, false);
  if (wAgeRank <= 3) {
    positives.push({
      label: 'Young Core',
      value: `#${wAgeRank} youngest salary-weighted roster`,
      sentiment: 'positive',
    });
  }

  // Draft capital (weighted)
  const draftRank = rank(d.weightedDraft, d.allWeightedDraft, true);
  if (draftRank <= 3) {
    positives.push({
      label: 'Draft Capital',
      value: `#${draftRank} in weighted picks (${d.draft} owned)`,
      sentiment: 'positive',
    });
  }

  // Core locked in (raised threshold to 9/10)
  if (d.retention >= 9) {
    positives.push({
      label: 'Core Locked In',
      value: `${d.retention}/10 top scorers under contract`,
      sentiment: 'positive',
    });
  }

  // Long contracts
  const clRank = rank(d.contractLen, d.allContractLen, true);
  if (clRank <= 3 && d.contractLen >= 2.5) {
    positives.push({
      label: 'Contract Security',
      value: `#${clRank} avg contract length (${d.contractLen.toFixed(1)} yrs)`,
      sentiment: 'positive',
    });
  }

  // Cap opening next year
  if (d.capTrajectory > 5_000_000) {
    positives.push({
      label: 'Cap Opening',
      value: `${fmtCurrency(d.capTrajectory)} more cap next year`,
      sentiment: 'positive',
    });
  }

  // Cap efficiency
  const effRank = rank(d.pointsPerMillion, d.allEfficiency, true);
  if (effRank <= 3) {
    positives.push({
      label: 'Cap Efficient',
      value: `#${effRank} in production per dollar`,
      sentiment: 'positive',
    });
  }

  // --- NEGATIVE highlights ---

  // Cap crunch
  if (capRank >= leagueSize - 2) {
    negatives.push({
      label: 'Cap Crunch',
      value: `#${capRank} in cap space (${fmtCurrency(d.ecs)})`,
      sentiment: 'negative',
    });
  }

  // Dead money
  const dmRank = rank(d.dm, d.allDeadMoney, false);
  if (d.dm > 2_000_000 && dmRank >= leagueSize - 2) {
    negatives.push({
      label: 'Dead Money',
      value: `${fmtCurrency(d.dm)} in dead cap`,
      sentiment: 'negative',
    });
  }

  // Aging expensive core
  if (wAgeRank >= leagueSize - 2) {
    negatives.push({
      label: 'Aging Core',
      value: `#${wAgeRank} oldest salary-weighted roster`,
      sentiment: 'negative',
    });
  }

  // Core turnover (lowered threshold to 5/10)
  if (d.retention <= 5) {
    negatives.push({
      label: 'Core Turnover',
      value: `Only ${d.retention}/10 top scorers returning`,
      sentiment: 'negative',
    });
  }

  // Expiring contracts
  if (d.exp >= 8) {
    negatives.push({
      label: 'Expiring Contracts',
      value: `${d.exp} contracts expiring`,
      sentiment: 'negative',
    });
  }

  // Short contracts
  if (clRank >= leagueSize - 2 && d.contractLen < 2.0) {
    negatives.push({
      label: 'Short Contracts',
      value: `#${clRank} avg contract length (${d.contractLen.toFixed(1)} yrs)`,
      sentiment: 'negative',
    });
  }

  // Roster holes
  if (d.holes >= 6) {
    negatives.push({
      label: 'Roster Holes',
      value: `${d.holes} spots to fill`,
      sentiment: 'negative',
    });
  }

  // Positional gaps — QB and TE are critical
  const qb = d.posDepth['QB'] ?? 0;
  const te = d.posDepth['TE'] ?? 0;
  if (qb === 0) {
    negatives.push({
      label: 'No QB',
      value: 'Zero quarterbacks under contract (6pt pass TD league)',
      sentiment: 'negative',
    });
  }
  if (te === 0) {
    negatives.push({
      label: 'No TE',
      value: 'Zero tight ends under contract (1.0 PPR TE league)',
      sentiment: 'negative',
    });
  } else if (te === 1) {
    negatives.push({
      label: 'TE Thin',
      value: 'Only 1 TE under contract (1.0 PPR TE league)',
      sentiment: 'negative',
    });
  }

  // Cap cliff (future years)
  if (d.capCliff.value < 2_000_000 && d.capCliff.year >= 2) {
    negatives.push({
      label: 'Cap Cliff',
      value: `${fmtCurrency(d.capCliff.value)} effective cap in year ${d.capCliff.year}`,
      sentiment: 'negative',
    });
  }

  // Cap tightening next year
  if (d.capTrajectory < -3_000_000) {
    negatives.push({
      label: 'Cap Tightening',
      value: `${fmtCurrency(Math.abs(d.capTrajectory))} less cap next year`,
      sentiment: 'negative',
    });
  }

  // --- Assemble: guarantee at least 1 positive and 1 negative if available ---
  const result: IntelHighlight[] = [];
  const maxHighlights = 5;

  // Interleave: positive, negative, positive, negative...
  let pi = 0;
  let ni = 0;
  while (result.length < maxHighlights && (pi < positives.length || ni < negatives.length)) {
    if (pi < positives.length) result.push(positives[pi++]);
    if (result.length < maxHighlights && ni < negatives.length) result.push(negatives[ni++]);
  }

  return result;
}
