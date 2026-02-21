/**
 * useBookmarkletTransfer
 *
 * React hook that listens for incoming bookmarklet data via three transfer
 * mechanisms:
 *   1. URL hash (#bm=...) — bookmarklet opens the import page with encoded data
 *   2. window.name prefix — fallback for popup blockers
 *   3. postMessage — cross-origin message from opener window
 *
 * Deduplicates transfers by ID to prevent double-processing from React
 * strict mode or dependency re-runs.
 *
 * @param onPayload - Called with the decoded payload string and source label
 *                    when a valid transfer is received.
 */

import { useEffect, useRef, useCallback } from 'react';

interface TransferEnvelope {
  id?: string;
  source?: string;
  payload?: string;
  version?: number;
  playerCount?: number;
  pageUrl?: string;
  transferredAt?: string;
}

interface TransferResult {
  ok: boolean;
  id: string;
}

export function useBookmarkletTransfer(
  onPayload: (payload: string, sourceLabel: string) => void,
) {
  const handledIdsRef = useRef<Set<string>>(new Set());
  const hashProcessedRef = useRef(false);

  const applyEnvelope = useCallback(
    (parsed: TransferEnvelope): TransferResult => {
      const payload = typeof parsed?.payload === 'string' ? parsed.payload : '';
      const source = typeof parsed?.source === 'string' ? parsed.source : 'bookmarklet';
      const transferId = typeof parsed?.id === 'string' ? parsed.id : '';

      if (!payload) {
        return { ok: false, id: transferId };
      }

      // Deduplicate by transfer ID
      if (transferId) {
        if (handledIdsRef.current.has(transferId)) {
          return { ok: true, id: transferId };
        }
        handledIdsRef.current.add(transferId);
      }

      onPayload(payload, `${source} bookmarklet`);
      return { ok: true, id: transferId };
    },
    [onPayload],
  );

  // ---- Transfer 1: URL hash (#bm=...) ----
  useEffect(() => {
    if (hashProcessedRef.current) return;

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : '';
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const encodedBm = params.get('bm');
    if (!encodedBm) return;

    hashProcessedRef.current = true;

    // Clear hash to prevent re-import on refresh
    try {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.hash = '';
      window.history.replaceState({}, document.title, cleanUrl.toString());
    } catch {
      // Non-fatal
    }

    try {
      const decoded = decodeURIComponent(escape(atob(encodedBm)));
      const parsed = JSON.parse(decoded);
      applyEnvelope(parsed);
    } catch {
      // Hash data could not be parsed — silently ignore
    }
  }, [applyEnvelope]);

  // ---- Transfer 2: window.name prefix ----
  useEffect(() => {
    const prefix = 'mfl-rankings-import:';
    const transferData = window.name || '';
    if (!transferData.startsWith(prefix)) return;

    window.name = '';

    try {
      const decoded = decodeURIComponent(transferData.slice(prefix.length));
      const parsed = JSON.parse(decoded);
      applyEnvelope(parsed);
    } catch {
      // Transfer data could not be parsed — silently ignore
    }
  }, [applyEnvelope]);

  // ---- Transfer 3: postMessage from opener ----
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // Only accept opener-originated messages for bookmarklet transfers
      if (window.opener && event.source !== window.opener) return;

      if (data.type === 'mfl-rankings-import-probe') {
        try {
          (event.source as Window | null)?.postMessage(
            { type: 'mfl-rankings-import-ready' },
            event.origin || '*',
          );
        } catch {
          // Ignore postMessage failures
        }
        return;
      }

      if (data.type !== 'mfl-rankings-import-payload') return;

      const envelope = (data as any).envelope;
      const result = applyEnvelope(envelope);

      try {
        (event.source as Window | null)?.postMessage(
          {
            type: 'mfl-rankings-import-ack',
            id: result.id || null,
            ok: result.ok,
          },
          event.origin || '*',
        );
      } catch {
        // Ignore postMessage failures
      }
    };

    window.addEventListener('message', handleMessage);

    // Notify opener that this page is ready
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'mfl-rankings-import-ready' }, '*');
      }
    } catch {
      // Ignore postMessage failures
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [applyEnvelope]);
}
