/**
 * Intel Page Utilities
 *
 * Computes competitive intelligence metrics for each franchise:
 * - Team archetype classification (Win-Now, Contender, Retooling, Rebuilding)
 * - Composite power score from cap, roster, and contract health
 * - Key intel highlights (strengths, weaknesses, opportunities)
 *
 * Reuses league-summary-utils.ts data structures.
 */

import type { TeamSummary } from './league-summary-utils';
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
  committedPct: number;
  rosterHoles: number;
  topPlayerRetention: number;
  weightedAge: number;
  avgContractLength: number;
  /** Year-over-year cap trajectory (year 0 vs year 1) */
  capTrajectory: number;
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
// Format helpers (for highlight values)
// ---------------------------------------------------------------------------

function fmtCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

export function computeTeamIntel(summaries: TeamSummary[]): TeamIntel[] {
  // Extract current-year (index 0) metrics for all teams
  const allCapSpace = summaries.map((t) => t.metrics.capSpace[0]);
  const allEffective = summaries.map((t) => t.metrics.effectiveCapSpace[0]);
  const allDeadMoney = summaries.map((t) => t.metrics.deadMoney[0]);
  const allAvgAge = summaries.map((t) => t.metrics.avgAge[0]);
  const allPlayers = summaries.map((t) => t.metrics.playersUnderContract[0]);
  const allExpiring = summaries.map((t) => t.metrics.expiringContracts[0]);
  const allDraft = summaries.map((t) => t.metrics.draftCapital[0]);
  const allCommitted = summaries.map((t) => t.metrics.committedSalaryPct[0]);
  const allRetention = summaries.map((t) => t.metrics.topPlayerRetention[0]);
  const allWeightedAge = summaries.map((t) => t.metrics.weightedAge[0]);
  const allContractLen = summaries.map((t) => t.metrics.avgContractLength[0]);
  const allRosterHoles = summaries.map((t) => t.metrics.rosterHoles[0]);

  return summaries.map((team) => {
    const cs = team.metrics.capSpace[0];
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

    // Cap trajectory: cap space year 1 vs year 0
    const capTrajectory = (team.metrics.capSpace[1] ?? cs) - cs;

    // --- Component Scores ---
    // Cap score: effective cap space + low dead money
    const capScore = clamp(
      rankScore(ecs, allEffective, true) * 0.6 +
      rankScore(dm, allDeadMoney, false) * 0.4
    );

    // Roster score: players under contract + low roster holes + young age
    const rosterScore = clamp(
      rankScore(puc, allPlayers, true) * 0.35 +
      rankScore(holes, allRosterHoles, false) * 0.30 +
      rankScore(age, allAvgAge, false) * 0.35
    );

    // Contract score: retention + contract length + low expiring
    const contractScore = clamp(
      rankScore(retention, allRetention, true) * 0.4 +
      rankScore(contractLen, allContractLen, true) * 0.35 +
      rankScore(exp, allExpiring, false) * 0.25
    );

    // Draft score: draft capital
    const draftScore = clamp(rankScore(draft, allDraft, true));

    // --- Composite Power Score ---
    const powerScore = Math.round(
      capScore * 0.25 +
      rosterScore * 0.30 +
      contractScore * 0.30 +
      draftScore * 0.15
    );

    // --- Archetype Classification ---
    const archetype = classifyArchetype(powerScore, age, contractLen, ecs, holes);

    // --- Highlights ---
    const highlights = buildHighlights({
      cs, ecs, dm, age, puc, exp, draft, committed, retention, wAge, contractLen, holes, capTrajectory,
      allCapSpace, allEffective, allDeadMoney, allAvgAge, allPlayers, allExpiring,
      allDraft, allCommitted, allRetention, allWeightedAge, allContractLen, allRosterHoles,
    });

    return {
      franchiseId: team.franchiseId,
      teamName: team.teamName,
      teamNameShort: team.teamNameShort,
      teamIcon: team.teamIcon,
      division: team.division,
      archetype,
      powerScore,
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
      committedPct: committed,
      rosterHoles: holes,
      topPlayerRetention: retention,
      weightedAge: wAge,
      avgContractLength: contractLen,
      capTrajectory,
    };
  });
}

// ---------------------------------------------------------------------------
// Archetype classification
// ---------------------------------------------------------------------------

