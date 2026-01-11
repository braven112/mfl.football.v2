/**
 * Auction Price Calculator
 * 
 * Predicts auction prices for free agents based on:
 * - Player rankings (dynasty/redraft weighted)
 * - Historical Salary Curves (Max/Avg/Min)
 * - Available cap space across league
 * - Position scarcity
 * - Contract length preferences
 */

import type {
    PlayerValuation,
    MarketAnalysis,
    TeamCapSituation,
    AuctionPriceFactors,
    PositionScarcityAnalysis,
  } from '../types/auction-predictor';
import fs from 'fs';
import path from 'path';
import historicalCurves from '../../data/theleague/historical-salary-curves.json';
import { computeLeagueFAEnvelope } from './league-cap';
  
  const LEAGUE_MINIMUM = 425_000;
  const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
  const PRICE_RANGE_PERCENT = 0.20;
  const DEFAULT_TARGET_ACTIVE_ROSTER = 26;
  const GLOBAL_POSITION_MAX_CAP = 12_000_000;

  let cachedHistoricalPositionMaxes: Record<string, number> | null = null;
  let cachedHistoricalPositionMaxesSince2020: Record<string, number> | null = null;
  let cachedHistoricalPositionMins: Record<string, number> | null = null;
  
  export interface HistoricalCurveParameters {
    basePrice: number;
    decayRate: number;
    dataPoints?: number;
  }
  
  export interface PositionCurves {
    max: HistoricalCurveParameters;
    avg: HistoricalCurveParameters;
    min: HistoricalCurveParameters;
  }

  // Cast JSON data to typed interface
  const curves = historicalCurves as unknown as Record<string, PositionCurves>;
  
  // Re-export types for consumers
  export type PricingModel = 'min' | 'average' | 'max';

  export interface ContractPricing {
    oneYear: number;
    twoYear: number;
    threeYear: number;
    fourYear: number;
    fiveYear: number;
    recommended: {
      years: number;
      price: number;
      reason: string;
    };
  }
  
  export interface PriceCalculationFactors {
    basePrice: number;
    rankMultiplier: number; // Deprecated/Baked-in
    ageMultiplier: number;
    scarcityMultiplier: number;
    demandMultiplier: number; // Deprecated/Baked-in
    finalPrice: number;
    confidence: number;
  }

  type RankTier = 'elite' | 'star' | 'starter' | 'flyer' | 'depth';

  export const TIER_PRICE_FLOORS: Record<RankTier, number> = {
    elite: 0,
    star: 0,
    starter: 0,
    flyer: 0,
    depth: 0,
  };

  const TIER_ABSOLUTE_FLOORS: Record<RankTier, number> = {
    elite: 7_000_000,
    star: 3_500_000,
    starter: 2_000_000,
    flyer: 750_000,
    depth: 0,
  };

  const POSITION_TIER_FLOORS: Record<string, Partial<Record<RankTier, number>>> = {};

  const POSITION_TIER_ABSOLUTE_FLOORS: Record<string, Partial<Record<RankTier, number>>> = {
    PK: {
      elite: 1_000_000,
      star: 900_000,
      starter: 500_000,
      flyer: 500_000,
    },
  };

  const POSITION_TIER_MULTIPLIERS: Record<string, Partial<Record<RankTier, number>>> = {
    QB: {
      elite: 1.25,
      star: 1.15,
      starter: 1.2,
    },
  };

  export function getOverallRankTier(overallRank: number): 'elite' | 'star' | 'starter' | 'depth' {
    if (overallRank <= 30) return 'elite';
    if (overallRank <= 105) return 'star';
    if (overallRank <= 199) return 'starter';
    return 'depth';
  }

  export function calculateEliteRankPremium(rank: number): number {
    return 0;
  }

  export function applyTierPriceFloor(
    calculatedPrice: number,
    overallRank: number,
    positionHistoricalMax: number,
    position?: string,
    tierOverride?: RankTier,
    positionHistoricalMin?: number | null
  ): number {
    const tier = tierOverride || getOverallRankTier(overallRank);
    const positionFloors = position ? POSITION_TIER_FLOORS[position] : undefined;
    const floorPercent = positionFloors?.[tier] ?? TIER_PRICE_FLOORS[tier];
    const priceFloor = Math.max(0, (positionHistoricalMin || 0) * (1 + floorPercent));
    const positionFloor = position ? POSITION_TIER_ABSOLUTE_FLOORS[position]?.[tier] : undefined;
    const absoluteFloor = positionFloor !== undefined ? positionFloor : TIER_ABSOLUTE_FLOORS[tier];
    const historicalMinFloor = positionHistoricalMin || 0;
    return Math.max(calculatedPrice, priceFloor, absoluteFloor, historicalMinFloor);
  }

  function applyTierPriceMultiplier(
    calculatedPrice: number,
    overallRank: number,
    position?: string,
    tierOverride?: RankTier
  ): number {
    if (!position) return calculatedPrice;
    const tier = tierOverride || getOverallRankTier(overallRank);
    const multiplier = POSITION_TIER_MULTIPLIERS[position]?.[tier];
    return multiplier ? calculatedPrice * multiplier : calculatedPrice;
  }

  function getFlyerPointIds(availablePlayers?: PlayerValuation[]): Set<string> {
    if (!availablePlayers?.length) return new Set();
    const ranked = [...availablePlayers]
      .filter(player => typeof player.points === 'number' && player.points > 0)
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .slice(0, 300);
    return new Set(ranked.map(player => player.id));
  }

  function getBaseFloorPrice(
    player: PlayerValuation,
    factors: AuctionPriceFactors,
    curvesSource?: Record<string, PositionCurves>,
    flyerPointIds?: Set<string>,
    positionRankMap?: Map<string, number>
  ): number {
    const normalizedPos = player.position?.toUpperCase();
    const positionCurves = curvesSource ? curvesSource[normalizedPos] : curves[normalizedPos];
    if (!positionCurves) return LEAGUE_MINIMUM;

    const rank = getWeightedRank(player, factors);
    const historicalMax = positionCurves.max.basePrice;
    const historicalMin = getHistoricalPositionMin(player, curvesSource);
    const tierOverride = getPlayerTier(player, rank, flyerPointIds, positionRankMap);
    let floor = applyTierPriceFloor(
      0,
      rank,
      historicalMax,
      player.position,
      tierOverride,
      historicalMin
    );

    if (rank <= 300) {
      floor = Math.max(floor, 750_000);
    }

    return Math.max(LEAGUE_MINIMUM, floor);
  }

  function getDefensePointsRanks(availablePlayers?: PlayerValuation[]): Map<string, number> {
    const ranks = new Map<string, number>();
    if (!availablePlayers?.length) return ranks;
    const defenses = availablePlayers
      .filter(player => player.position === 'DEF')
      .sort((a, b) => (b.points || 0) - (a.points || 0));
    defenses.forEach((player, index) => ranks.set(player.id, index + 1));
    return ranks;
  }

  function getPlayerTier(
    player: PlayerValuation,
    overallRank: number,
    flyerPointIds?: Set<string>,
    positionRankMap?: Map<string, number>
  ): RankTier {
    const positionRank = positionRankMap?.get(player.id);
    if (player.position === 'PK' && positionRank) {
      if (positionRank <= 310) return 'elite';
      if (positionRank <= 500) return 'star';
      if (positionRank <= 700) return 'starter';
      return 'depth';
    }
    if (positionRank === 1 && overallRank <= 50) return 'elite';

    const baseTier = getOverallRankTier(overallRank);
    if (baseTier !== 'depth') return baseTier;

    if (overallRank <= 300 && ['RB', 'WR', 'TE'].includes(player.position)) {
      const isYoung = player.age <= 27;
      const isTopPoints = flyerPointIds?.has(player.id) || false;
      if (isYoung || isTopPoints) {
        return 'flyer';
      }
    }

    return 'depth';
  }

  function getWeightedRank(player: PlayerValuation, factors: AuctionPriceFactors): number {
    let rank = 999;
    if (factors.dynastyWeight > 0 && player.dynastyRank) {
       if (factors.redraftWeight === 0) {
        rank = player.dynastyRank;
       } else if (player.redraftRank) {
         rank = (player.dynastyRank * factors.dynastyWeight) + (player.redraftRank * factors.redraftWeight);
       } else {
        rank = player.dynastyRank;
       }
    } else if (player.redraftRank) {
      rank = player.redraftRank;
    } else if (player.compositeRank) {
      rank = player.compositeRank;
    }
    return rank;
  }

  function getAgeDiscountForAge(age: number, factors: AuctionPriceFactors): number {
    const ages = Object.keys(factors.ageDiscountCurve).map(Number).sort((a, b) => a - b);
    if (ages.length === 0) return 0;
    const clampedAge = Math.min(Math.max(age, ages[0]), ages[ages.length - 1]);
    return factors.ageDiscountCurve[clampedAge] || 0;
  }

  function getAgePremiumForAge(age: number): number {
    if (age <= 24) return 0.08;
    if (age === 25) return 0.05;
    if (age === 26) return 0.03;
    if (age === 27) return 0.01;
    return 0;
  }

  function getContractAgeMultiplier(player: PlayerValuation, factors: AuctionPriceFactors): number {
    let ageOffset = 0;
    if (player.position === 'QB') ageOffset = -5;
    if (player.position === 'RB') ageOffset = 2;
    const adjustedAge = Math.round(player.age + ageOffset);
    const ageDiscount = getAgeDiscountForAge(adjustedAge, factors);
    return 1 - ageDiscount;
  }

  function getRankedPositionCap(
    player: PlayerValuation,
    factors: AuctionPriceFactors,
    positionCap?: number | null
  ): number | null {
    if (!positionCap) return null;
    const rank = getWeightedRank(player, factors);
    if (!rank || rank <= 3) return positionCap;
    const maxRank = 100;
    const reductionMax = 0.30; // taper caps for top 100 to avoid 12M clustering
    const progress = Math.min(1, Math.max(0, (rank - 3) / (maxRank - 3)));
    return Math.round(positionCap * (1 - (reductionMax * progress)));
  }

  export function selectHistoricalCurveForPosition(
    position: string,
    availablePlayers: PlayerValuation[],
    factors: AuctionPriceFactors
  ): 'max' | 'avg' | 'min' {
    const normalizedPos = position.toUpperCase();
    const positionPlayers = availablePlayers
      .filter(p => p.position?.toUpperCase() === normalizedPos)
      .sort((a, b) => getWeightedRank(a, factors) - getWeightedRank(b, factors));

    if (positionPlayers.length === 0) return 'min';

    const bestPlayerAtPosition = positionPlayers[0];
    const bestRank = getWeightedRank(bestPlayerAtPosition, factors);
    const bestPlayerTier = getOverallRankTier(bestRank);

    if (bestPlayerTier === 'elite') {
      return normalizedPos === 'WR' ? 'avg' : 'max';
    }
    if (bestPlayerTier === 'star') {
      return ['QB', 'TE'].includes(normalizedPos) ? 'max' : 'avg';
    }
    return 'min';
  }

  export function getPositionalMetadata(
    player: PlayerValuation,
    availablePlayers: PlayerValuation[],
    factors: AuctionPriceFactors
  ): {
    playerTier: 'elite' | 'star' | 'starter' | 'depth';
    bestAtPosition: PlayerValuation;
    bestPlayerTier: 'elite' | 'star' | 'starter' | 'depth';
    curveType: 'max' | 'avg' | 'min';
  } {
    const playerRank = getWeightedRank(player, factors);
    const playerTier = getOverallRankTier(playerRank);

    const normalizedPos = player.position?.toUpperCase();
    const positionPlayers = availablePlayers
      .filter(p => p.position?.toUpperCase() === normalizedPos)
      .sort((a, b) => getWeightedRank(a, factors) - getWeightedRank(b, factors));

    const bestAtPosition = positionPlayers[0] || player;
    const bestPlayerTier = getOverallRankTier(getWeightedRank(bestAtPosition, factors));
    const curveType = selectHistoricalCurveForPosition(player.position, availablePlayers, factors);

    return { playerTier, bestAtPosition, bestPlayerTier, curveType };
  }

  /**
   * Calculate positional scarcity for the auction market
   */
  export function calculatePositionalScarcity(
    position: string,
    availablePlayers: PlayerValuation[],
    teamCapSituations: TeamCapSituation[]
  ): PositionScarcityAnalysis {
    const normalizedTargetPos = position?.toUpperCase() || 'UNKNOWN';
    
    // Supply: Available players at this position
    const positionPlayers = availablePlayers.filter(p => p.position?.toUpperCase() === normalizedTargetPos);
    const qualityStartersAvailable = positionPlayers.filter(p => {
      // Heuristic for "Quality": Top 30 at pos or has significant projected points
      return (p.compositeRank && p.compositeRank <= 100) || (p.projectedPoints && p.projectedPoints > 100);
    }).length;
    
    // Demand: Teams needing this position
    const teamsNeedingStarters = teamCapSituations.filter(team => {
      // Safety check for test mocks
      if (!team.positionalNeeds) return false;
      const need = team.positionalNeeds.find(n => n.position?.toUpperCase() === normalizedTargetPos);
      return need && (need.priority === 'critical' || need.priority === 'high');
    }).length;
    
    const totalDemand = teamCapSituations.reduce((sum, team) => {
      if (!team.positionalNeeds) return sum;
      const need = team.positionalNeeds.find(n => n.position?.toUpperCase() === normalizedTargetPos);
      return sum + (need?.targetAcquisitions || 0);
    }, 0);
    
    // Scarcity Calculation
    const supplyDemandRatio = Math.max(1, totalDemand) / Math.max(1, qualityStartersAvailable);
    const scarcityScore = Math.min(100, Math.max(0, (supplyDemandRatio - 0.5) * 66));
    
    // Price Multiplier
    const priceImpactMultiplier = 0.9 + (scarcityScore / 100) * 0.6;
    
    return {
      position,
      currentRosteredPlayers: 0,
      qualityStartersAvailable,
      expiringContracts: positionPlayers.length,
      rookiesExpected: 0,
      totalLeagueStartingSpots: 16,
      teamsNeedingStarters,
      averageDepthPerTeam: 0,
      scarcityScore,
      priceImpactMultiplier,
      topTierSize: positionPlayers.filter(p => p.compositeRank && p.compositeRank <= 20).length,
      replacementLevel: LEAGUE_MINIMUM,
    };
  }
  
  /**
   * Calculate Intrinsic Value using Historical Salary Curves
   * Selects Max/Avg/Min curve based on Player Quality
   */
  function calculateIntrinsicValue(
    player: PlayerValuation,
    factors: AuctionPriceFactors,
    curvesSource?: Record<string, PositionCurves>,
    availablePlayers?: PlayerValuation[],
    flyerPointIds?: Set<string>,
    defensePointsRanks?: Map<string, number>,
    positionRankMap?: Map<string, number>
  ): number {
    // 1. Determine Rank
    const defenseRank = defensePointsRanks?.get(player.id);
    const rank = player.position === 'DEF' && defenseRank ? defenseRank : getWeightedRank(player, factors);
  
    // 2. Get Curves for Position
    // Use injected source or global import
    const normalizedPos = player.position?.toUpperCase();
    const positionCurves = curvesSource ? curvesSource[normalizedPos] : curves[normalizedPos];
    
    if (!positionCurves) {
      // Fallback logic
      return Math.max(LEAGUE_MINIMUM, 10000000 - (rank * 200000));
    }
  
    const curveType = selectHistoricalCurveForPosition(
      player.position,
      availablePlayers || [player],
      factors
    );
    const curve = positionCurves[curveType];

    if (normalizedPos === 'DEF') {
      const maxPrice = 1_500_000;
      const minPrice = 750_000;
      const defenseCount = defensePointsRanks?.size || 1;
      let decayRate = curve.decayRate;
      if (!decayRate && defenseCount > 1) {
        decayRate = Math.log(minPrice / maxPrice) / (defenseCount - 1);
      }
      const decay = decayRate || 0;
      const rawPrice = maxPrice * Math.exp(decay * (rank - 1));
      return Math.max(minPrice, Math.min(maxPrice, rawPrice));
    }

    // 3. Calculate Exponential Decay
    const baseDecayRate = player.position === 'QB' ? curve.decayRate * 0.04 : curve.decayRate;
    const topDecayMultiplier = player.position === 'QB' ? 1.0 : 1.6;
    const decayRate = rank <= 100 ? baseDecayRate * topDecayMultiplier : baseDecayRate;

    let curvePrice: number;
    if (rank <= 15 && ['RB', 'WR'].includes(normalizedPos || '') ) {
      const maxCurve = positionCurves.max;
      const avgCurve = positionCurves.avg;
      const maxWeight = Math.max(0, Math.min(1, 0.50 - ((rank - 1) * (0.50 / 14))));
      const avgWeight = 1 - maxWeight;
      const maxBaseDecay = player.position === 'QB' ? maxCurve.decayRate * 0.85 : maxCurve.decayRate;
      const avgBaseDecay = player.position === 'QB' ? avgCurve.decayRate * 0.85 : avgCurve.decayRate;
      const maxDecay = rank <= 100 ? maxBaseDecay * 1.6 : maxBaseDecay;
      const avgDecay = rank <= 100 ? avgBaseDecay * 1.6 : avgBaseDecay;
      const maxPrice = maxCurve.basePrice * Math.exp(maxDecay * (rank - 1));
      const avgPrice = avgCurve.basePrice * Math.exp(avgDecay * (rank - 1));
      curvePrice = (maxPrice * maxWeight) + (avgPrice * avgWeight);
    } else {
      curvePrice = curve.basePrice * Math.exp(decayRate * (rank - 1));
    }

    // 4. Elite Rank Premium
    const elitePremium = calculateEliteRankPremium(rank);
    const priceWithPremium = curvePrice * (1 + elitePremium);

    // 5. Apply Tier-Based Price Floor (use curve max, not historical max)
    const historicalMax = positionCurves.max.basePrice;
    const historicalMin = getHistoricalPositionMin(player, curvesSource);
    const tierOverride = getPlayerTier(player, rank, flyerPointIds, positionRankMap);
    const tierMultiplied = applyTierPriceMultiplier(priceWithPremium, rank, player.position, tierOverride);
    const finalPrice = applyTierPriceFloor(
      tierMultiplied,
      rank,
      historicalMax,
      player.position,
      tierOverride,
      historicalMin
    );

    return Math.max(LEAGUE_MINIMUM, finalPrice);
  }

  function getHistoricalPositionMax(
    player: PlayerValuation,
    curvesSource?: Record<string, PositionCurves>
  ): number | null {
    const normalizedPos = player.position?.toUpperCase();
    if (!normalizedPos) return null;

    if (!cachedHistoricalPositionMaxes) {
      cachedHistoricalPositionMaxes = loadHistoricalPositionMaxes();
    }

    const historicalMax = cachedHistoricalPositionMaxes[normalizedPos];
    if (historicalMax) {
      return historicalMax;
    }

    const positionCurves = curvesSource ? curvesSource[normalizedPos] : curves[normalizedPos];
    if (!positionCurves?.max?.basePrice) return null;
    return positionCurves.max.basePrice;
  }

  function getHistoricalPositionMin(
    player: PlayerValuation,
    curvesSource?: Record<string, PositionCurves>
  ): number | null {
    const normalizedPos = player.position?.toUpperCase();
    if (!normalizedPos) return null;

    if (!cachedHistoricalPositionMins) {
      cachedHistoricalPositionMins = loadHistoricalPositionMins();
    }

    const historicalMin = cachedHistoricalPositionMins[normalizedPos];
    if (historicalMin) {
      return historicalMin;
    }

    const positionCurves = curvesSource ? curvesSource[normalizedPos] : curves[normalizedPos];
    if (!positionCurves?.min?.basePrice) return null;
    return positionCurves.min.basePrice;
  }

  function getPositionMaxCap(
    player: PlayerValuation,
    curvesSource?: Record<string, PositionCurves>
  ): number | null {
    const normalizedPos = player.position?.toUpperCase();
    if (!normalizedPos) return null;

    const positionCurves = curvesSource ? curvesSource[normalizedPos] : curves[normalizedPos];
    const curveMax = positionCurves?.max?.basePrice;

    let historicalMax = getHistoricalPositionMax(player, curvesSource);
    if (normalizedPos === 'WR') {
      if (!cachedHistoricalPositionMaxesSince2020) {
        cachedHistoricalPositionMaxesSince2020 = loadHistoricalPositionMaxes(2020);
      }
      historicalMax = cachedHistoricalPositionMaxesSince2020[normalizedPos] || historicalMax;
    }

    const caps = [curveMax, historicalMax, GLOBAL_POSITION_MAX_CAP].filter((value): value is number => typeof value === 'number' && value > 0);

    if (caps.length === 0) return null;
    return Math.min(...caps);
  }

  function clampScaledPrice(
    player: PlayerValuation,
    scaledPrice: number,
    factors: AuctionPriceFactors,
    curvesSource?: Record<string, PositionCurves>,
    flyerPointIds?: Set<string>
  ): number {
    const normalizedPos = player.position?.toUpperCase();
    const positionCurves = curvesSource ? curvesSource[normalizedPos] : curves[normalizedPos];
    if (!positionCurves) {
      return Math.max(LEAGUE_MINIMUM, scaledPrice);
    }

    const rank = getWeightedRank(player, factors);
    const historicalMax = positionCurves.max.basePrice;
    const historicalMin = getHistoricalPositionMin(player, curvesSource);
    const tierOverride = getPlayerTier(player, rank, flyerPointIds);
    let clamped = applyTierPriceFloor(
      scaledPrice,
      rank,
      historicalMax,
      player.position,
      tierOverride,
      historicalMin
    );

    if (rank <= 300) {
      clamped = Math.max(clamped, 750_000);
    }

    return Math.max(LEAGUE_MINIMUM, clamped);
  }

  function loadHistoricalPositionMaxes(minYear?: number): Record<string, number> {
    const maxes: Record<string, number> = {};
    try {
      const dataDir = path.resolve(process.cwd(), 'data', 'theleague');
      const files = fs.readdirSync(dataDir)
        .filter(file => /^mfl-player-salaries-\d{4}\.json$/.test(file))
        .filter(file => {
          if (!minYear) return true;
          const year = Number(file.match(/\d{4}/)?.[0] || 0);
          return year >= minYear;
        });
      files.forEach(file => {
        const content = fs.readFileSync(path.join(dataDir, file), 'utf8');
        const data = JSON.parse(content);
        const playersRaw = data.players ?? data.player ?? [];
        const players = Array.isArray(playersRaw) ? playersRaw : Object.values(playersRaw);
        players.forEach((player: any) => {
          const pos = String(player.position || player.pos || '').toUpperCase();
          if (!pos) return;
          const salary = parseInt(player.salary || player.cap || player.amount || 0, 10) || 0;
          if (!salary) return;
          if (!maxes[pos] || salary > maxes[pos]) {
            maxes[pos] = salary;
          }
        });
      });
    } catch (error) {
      return {};
    }

    return maxes;
  }

  function loadHistoricalPositionMins(): Record<string, number> {
    const mins: Record<string, number> = {};
    try {
      const dataDir = path.resolve(process.cwd(), 'data', 'theleague');
      const files = fs.readdirSync(dataDir).filter(file => /^mfl-player-salaries-\d{4}\.json$/.test(file));
      files.forEach(file => {
        const content = fs.readFileSync(path.join(dataDir, file), 'utf8');
        const data = JSON.parse(content);
        const playersRaw = data.players ?? data.player ?? [];
        const players = Array.isArray(playersRaw) ? playersRaw : Object.values(playersRaw);
        players.forEach((player: any) => {
          const pos = String(player.position || player.pos || '').toUpperCase();
          if (!pos) return;
          const salary = parseInt(player.salary || player.cap || player.amount || 0, 10) || 0;
          if (!salary) return;
          if (!mins[pos] || salary < mins[pos]) {
            mins[pos] = salary;
          }
        });
      });
    } catch (error) {
      return {};
    }

    return mins;
  }
  
  /**
   * Apply age adjustment to price (Risk Discount)
   */
  function applyAgeAdjustment(
    baseValue: number,
    age: number,
    factors: AuctionPriceFactors
  ): number {
    const ageOffset = -5;
    const adjustedAge = Math.round(age + ageOffset);
    const ageDiscount = getAgeDiscountForAge(adjustedAge, factors);
    const agePremium = getAgePremiumForAge(adjustedAge);
    return baseValue * (1 - ageDiscount + agePremium);
  }
  
  /**
   * Calculate/Predict auction price for a single player
   * (Renamed from predictPlayerAuctionPrice to match old export)
   */
  export function calculateAuctionPrice(
    player: PlayerValuation,
    // Note: Signature changed from old version. Consumers need to pass factors/scarcity.
    // Old signature: (player, marketAnalysis, dynastyWeight, allPlayers, pricingModel)
    // New signature needs to adapt or we keep the new one and fix consumers.
    // Let's adapt the inputs to support the test/legacy usage if possible, or force update.
    // Actually, let's keep the NEW signature for internal logic, but export a wrapper if needed.
    // But for now, let's stick to the NEW robust signature and update consumers.
    factors: AuctionPriceFactors,
    scarcityAnalysis: PositionScarcityAnalysis,
    curvesSource?: Record<string, PositionCurves>,
    availablePlayers?: PlayerValuation[],
    flyerPointIds?: Set<string>,
    defensePointsRanks?: Map<string, number>,
    positionRankMap?: Map<string, number>,
    wrTop100Count?: number
  ): PriceCalculationFactors { // Returns Factors object to match old interface
    
    const defenseRank = defensePointsRanks?.get(player.id);
    const overallRank = player.position === 'DEF' && defenseRank ? defenseRank : getWeightedRank(player, factors);
    // Step 1: Intrinsic Value (Historical Norms based on Rank + Quality Curve)
    let intrinsicValue = calculateIntrinsicValue(
      player,
      factors,
      curvesSource,
      availablePlayers,
      flyerPointIds,
      defensePointsRanks,
      positionRankMap
    );

    if (player.position === 'DEF') {
      let predictedPrice = intrinsicValue;
      if (predictedPrice < 2000000) {
        predictedPrice = Math.round(predictedPrice / 25000) * 25000;
      } else {
        predictedPrice = Math.round(predictedPrice / 50000) * 50000;
      }
      predictedPrice = Math.max(750_000, Math.min(1_500_000, predictedPrice));
      return {
        basePrice: intrinsicValue,
        rankMultiplier: 1.0,
        ageMultiplier: 1.0,
        scarcityMultiplier: 1.0,
        demandMultiplier: 1.0,
        finalPrice: predictedPrice,
        confidence: 0.8,
      };
    }
    
    // Step 2: Market Adjustments
    let predictedPrice = applyAgeAdjustment(intrinsicValue, player.age, factors);
    
    // Scarcity Impact
    predictedPrice = predictedPrice * scarcityAnalysis.priceImpactMultiplier;
    
    // Inflation
    predictedPrice = predictedPrice * (1 + factors.inflationFactor);
    
    // Positional Premiums
    const positionPremium = factors.positionalPremiums[player.position] || 0;
    predictedPrice = predictedPrice * (1 + positionPremium);

    if (player.position === 'WR' && typeof wrTop100Count === 'number') {
      const wrPremium = Math.max(0, (wrTop100Count - 12) * 0.01);
      predictedPrice = predictedPrice * (1 + wrPremium);
    }
    
    // Rounding
    if (predictedPrice < 2000000) {
        predictedPrice = Math.round(predictedPrice / 25000) * 25000;
    } else {
        predictedPrice = Math.round(predictedPrice / 50000) * 50000;
    }

    if (overallRank <= 300) {
      predictedPrice = Math.max(predictedPrice, 750_000);
    }
    
    predictedPrice = Math.max(LEAGUE_MINIMUM, predictedPrice);
    
    // Confidence
    const confidence = 0.8; // High confidence with multi-curve model
    
    return {
      basePrice: intrinsicValue,
      rankMultiplier: 1.0, // Baked into intrinsic
      ageMultiplier: (1 - (factors.ageDiscountCurve[player.age] || 0)),
      scarcityMultiplier: scarcityAnalysis.priceImpactMultiplier,
      demandMultiplier: 1.0, // Baked into scarcity
      finalPrice: predictedPrice,
      confidence
    };
  }
  
  /**
   * Batch calculate prices for all players
   * (Renamed from predictAllAuctionPrices)
   */
  export function calculateAllPlayerPrices(
    availablePlayers: PlayerValuation[],
    teamCapSituations: TeamCapSituation[],
    factors: AuctionPriceFactors,
    curvesSource?: Record<string, PositionCurves>
  ): Map<string, { factors: PriceCalculationFactors; contracts: ContractPricing }> {
    
    const scarcityByPosition = new Map<string, PositionScarcityAnalysis>();
    for (const position of POSITIONS) {
      const scarcity = calculatePositionalScarcity(
        position,
        availablePlayers,
        teamCapSituations
      );
      scarcityByPosition.set(position, scarcity);
    }
    
    const results = new Map();

    // Sort first for consistency
    const players = [...availablePlayers].sort((a, b) => (a.compositeRank || 999) - (b.compositeRank || 999));

    // Default scarcity for unexpected positions
    const defaultScarcity: PositionScarcityAnalysis = {
      position: 'UNKNOWN',
      currentRosteredPlayers: 0,
      qualityStartersAvailable: 1,
      expiringContracts: 1,
      rookiesExpected: 0,
      totalLeagueStartingSpots: 1,
      teamsNeedingStarters: 0,
      averageDepthPerTeam: 0,
      scarcityScore: 0,
      priceImpactMultiplier: 1.0,
      topTierSize: 0,
      replacementLevel: LEAGUE_MINIMUM,
    };

    const flyerPointIds = getFlyerPointIds(availablePlayers);
    const defensePointsRanks = getDefensePointsRanks(availablePlayers);
    const positionRankMap = new Map<string, number>();
    const playersByPos: Record<string, PlayerValuation[]> = {};
    availablePlayers.forEach(player => {
      const pos = player.position;
      if (!playersByPos[pos]) playersByPos[pos] = [];
      playersByPos[pos].push(player);
    });
    Object.values(playersByPos).forEach(list => {
      list.sort((a, b) => getWeightedRank(a, factors) - getWeightedRank(b, factors));
      list.forEach((player, index) => positionRankMap.set(player.id, index + 1));
    });
    const wrTop100Count = [...availablePlayers]
      .sort((a, b) => getWeightedRank(a, factors) - getWeightedRank(b, factors))
      .slice(0, 100)
      .filter(player => player.position === 'WR').length;

    for (const player of players) {
      const normalizedPos = player.position?.toUpperCase() || 'UNKNOWN';
      const scarcity = scarcityByPosition.get(normalizedPos) || defaultScarcity;
      
      const factorsResult = calculateAuctionPrice(
        player,
        factors,
        scarcity,
        curvesSource,
        availablePlayers,
        flyerPointIds,
        defensePointsRanks,
        positionRankMap,
        wrTop100Count
      );

      const positionCap = getRankedPositionCap(
        player,
        factors,
        getPositionMaxCap(player, curvesSource)
      );
      const contracts = generateContractPricing(
        player,
        factorsResult.finalPrice,
        getContractAgeMultiplier(player, factors),
        positionCap
      );

      results.set(player.id, { factors: factorsResult, contracts });
    }

    const capEnvelope = computeLeagueFAEnvelope(teamCapSituations);
    const targetSpend = Math.round(capEnvelope.availableCap * 0.85);
    const openSlots = Math.max(1, capEnvelope.totalTeams * DEFAULT_TARGET_ACTIVE_ROSTER);
    const spendPool = openSlots > 0 ? players.slice(0, openSlots) : players;
    const oneYearMultiplier = 1 + PRICE_RANGE_PERCENT;
    const totalDefSpend = spendPool.reduce((sum, player) => {
      if (player.position !== 'DEF') return sum;
      const result = results.get(player.id);
      return sum + (result?.factors.finalPrice || 0);
    }, 0);

    const nonDefPlayers = spendPool.filter(player => player.position !== 'DEF');
    const nonDefBase = new Map<string, number>();
    const nonDefFloors = new Map<string, number>();
    nonDefPlayers.forEach(player => {
      const result = results.get(player.id);
      const basePrice = result?.factors.finalPrice || 0;
      nonDefBase.set(player.id, basePrice);
      nonDefFloors.set(player.id, getBaseFloorPrice(player, factors, curvesSource, flyerPointIds, positionRankMap));
    });

    const totalSpend = totalDefSpend + nonDefPlayers.reduce((sum, player) => {
      const basePrice = nonDefBase.get(player.id) || 0;
      return sum + (basePrice * oneYearMultiplier);
    }, 0);

    if (targetSpend > 0 && totalSpend > 0) {
      const remainingSpend = Math.max(0, targetSpend - totalDefSpend);
      const baseFloorTotal = nonDefPlayers.reduce((sum, player) => {
        const floor = nonDefFloors.get(player.id) || LEAGUE_MINIMUM;
        return sum + (floor * oneYearMultiplier);
      }, 0);

      let scale = 0;
      if (remainingSpend > 0 && baseFloorTotal < remainingSpend) {
        const totalForScale = (candidate: number) => nonDefPlayers.reduce((sum, player) => {
          const basePrice = nonDefBase.get(player.id) || 0;
          const floor = nonDefFloors.get(player.id) || LEAGUE_MINIMUM;
          const scaledBase = Math.max(floor, basePrice * candidate);
          return sum + (scaledBase * oneYearMultiplier);
        }, 0);

        let low = 0;
        let high = 1;
        let guard = 0;
        while (totalForScale(high) < remainingSpend && guard < 20) {
          high *= 2;
          guard += 1;
        }

        for (let i = 0; i < 30; i += 1) {
          const mid = (low + high) / 2;
          if (totalForScale(mid) > remainingSpend) {
            high = mid;
          } else {
            low = mid;
          }
        }
        scale = low;
      }

      results.forEach((result, playerId) => {
        const player = players.find(p => p.id === playerId);
        if (!player) return;
        const playerIndex = players.findIndex(p => p.id === playerId);
        if (openSlots > 0 && playerIndex >= openSlots) {
          result.factors.finalPrice = LEAGUE_MINIMUM;
          result.contracts = generateContractPricing(
            player,
            LEAGUE_MINIMUM,
            getContractAgeMultiplier(player, factors),
            getPositionMaxCap(player, curvesSource)
          );
          return;
        }

        const scaledPrice = player.position === 'DEF'
          ? result.factors.finalPrice
          : result.factors.finalPrice * scale;
        const clampedPrice = clampScaledPrice(player, scaledPrice, factors, curvesSource, flyerPointIds);
        result.factors.finalPrice = clampedPrice;
        const positionCap = getRankedPositionCap(
          player,
          factors,
          getPositionMaxCap(player, curvesSource)
        );
        result.contracts = generateContractPricing(
          player,
          clampedPrice,
          getContractAgeMultiplier(player, factors),
          positionCap
        );
      });
    }
    
    return results;
  }
  
  export const DEFAULT_AUCTION_FACTORS: AuctionPriceFactors = {
    dynastyWeight: 0.6,
    redraftWeight: 0.4,
    preferredContractLength: 3,
    contractLengthImpact: 0.15,
    inflationFactor: 0.05,
    positionalPremiums: {
      QB: 0.10,
      RB: 0.05,
      WR: 0,
      TE: 0,
      PK: -0.2,
      DEF: -0.15,
    },
    ageDiscountCurve: {
      22: 0, 23: 0, 24: 0, 25: 0, 
      26: 0.0, 27: 0.05, 
      28: 0.10, 29: 0.15, 
      30: 0.25, 31: 0.35, 
      32: 0.45, 33: 0.55, 
      34: 0.65, 35: 0.75,
      36: 0.85
    },
    injuryRiskDiscount: 0.15,
    useHistoricalData: true,
    historicalWeight: 1.0,
  };

