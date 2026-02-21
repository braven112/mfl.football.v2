import { useState, useCallback } from 'react';
import { parseBookmarkletJson } from '../../../utils/bookmarklet-json-parser';
import { matchPlayerToMFL } from '../../../utils/rankings-importer';
import { saveImport, findDuplicateImport } from '../../../utils/rankings-storage';
import { SOURCE_LABELS } from '../../../utils/rankings-lookup';
import { useBookmarkletTransfer } from '../../../hooks/useBookmarkletTransfer';
import type {
  MFLPlayerForMatching,
  StoredRankingImport,
  StoredRankingEntry,
  BookmarkletOutput,
  RankingType,
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

export default function ImportSection({ mflPlayers, onImportComplete }: Props) {
  const [pasteText, setPasteText] = useState('');
  const [rankingType, setRankingType] = useState<RankingType>('dynasty');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const processImportText = useCallback((rawText: string, typeOverride?: RankingType, sourceLabel?: string) => {
    if (!rawText.trim()) {
      setResult({ success: false, message: 'Paste ranking data first.' });
      return;
    }

    setImporting(true);
    setResult(null);

    // Use setTimeout to allow UI to update before heavy processing
    setTimeout(() => {
      try {
        const parsed = parseBookmarkletJson(rawText);
        if (!parsed.success || !parsed.data) {
          setResult({ success: false, message: parsed.error || 'Parse failed.' });
          setImporting(false);
          return;
        }

        const data: BookmarkletOutput = parsed.data;
        const type = (data.type !== 'overall' && data.type !== undefined)
          ? data.type
          : (typeOverride ?? rankingType);

        // Match players to MFL database
        const rankings: StoredRankingEntry[] = data.players.map((p) => {
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

        // Check if this replaces an existing import of the same source+type
        const existing = findDuplicateImport(data.source, type);
        const replaced = !!existing;

        const importData: StoredRankingImport = {
          id: replaced ? existing!.id : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          source: data.source,
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

        const sourceText = sourceLabel ? ` via ${sourceLabel}` : '';
        const sourceName = SOURCE_LABELS[data.source] || data.source;
        const replaceNote = replaced ? ` (replaced previous ${sourceName} ${type} import)` : '';
        setResult({
          success: true,
          message: `Imported ${total} players from ${sourceName}${sourceText}. ${matched} matched, ${unmatched} unmatched.${replaceNote}`,
          stats: { total, matched, unmatched, matchRate },
          unmatchedNames: unmatched > 0 ? unmatchedNames : undefined,
        });

        setPasteText('');
      } catch (err: any) {
        setResult({ success: false, message: `Import error: ${err.message}` });
      } finally {
        setImporting(false);
      }
    }, 50);
  }, [rankingType, mflPlayers, onImportComplete]);

  // Listen for bookmarklet transfers (hash, window.name, postMessage)
  useBookmarkletTransfer(useCallback((payload: string, sourceLabel: string) => {
    processImportText(payload, undefined, sourceLabel);
  }, [processImportText]));

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPasteText(text);
        setResult(null);
      } else {
        setResult({ success: false, message: 'Clipboard is empty.' });
      }
    } catch {
      setResult({
        success: false,
        message: 'Could not read clipboard. Please paste manually into the text area below.',
      });
    }
  }, []);

  const handleImport = useCallback(() => {
    processImportText(pasteText);
  }, [pasteText, processImportText]);

  return (
    <>
      {/* Result display lives outside the accordion so it's always visible after
          a bookmarklet auto-import even when the manual section is collapsed */}
      {importing && (
        <p className="ri-import__status">Importing...</p>
      )}

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

      <details className="ri-section ri-import__manual">
        <summary className="ri-import__manual-summary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Manual Import
        </summary>
        <div className="ri-import__manual-content">
          <p className="ri-section__desc">
            If auto-import didn't work, paste the bookmarklet JSON output here.
          </p>

          <div className="ri-import__controls">
            <button
              type="button"
              className="ri-btn ri-btn--primary"
              onClick={handlePasteFromClipboard}
            >
              Paste from Clipboard
            </button>

            <label className="ri-import__type-label">
              Ranking type:
              <select
                value={rankingType}
                onChange={(e) => setRankingType(e.target.value as RankingType)}
                className="ri-import__type-select"
              >
                <option value="dynasty">Dynasty</option>
                <option value="redraft">Redraft</option>
                <option value="adp">ADP</option>
              </select>
            </label>
          </div>

          <textarea
            className="ri-import__textarea"
            placeholder='Paste bookmarklet output here (JSON)...'
            value={pasteText}
            onChange={(e) => { setPasteText(e.target.value); setResult(null); }}
            rows={6}
          />

          <button
            type="button"
            className="ri-btn ri-btn--primary"
            onClick={handleImport}
            disabled={importing || !pasteText.trim()}
          >
            {importing ? 'Importing...' : 'Import Rankings'}
          </button>
        </div>
      </details>
    </>
  );
}
