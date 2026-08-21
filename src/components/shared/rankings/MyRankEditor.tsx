/**
 * My Rank editor — tune the composite from wherever you're using it.
 *
 * The composite is the number owners actually read on the Free Agents and
 * Rosters tables, but re-weighting it meant leaving the page for Import
 * Rankings and coming back. This is the same two controls (in / out, and the
 * percentage) in a modal, so an owner can argue with the board while looking
 * at it.
 *
 * Deliberately NOT a second implementation of the weighting rules — every
 * write goes through `toggleCompositeImport` / `setCompositeWeight`, which own
 * the rebalance-to-100 behavior and fire `rankingsUpdated`. The host page's
 * existing subscription re-renders its columns; this component tells nobody
 * anything directly.
 *
 * Anything structural — adding an import, hiding a built-in, reordering the
 * columns — still lives on Import Rankings, which this links to.
 *
 * Mount once per page with `client:idle`; open it by dispatching
 * `rankings:open-my-rank-editor` on `document`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAllImports,
  getCompositeMembers,
  setCompositeWeight,
  toggleCompositeImport,
} from '../../../utils/rankings-storage';
import { formatFullName, onRankingsChanged } from '../../../utils/rankings-lookup';
import type { CompositeImportConfig, StoredRankingImport } from '../../../types/rankings-import';

export const OPEN_EVENT = 'rankings:open-my-rank-editor';

interface Props {
  /** Import Rankings path for this league, e.g. `/afl-fantasy/import-rankings`. */
  importPath: string;
}

export default function MyRankEditor({ importPath }: Props) {
  const [open, setOpen] = useState(false);
  const [imports, setImports] = useState<StoredRankingImport[]>([]);
  const [members, setMembers] = useState<Map<string, CompositeImportConfig>>(new Map());
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  /**
   * Re-read everything from storage after any change.
   *
   * Never patch a single row optimistically: ticking or re-weighting one source
   * rebalances every other member so the total stays 100, so the row you
   * touched is never the only one that moved.
   */
  const refresh = useCallback(() => {
    setImports(getAllImports());
    setMembers(new Map(getCompositeMembers().map((m) => [m.importId, m])));
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      // Tell the trigger somebody answered — it retries until one of us does,
      // so a click landing before this island mounts still opens the modal.
      const detail = (e as CustomEvent<{ handled?: boolean }>).detail;
      if (detail) detail.handled = true;
      previousFocus.current = document.activeElement as HTMLElement;
      refresh();
      setOpen(true);
    };
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, [refresh]);

  // Stay in step with a board that changes underneath us — another tab, or the
  // built-in sources landing while the modal is open.
  useEffect(() => {
    if (!open) return;
    return onRankingsChanged(refresh);
  }, [open, refresh]);

  const close = useCallback(() => {
    setOpen(false);
    previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  if (!open) return null;

  const total = [...members.values()].reduce(
    (sum, m) => sum + (Number.isFinite(m.weight) ? m.weight : 0),
    0,
  );

  /**
   * What a source is really worth is weight/Σweight. Shown only when it differs
   * from the typed number — while the total is 100 the two agree, and a lone
   * ticked source reading "100%" next to its own "100" is just noise.
   */
  const effectiveShare = (importId: string): number | null => {
    const member = members.get(importId);
    if (!member || total <= 0) return null;
    const share = Math.round((member.weight / total) * 1000) / 10;
    return Math.abs(share - member.weight) < 0.5 ? null : share;
  };

  const activeCount = members.size;
  // Below two members there is no composite — buildRankingLookup() returns
  // null for the config, so the column disappears. Say so rather than letting
  // the owner untick their way into an empty table and wonder what broke.
  const compositeLive = activeCount >= 2;

  return (
    <div className="mre" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        className="mre__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mre-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="mre__header">
          <div>
            <h2 className="mre__title" id="mre-title">My Rank</h2>
            <p className="mre__subtitle">
              {compositeLive
                ? `Blending ${activeCount} sources. Weights always total 100%.`
                : 'Tick at least two sources to build a composite.'}
            </p>
          </div>
          <button type="button" className="mre__close" onClick={close} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {imports.length === 0 ? (
          <p className="mre__empty">
            No ranking sources loaded yet. Open Import Rankings to pick some up.
          </p>
        ) : (
          <ul className="mre__list">
            {imports.map((imp) => {
              const member = members.get(imp.id);
              const included = member != null;
              const share = effectiveShare(imp.id);
              return (
                <li className={`mre__row${included ? ' mre__row--on' : ''}`} key={imp.id}>
                  <label className="mre__pick">
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => {
                        toggleCompositeImport(imp.id, e.target.checked);
                        refresh();
                      }}
                      aria-label={`Include ${formatFullName(imp)} in My Rank`}
                    />
                    <span className="mre__source">
                      <span className="mre__source-name">{formatFullName(imp)}</span>
                      <span className="mre__source-meta">{imp.stats.total} players</span>
                    </span>
                  </label>

                  {included ? (
                    <span className="mre__weight">
                      <input
                        type="number"
                        className="mre__weight-input"
                        inputMode="numeric"
                        min={0}
                        max={100}
                        step={1}
                        value={member!.weight}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          if (!Number.isFinite(next)) return;
                          setCompositeWeight(imp.id, next);
                          refresh();
                        }}
                        aria-label={`Weight for ${formatFullName(imp)}, in percent`}
                      />
                      <span className="mre__weight-unit">%</span>
                      {share != null && (
                        <span className="mre__weight-effective" title="Actual share of My Rank">
                          ={share}%
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="mre__weight mre__weight--off" aria-hidden="true">—</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <footer className="mre__footer">
          <a className="mre__link" href={importPath}>Import Rankings &rarr;</a>
          <button type="button" className="mre__done" onClick={close}>Done</button>
        </footer>
      </div>
    </div>
  );
}