/**
 * Generate multi-year contract pricing options
 * 
 * PHILOSOPHY: The basePrice represents a 3-year contract value (market equilibrium).
 * - Longer deals = discount (buying stability, accepting floor)
 * - Shorter deals = premium (betting on upside, prove-it deals)
 */
export function generateContractPricing(
    player: PlayerValuation,
    basePrice: number,
    ageMultiplier: number,
    positionCap?: number | null
  ): ContractPricing {

    if (player.position === 'DEF') {
      const flatPrice = Math.round(basePrice);
      return {
        oneYear: flatPrice,
        twoYear: flatPrice,
        threeYear: flatPrice,
        fourYear: flatPrice,
        fiveYear: flatPrice,
        recommended: {
          years: 1,
          price: flatPrice,
          reason: 'Defense pricing uses last-season points with a capped single-year range',
        },
      };
    }
  
    let adjustedBase = basePrice;
    if (positionCap) {
      const oneYearCap = positionCap / (1 + PRICE_RANGE_PERCENT);
      if (adjustedBase > oneYearCap) {
        adjustedBase = oneYearCap + ((adjustedBase - oneYearCap) * 0.4);
      }
    }

    const ageRisk = Math.max(0, 1 - ageMultiplier);
    const fiveYearDiscount = PRICE_RANGE_PERCENT + (ageRisk * 0.5);
    const fourYearDiscount = (PRICE_RANGE_PERCENT / 2) + (ageRisk * 0.3);

    const threeYear = adjustedBase;
    const fiveYear = Math.round(adjustedBase * (1 - fiveYearDiscount));
    const fourYear = Math.round(adjustedBase * (1 - fourYearDiscount));
    const twoYear = Math.round(adjustedBase * (1 + PRICE_RANGE_PERCENT / 2));
    const oneYear = Math.round(adjustedBase * (1 + PRICE_RANGE_PERCENT));

    const capValue = positionCap ?? null;
    const capPrice = (price: number) => (capValue ? Math.min(price, capValue) : price);
    const cappedOneYear = capPrice(oneYear);
    const cappedTwoYear = capPrice(twoYear);
    const cappedThreeYear = capPrice(threeYear);
    const cappedFourYear = capPrice(fourYear);
    const cappedFiveYear = capPrice(fiveYear);
    
    // Recommend contract length based on age and value
    const recommended = recommendContractLength(player, basePrice, {
      oneYear: cappedOneYear,
      twoYear: cappedTwoYear,
      threeYear: cappedThreeYear,
      fourYear: cappedFourYear,
      fiveYear: cappedFiveYear,
    });
    
    return {
      oneYear: cappedOneYear,
      twoYear: cappedTwoYear,
      threeYear: cappedThreeYear,
      fourYear: cappedFourYear,
      fiveYear: cappedFiveYear,
      recommended,
    };
  }
  
  /**
   * Recommend optimal contract length
   */
  function recommendContractLength(
    player: PlayerValuation,
    basePrice: number,
    prices: Omit<ContractPricing, 'recommended'>
  ): { years: number; price: number; reason: string } {
    const age = player.age;
    
    // Young elite players: Lock up long-term
    if (age <= 25 && basePrice >= 10_000_000) {
      return {
        years: 5,
        price: prices.fiveYear,
        reason: 'Young elite talent - maximize long-term value with a 5-year deal at discounted rate',
      };
    }
    
    // Young valuable players: 4-year deal
    if (age <= 26 && basePrice >= 5_000_000) {
      return {
        years: 4,
        price: prices.fourYear,
        reason: 'Young and productive - lock in 4 years before prime at value price',
      };
    }
    
    // Prime age players: 3-year sweet spot
    if (age >= 27 && age <= 29) {
      return {
        years: 3,
        price: prices.threeYear,
        reason: 'Prime years - 3-year deal balances value and risk',
      };
    }
    
    // Aging players: 2-year max
    if (age >= 30 && age <= 31) {
      return {
        years: 2,
        price: prices.twoYear,
        reason: 'Aging player - limit risk with 2-year deal',
      };
    }
    
    // Veterans: 1-year prove-it deals
    if (age >= 32) {
      return {
        years: 1,
        price: prices.oneYear,
        reason: 'Veteran - 1-year prove-it deal minimizes risk',
      };
    }
    
    // Default to 3-year
    return {
      years: 3,
      price: prices.threeYear,
      reason: 'Standard 3-year contract offers balanced value',
    };
  }

