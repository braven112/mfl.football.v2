/**
 * Draft Assets Utilities
 * Parses MFL Assets API data or transactions to determine which picks each team owns
 */

import type { DraftPrediction } from '../types/standings';

interface TransactionData {
  transactions?: {
    transaction?: Array<{
      type: string;
      franchise?: string;
      franchise2?: string;
      franchise1_gave_up?: string;
      franchise2_gave_up?: string;
      timestamp?: string;
      [key: string]: any;
    }>;
  };
}

interface StandingsData {
  leagueStandings?: {
    franchise?: Array<{
      id: string;
      [key: string]: any;
    }>;
  };
}

export interface AssetPick {
  round: string;
  pick: string;
  originalFranchiseId?: string;
  originalTeamName?: string;
}

export interface AssetsFranchise {
  id: string;
  name: string;
  asset?: AssetPick | AssetPick[];
}

export interface AssetsData {
  assets?: {
    franchise?: AssetsFranchise[];
  };
  error?: any;
}

/**
 * Convert assets data to DraftPrediction format for display
 * Each asset becomes a DraftPrediction showing the team that owns it
 */
export function convertAssetsToPredictions(
  assetsData: AssetsData,
  teamConfigMap: Map<string, { id: string; name: string; icon: string; banner: string }>
): DraftPrediction[] {
  const predictions: DraftPrediction[] = [];

  if (!assetsData?.assets?.franchise) {
    return predictions;
  }

  const franchises = assetsData.assets.franchise;

  franchises.forEach((franchise) => {
    const franchiseConfig = teamConfigMap.get(franchise.id);
    if (!franchiseConfig) return;

    // Handle both single asset and array of assets
    const assets = Array.isArray(franchise.asset) ? franchise.asset : franchise.asset ? [franchise.asset] : [];

    assets.forEach((asset) => {
      const round = parseInt(asset.round || '0');
      const pick = parseInt(asset.pick || '0');
      const overallPickNumber = (round - 1) * 16 + pick;

      // Find original team info if this pick was traded
      let originalTeamName: string | undefined;
      let originalTeamIcon: string | undefined;
      const isTraded = asset.originalFranchiseId && asset.originalFranchiseId !== franchise.id;

      if (isTraded && asset.originalFranchiseId) {
        const originalConfig = teamConfigMap.get(asset.originalFranchiseId);
        if (originalConfig) {
          originalTeamName = originalConfig.name;
          originalTeamIcon = originalConfig.icon;
        }
      }

      predictions.push({
        overallPickNumber,
        round,
        pickInRound: pick,
        franchiseId: franchise.id,
        teamName: franchiseConfig.name,
        teamIcon: franchiseConfig.icon || '',
        teamBanner: franchiseConfig.banner || '',
        currentRecord: {
          wins: 0,
          losses: 0,
          ties: 0,
        },
        currentStanding: {
          allPlayPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          powerRating: 0,
          victoryPoints: 0,
        },
        isToiletBowlPick: false,
        isLeagueWinner: false,
        originalTeamName,
        originalTeamIcon: originalTeamIcon || '',
        isTraded: !!isTraded,
      });
    });
  });

  return predictions.sort((a, b) => a.overallPickNumber - b.overallPickNumber);
}

/**
 * Check if assets data is valid and not an error response
 */
export function isValidAssetsData(data: AssetsData): boolean {
  return !data.error && data.assets?.franchise && Array.isArray(data.assets.franchise);
}

/**
 * Extract draft assets from transactions by parsing trade data
 * Builds a map of which team currently owns which draft picks
 */
export function extractAssetsFromTransactions(
  transactionsData: TransactionData,
  standingsData: StandingsData,
  draftYear: number
): AssetsData {
  if (!transactionsData?.transactions?.transaction || !standingsData?.leagueStandings?.franchise) {
    return { error: 'Missing transaction or standings data' };
  }

  const franchises = standingsData.leagueStandings.franchise;
  const transactions = transactionsData.transactions.transaction;

  // Build draft order map (franchise id -> draft position 1-16)
  const draftOrderMap = new Map<string, number>();
  franchises.forEach((franchise, index) => {
    draftOrderMap.set(franchise.id, index + 1);
  });

  // Initialize ownership: each franchise owns its own picks
  const ownershipMap = new Map<string, string>(); // key: "FP_franchiseId_year_round" -> value: current owner franchiseId

  franchises.forEach((franchise) => {
    for (let round = 1; round <= 3; round++) {
      const pickKey = `FP_${franchise.id}_${draftYear}_${round}`;
      ownershipMap.set(pickKey, franchise.id);
    }
  });

  // Process trades in chronological order (oldest first) to track ownership changes
  const sortedTransactions = [...transactions]
    .filter((t) => t.type === 'TRADE')
    .sort((a, b) => (parseInt(a.timestamp || '0') || 0) - (parseInt(b.timestamp || '0') || 0));

  sortedTransactions.forEach((trade) => {
    const franchise1 = trade.franchise;
    const franchise2 = trade.franchise2;

    if (!franchise1 || !franchise2) return;

    // Parse items from franchise1_gave_up and franchise2_gave_up
    const franchise1Items = (trade.franchise1_gave_up || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const franchise2Items = (trade.franchise2_gave_up || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Process items franchise1 gave up (go to franchise2)
    franchise1Items.forEach((item) => {
      if (item.startsWith('FP_')) {
        ownershipMap.set(item, franchise2);
      }
    });

    // Process items franchise2 gave up (go to franchise1)
    franchise2Items.forEach((item) => {
      if (item.startsWith('FP_')) {
        ownershipMap.set(item, franchise1);
      }
    });
  });

  // Build assets data structure
  const assetsByFranchise = new Map<string, Array<{ round: number; pick: number; originalId: string }>>();

  ownershipMap.forEach((currentOwner, pickKey) => {
    const match = pickKey.match(/^FP_(\d+)_(\d+)_(\d+)$/);
    if (!match) return;

    const originalId = match[1];
    const year = parseInt(match[2]);
    const round = parseInt(match[3]);

    // Only include picks for the specified year
    if (year !== draftYear) return;

    // Calculate pick number in round based on original owner's draft position
    const draftPosition = draftOrderMap.get(originalId) || 1;

    if (!assetsByFranchise.has(currentOwner)) {
      assetsByFranchise.set(currentOwner, []);
    }

    assetsByFranchise.get(currentOwner)!.push({
      round,
      pick: draftPosition,
      originalId,
    });
  });

  // Convert to API format
  const franchiseAssets: AssetsFranchise[] = [];
  assetsByFranchise.forEach((assets, franchiseId) => {
    const franchise = franchises.find((f) => f.id === franchiseId);
    if (!franchise) return;

    const picks: AssetPick[] = assets.map((asset) => ({
      round: asset.round.toString(),
      pick: asset.pick.toString(),
      originalFranchiseId: asset.originalId,
    }));

    franchiseAssets.push({
      id: franchiseId,
      name: franchise.id,
      asset: picks.length === 1 ? picks[0] : picks.length > 1 ? picks : undefined,
    });
  });

  return {
    assets: {
      franchise: franchiseAssets,
    },
  };
}
