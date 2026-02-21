import { useState, useCallback } from 'react';
import { parseBookmarkletJson } from '../../../utils/bookmarklet-json-parser';
import { matchPlayerToMFL } from '../../../utils/rankings-importer';
import { saveImport, findDuplicateImport } from '../../../utils/rankings-storage';
import { SOURCE_LABELS } from '../../../utils/rankings-lookup';
import type {
  MFLPlayerForMatching,
  StoredRankingImport,
  StoredRankingEntry,
  BookmarkletOutput,
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

const SLEEPER_API_URL = 'https://api.sleeper.app/v1/players/nfl';
const VALID_POSITIONS: Record<string, number> = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1 };
const TOP_N = 500;

export default function SleeperDirectImport({ mflPlayers, onImportComplete }: Props) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleImport = useCallback(async () => {
    setImporting(true);
    setResult(null);

    try {
      const response = await fetch(SLEEPER_API_URL);
      if (!response.ok) {
        throw new Error(`Sleeper API returned ${response.status}`);
      }
      const data = await response.json();

      // Filter & sort — mirrors bookmarklet logic
      const entries = Object.values(data)
        .filter((p: any) => p.active && VALID_POSITIONS[p.position] && p.search_rank && p.search_rank < 9999)
        .sort((a: any, b: any) => (a.search_rank || 9999) - (b.search_rank || 9999))
        .slice(0, TOP_N);

      const players = (entries as any[]).map((p, idx) => ({
        rank: idx + 1,
        name: `${p.first_name} ${p.last_name}`.trim(),
        pos: p.position as string,
        team: (p.team || '') as string,
      }));

      const bookmarkletJson = JSON.stringify({
        source: 'sleeper',
        type: 'adp',
        exportedAt: new Date().toISOString(),
        players,
        metadata: { pageUrl: SLEEPER_API_URL },
      });

      // Parse through the same pipeline as bookmarklet imports
      const parsed = parseBookmarkletJson(bookmarkletJson);
      if (!parsed.success || !parsed.data) {
        setResult({ success: false, message: parsed.error || 'Parse failed.' });
        return;
      }

      const parsedData: BookmarkletOutput = parsed.data;
      const type = parsedData.type !== 'overall' && parsedData.type !== undefined
        ? parsedData.type
        : 'adp';

      const rankings: StoredRankingEntry[] = parsedData.players.map((p) => {
        const match = matchPlayerToMFL(
          p.name,
          p.pos,
          mflPlayers.map((m) => ({ id: m.id, name: m.name, position: m.position, team: m.team })),
        );
        return {
          rank: p.rank,
          playerId: match.playerId,
          playerName: p.name,
          position: p.pos,
          team: p.team || '',
          matched: match.matched,
          confidence: match.confidence,
          tier: p.tier,
        };
      });

      const total = rankings.length;
      const matched = rankings.filter((r) => r.matched).length;
      const unmatched = total - matched;
      const matchRate = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;

      const existing = findDuplicateImport(parsedData.source, type);
      const replaced = !!existing;

      const importData: StoredRankingImport = {
        id: replaced ? existing!.id : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        source: parsedData.source,
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

      const sourceName = SOURCE_LABELS[parsedData.source] || parsedData.source;
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
    <section className="ri-section ri-sleeper">
      <div className="ri-sleeper__header">
        <h2 className="ri-section__title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Sleeper ADP
          <span className="ri-sleeper__badge">Easiest</span>
        </h2>
      </div>
      <p className="ri-section__desc">
        Import top-500 player rankings by ADP directly from the Sleeper API. One click — no bookmarklet needed.
      </p>
      <button
        type="button"
        className="ri-btn ri-btn--secondary ri-sleeper__btn"
        onClick={handleImport}
        disabled={importing}
      >
        {importing ? 'Importing from Sleeper...' : 'Import Sleeper ADP'}
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
    </section>
  );
}