/**
 * Get price breakdown explanation for UI
 */
export function getPriceExplanation(factors: PriceCalculationFactors, player: PlayerValuation): string[] {
    const explanations: string[] = [];
    
    explanations.push(`Base ${player.position} salary: $${(factors.basePrice / 1_000_000).toFixed(1)}M`);
    
    if (factors.rankMultiplier !== 1.0) {
      const pct = ((factors.rankMultiplier - 1) * 100).toFixed(0);
      const direction = factors.rankMultiplier > 1 ? '+' : '';
      explanations.push(`Rank adjustment: ${direction}${pct}% (${factors.rankMultiplier}x)`);
    }
    
    if (factors.ageMultiplier !== 1.0) {
      const pct = ((factors.ageMultiplier - 1) * 100).toFixed(0);
      const direction = factors.ageMultiplier > 1 ? '+' : '';
      explanations.push(`Age ${player.age} adjustment: ${direction}${pct}% (${factors.ageMultiplier}x)`);
    }
    
    if (factors.scarcityMultiplier !== 1.0) {
      const pct = ((factors.scarcityMultiplier - 1) * 100).toFixed(0);
      const direction = factors.scarcityMultiplier > 1 ? '+' : '';
      explanations.push(`Market scarcity: ${direction}${pct}% (${factors.scarcityMultiplier.toFixed(2)}x)`);
    }
    
    if (factors.demandMultiplier !== 1.0) {
      const pct = ((factors.demandMultiplier - 1) * 100).toFixed(0);
      const direction = factors.demandMultiplier > 1 ? '+' : '';
      explanations.push(`Team demand: ${direction}${pct}% (${factors.demandMultiplier.toFixed(2)}x)`);
    }
    
    explanations.push(`Final price: $${(factors.finalPrice / 1_000_000).toFixed(2)}M (${(factors.confidence * 100).toFixed(0)}% confidence)`);
    
    return explanations;
  }