function classifyArchetype(
  powerScore: number,
  avgAge: number,
  contractLen: number,
  effectiveCap: number,
  rosterHoles: number,
): TeamArchetype {
  // Win-Now: high power score, older roster, locked-in contracts
  if (powerScore >= 65 && avgAge >= 26 && rosterHoles <= 3) return 'Win-Now';

  // Contender: solid power score, balanced age
  if (powerScore >= 50 && rosterHoles <= 5) return 'Contender';

  // Rebuilding: low power, young roster or lots of cap/picks
  if (powerScore < 35 || (rosterHoles >= 8 && effectiveCap > SALARY_CAP * 0.3)) return 'Rebuilding';

  // Retooling: middle ground
  return 'Retooling';
}

// ---------------------------------------------------------------------------
// Highlight generation
// ---------------------------------------------------------------------------

interface HighlightInput {
  cs: number; ecs: number; dm: number; age: number; puc: number;
  exp: number; draft: number; committed: number; retention: number;
  wAge: number; contractLen: number; holes: number; capTrajectory: number;
  allCapSpace: number[]; allEffective: number[]; allDeadMoney: number[];
  allAvgAge: number[]; allPlayers: number[]; allExpiring: number[];
  allDraft: number[]; allCommitted: number[]; allRetention: number[];
  allWeightedAge: number[]; allContractLen: number[]; allRosterHoles: number[];
}

function buildHighlights(d: HighlightInput): IntelHighlight[] {
  const highlights: IntelHighlight[] = [];
  const leagueSize = d.allCapSpace.length;

  // Rank helper: 1 = best
  const rank = (val: number, all: number[], higher: boolean) => {
    const sorted = [...all].sort((a, b) => higher ? b - a : a - b);
    return sorted.indexOf(val) + 1;
  };

  // Cap space ranking
  const capRank = rank(d.ecs, d.allEffective, true);
  if (capRank <= 3) {
    highlights.push({
      label: 'Cap Space',
      value: `#${capRank} in league (${fmtCurrency(d.ecs)})`,
      sentiment: 'positive',
    });
  } else if (capRank >= leagueSize - 2) {
    highlights.push({
      label: 'Cap Crunch',
      value: `#${capRank} in cap space (${fmtCurrency(d.ecs)})`,
      sentiment: 'negative',
    });
  }

  // Dead money
  const dmRank = rank(d.dm, d.allDeadMoney, false);
  if (d.dm > 2_000_000 && dmRank >= leagueSize - 2) {
    highlights.push({
      label: 'Dead Money',
      value: `${fmtCurrency(d.dm)} in dead cap`,
      sentiment: 'negative',
    });
  }

  // Youth advantage
  const ageRank = rank(d.age, d.allAvgAge, false);
  if (ageRank <= 3) {
    highlights.push({
      label: 'Youth',
      value: `#${ageRank} youngest roster (${d.age.toFixed(1)} avg)`,
      sentiment: 'positive',
    });
  } else if (ageRank >= leagueSize - 2) {
    highlights.push({
      label: 'Aging Roster',
      value: `#${ageRank} oldest roster (${d.age.toFixed(1)} avg)`,
      sentiment: 'negative',
    });
  }

  // Expiring contracts (risk)
  const expRank = rank(d.exp, d.allExpiring, false);
  if (d.exp >= 8 && expRank >= leagueSize - 2) {
    highlights.push({
      label: 'Expiring Contracts',
      value: `${d.exp} contracts expiring`,
      sentiment: 'negative',
    });
  }

  // Draft capital
  const draftRank = rank(d.draft, d.allDraft, true);
  if (draftRank <= 3) {
    highlights.push({
      label: 'Draft Capital',
      value: `#${draftRank} in picks (${d.draft} owned)`,
      sentiment: 'positive',
    });
  }

  // Top player retention
  const retRank = rank(d.retention, d.allRetention, true);
  if (retRank <= 3 && d.retention >= 7) {
    highlights.push({
      label: 'Core Locked In',
      value: `${d.retention}/10 top scorers under contract`,
      sentiment: 'positive',
    });
  } else if (d.retention <= 4) {
    highlights.push({
      label: 'Core Turnover',
      value: `Only ${d.retention}/10 top scorers returning`,
      sentiment: 'negative',
    });
  }

  // Roster holes
  if (d.holes >= 6) {
    highlights.push({
      label: 'Roster Holes',
      value: `${d.holes} spots to fill`,
      sentiment: 'negative',
    });
  }

  // Cap trajectory
  if (d.capTrajectory > 5_000_000) {
    highlights.push({
      label: 'Cap Opening',
      value: `${fmtCurrency(d.capTrajectory)} more cap next year`,
      sentiment: 'positive',
    });
  }

  // Limit to top 4 highlights
  return highlights.slice(0, 4);
}
