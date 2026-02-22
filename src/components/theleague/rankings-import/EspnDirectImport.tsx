import { useState, useCallback } from 'react';
import { matchPlayerToMFL } from '../../../utils/rankings-importer';
import { saveImport, findDuplicateImport } from '../../../utils/rankings-storage';
import { SOURCE_LABELS } from '../../../utils/rankings-lookup';
import type {
  MFLPlayerForMatching,
  StoredRankingImport,
  StoredRankingEntry,
} from '../../../types/rankings-import';

interface Props {
  mflPlayers: MFLPlayerForMatching[];
  onImportComplete: (importData: StoredRankingImport) => void;
}

interface ImportResult {
  success: boolean;
  message: string;
  stats?: { total: number; matched: number; unmatched: number; matchRate: number };
  unmatchedNames?: string[];
}

const ESPN_API_URL =
  'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leaguedefaults/3?scoringPeriodId=0&view=kona_player_info';
const ESPN_FILTER = JSON.stringify({
  players: { limit: 500, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'PPR' } },
});

/** ESPN position IDs → standard abbreviations */
const POS_MAP: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'PK', 16: 'Def' };
const VALID_POSITIONS: Record<string, number> = { QB: 1, RB: 1, WR: 1, TE: 1 };

export default function EspnDirectImport({ mflPlayers, onImportComplete }: Props) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = useCallback(async () => {
    setImporting(true);
    setResult(null);

    try {
      const response = await fetch(ESPN_API_URL, {
        headers: { 'X-Fantasy-Filter': ESPN_FILTER },
      });
      if (!response.ok) {
        throw new Error(`ESPN API returned ${response.status}`);
      }
      const data = await response.json();
      const espnPlayers: any[] = data.players || [];

      const mflForMatching = mflPlayers.map((m) => ({
        id: m.id,
        name: m.name,
        position: m.position,
        team: m.team,
      }));

      const rankings: StoredRankingEntry[] = [];

      for (const entry of espnPlayers) {
        const player = entry.player;
        if (!player) continue;

        const pos = POS_MAP[player.defaultPositionId] || '';
        if (!VALID_POSITIONS[pos]) continue;

        const pprRank = player.draftRanksByRankType?.PPR;
        if (!pprRank?.rank) continue;

        const name = player.fullName || '';
        const match = matchPlayerToMFL(name, pos, mflForMatching);

        rankings.push({
          rank: pprRank.rank,
          playerId: match.playerId,
          playerName: name,
          position: pos,
          team: '', // ESPN API doesn't return team abbreviation in this view
          matched: match.matched,
          confidence: match.confidence,
        });
      }

      // Sort by PPR rank
      rankings.sort((a, b) => a.rank - b.rank);

      const total = rankings.length;
      const matched = rankings.filter((r) => r.matched).length;
      const unmatched = total - matched;
      const matchRate = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;

      const source = 'espn' as const;
      const type = 'redraft' as const;
      const existing = findDuplicateImport(source, type);
      const replaced = !!existing;

      const importData: StoredRankingImport = {
        id: replaced ? existing!.id : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        source,
        type,
        importDate: new Date().toISOString(),
        rankings,
        stats: { total, matched, unmatched, matchRate },
      };

      saveImport(importData);
      onImportComplete(importData);

      const unmatchedNames = rankings
        .filter((r) => !r.matched)
        .slice(0, 10)
        .map((r) => `${r.playerName} (${r.position})`);

      const sourceName = SOURCE_LABELS[source];
      const replaceNote = replaced ? ` (replaced previous ${sourceName} ${type} import)` : '';
      setResult({
        success: true,
        message: `Imported ${total} players from ${sourceName}. ${matched} matched, ${unmatched} unmatched.${replaceNote}`,
        stats: { total, matched, unmatched, matchRate },
        unmatchedNames: unmatched > 0 ? unmatchedNames : undefined,
      });
    } catch (err: any) {
      setResult({ success: false, message: `Import error: ${err.message}` });
    } finally {
      setImporting(false);
    }
  }, [mflPlayers, onImportComplete]);

  return (
    <div className="bm-card ri-direct-card">
      <div className="bm-card__header">
        <span className="bm-card__name">ESPN</span>
        <div className="bm-card__badges">
          <span className="bm-card__badge ri-direct-card__badge">Easiest</span>
          <span className="bm-card__badge bm-card__badge--redraft">Redraft</span>
        </div>
      </div>
      <p className="bm-card__desc">
        PPR redraft rankings from ESPN Fantasy. One click — no bookmarklet needed.
      </p>
      <button
        type="button"
        className="ri-btn ri-btn--secondary ri-sleeper__btn"
        onClick={handleImport}
        disabled={importing}
      >
        {importing ? 'Importing...' : 'Import ESPN Redraft'}
      </button>

      {result && (
        <div className={`ri-import__result ${result.success ? 'ri-import__result--success' : 'ri-import__result--error'}`}>
          <p>{result.message}</p>
          {result.stats && (
            <div className="ri-import__stats">
              <span className="ri-import__stat">
                <strong>{result.stats.matched}</strong> matched
              </span>
              <span className="ri-import__stat">
                <strong>{result.stats.unmatched}</strong> unmatched
              </span>
              <span className="ri-import__stat">
                <strong>{result.stats.matchRate}%</strong> match rate
              </span>
            </div>
          )}
          {result.unmatchedNames && result.unmatchedNames.length > 0 && (
            <details className="ri-import__unmatched">
              <summary>Unmatched players ({result.stats?.unmatched})</summary>
              <ul>
                {result.unmatchedNames.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
                {(result.stats?.unmatched ?? 0) > 10 && (
                  <li>...and {(result.stats?.unmatched ?? 0) - 10} more</li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
