import { useState, useCallback, useEffect, useRef } from 'react';
import { parseBookmarkletJson } from '../../../utils/bookmarklet-json-parser';
import { matchPlayerToMFL } from '../../../utils/rankings-importer';
import { saveImport } from '../../../utils/rankings-storage';
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
  const handledTransferIdsRef = useRef<Set<string>>(new Set());
  const hashProcessedRef = useRef(false);

  const processImportText = useCallback((rawText: string, sourceLabel?: string) => {
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
        const type = (data.type !== 'overall' && data.type !== undefined) ? data.type : rankingType;

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

        const importData: StoredRankingImport = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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
        setResult({
          success: true,
          message: `Imported ${total} players from ${data.source}${sourceText}. ${matched} matched, ${unmatched} unmatched.`,
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

  const applyTransferEnvelope = useCallback((parsed: any) => {
    const payload = typeof parsed?.payload === 'string' ? parsed.payload : '';
    const source = typeof parsed?.source === 'string' ? parsed.source : 'bookmarklet';
    const transferId = typeof parsed?.id === 'string' ? parsed.id : '';

    if (!payload) {
      setResult({
        success: false,
        message: 'Received bookmarklet data, but payload was empty.',
      });
      return { ok: false, id: transferId };
    }

    if (transferId) {
      if (handledTransferIdsRef.current.has(transferId)) {
        return { ok: true, id: transferId };
      }
      handledTransferIdsRef.current.add(transferId);
    }

    setPasteText(payload);
    processImportText(payload, `${source} bookmarklet`);
    return { ok: true, id: transferId };
  }, [processImportText]);

  useEffect(() => {
    if (hashProcessedRef.current) return;

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : '';
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const encodedBm = params.get('bm');
    if (!encodedBm) return;

    // Mark as processed before doing anything else to prevent double-fire
    // (React strict mode or dependency-change re-runs).
    hashProcessedRef.current = true;

    // Clear hash immediately so refresh/navigation doesn't repeat import.
    try {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.hash = '';
      window.history.replaceState({}, document.title, cleanUrl.toString());
    } catch {
      // Non-fatal if history replacement fails.
    }

    try {
      const decoded = decodeURIComponent(escape(atob(encodedBm)));
      const parsed = JSON.parse(decoded);
      applyTransferEnvelope(parsed);
    } catch {
      setResult({
        success: false,
        message: 'Received bookmarklet hash data, but it could not be parsed.',
      });
    }
  }, [applyTransferEnvelope]);

  useEffect(() => {
    const prefix = 'mfl-rankings-import:';
    const transferData = window.name || '';
    if (!transferData.startsWith(prefix)) return;

    // Clear immediately so refresh/navigation doesn't duplicate imports.
    window.name = '';

    try {
      const decoded = decodeURIComponent(transferData.slice(prefix.length));
      const parsed = JSON.parse(decoded);
      applyTransferEnvelope(parsed);
    } catch {
      setResult({
        success: false,
        message: 'Received bookmarklet transfer data, but it could not be parsed.',
      });
    }
  }, [applyTransferEnvelope]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Only accept opener-originated messages for bookmarklet transfers.
      if (window.opener && event.source !== window.opener) return;

      if (data.type === 'mfl-rankings-import-probe') {
        try {
          (event.source as Window | null)?.postMessage(
            { type: 'mfl-rankings-import-ready' },
            event.origin || '*',
          );
        } catch {
          // Ignore postMessage failures.
        }
        return;
      }

      if (data.type !== 'mfl-rankings-import-payload') return;

      const envelope = (data as any).envelope;
      const transferResult = applyTransferEnvelope(envelope);

      try {
        (event.source as Window | null)?.postMessage(
          {
            type: 'mfl-rankings-import-ack',
            id: transferResult.id || null,
            ok: transferResult.ok,
          },
          event.origin || '*',
        );
      } catch {
        // Ignore postMessage failures.
      }
    };

    window.addEventListener('message', handleMessage);

    // Proactively notify opener that this page is ready to receive payloads.
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'mfl-rankings-import-ready' }, '*');
      }
    } catch {
      // Ignore postMessage failures.
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [applyTransferEnvelope]);

  return (
    <section className="ri-section">
      <h2 className="ri-section__title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        Import Rankings
      </h2>
      <p className="ri-section__desc">
        After running a bookmarklet, paste the copied data here.
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
