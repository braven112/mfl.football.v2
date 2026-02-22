import { useState, useCallback } from 'react';
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

const FANTASY_CALC_API_URL = 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1';
const VALID_POSITIONS: Record<string, number> = { QB: 1, RB: 1, WR: 1, TE: 1 };

export default function FantasyCalcDirectImport({ mflPlayers, onImportComplete }: Props) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = useCallback(async () => {
    setImporting(true);
    setResult(null);

    try {
      const response = await fetch(FANTASY_CALC_API_URL);
      if (!response.ok) {
        throw new Error(`FantasyCalc API returned ${response.status}`);
      }
      const data: any[] = await response.json();

      // Build MFL player lookup by ID for direct matching
      const mflById = new Map(mflPlayers.map((p) => [p.id, p]));

      // Filter to valid fantasy positions and map to rankings
      const filtered = data.filter(
        (entry) => entry.player?.position && VALID_POSITIONS[entry.player.position],
      );

      const rankings: StoredRankingEntry[] = filtered.map((entry) => {
        const player = entry.player;
        const mflId = player.mflId || null;
        const mflPlayer = mflId ? mflById.get(mflId) : null;

        return {
          rank: entry.overallRank,
          playerId: mflPlayer ? mflId : null,
          playerName: player.name || '',
          position: player.position || '',
          team: player.maybeTeam || '',
          matched: !!mflPlayer,
          confidence: mflPlayer ? 1 : 0,
          tier: entry.maybeTier,
        };
      });

      const total = rankings.length;
      const matched = rankings.filter((r) => r.matched).length;
      const unmatched = total - matched;
      const matchRate = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;

      const source = 'fantasycalc' as const;
      const type = 'dynasty' as const;
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
        <span className="bm-card__name">FantasyCalc</span>
        <div className="bm-card__badges">
          <span className="bm-card__badge ri-direct-card__badge">Easiest</span>
          <span className="bm-card__badge bm-card__badge--dynasty">Dynasty</span>
        </div>
      </div>
      <p className="bm-card__desc">
        Dynasty trade values from nearly 1 million real fantasy trades. One click — no bookmarklet needed.
      </p>
      <button
        type="button"
        className="ri-btn ri-btn--secondary ri-sleeper__btn"
        onClick={handleImport}
        disabled={importing}
      >
        {importing ? 'Importing...' : 'Import FantasyCalc Dynasty'}
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
