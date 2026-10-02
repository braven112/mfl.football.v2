/**
 * One player's scoring, stat by stat — a bottom sheet on a phone, a centred
 * dialog from 640px up. Opened by tapping a row in the matchup detail.
 *
 * ── EVERY LEAGUE ON THE BOARD, NOT ONLY OURS ──────────────────────────────
 * This kit renders TheLeague, the AFL, Best Ball and every league an owner
 * switches on in MFL Live, so the rules are fetched per LEAGUE ID
 * (`/api/live-scoring-rules`), and the stat counts it scores are
 * league-neutral (`PlayerBoxScore.stats`). The cache below is keyed by league
 * AND year — every registry league has a franchise `0001`, and nothing about a
 * player id says which league's rules apply.
 *
 * ── MFL'S NUMBER IS THE TOTAL ─────────────────────────────────────────────
 * The bottom line is the row's own live score, never this sheet's sum. What the
 * box score cannot itemize (first downs, 20-yard plays, a stat ESPN has not
 * caught up on) rides one "Not itemized" line so the sheet always adds up to
 * the number the owner tapped. See `scorePlayerStats`.
 *
 * ── THE ROW IS RE-READ EVERY POLL ─────────────────────────────────────────
 * The caller resolves `row`/`box` from the CURRENT board each render, so a
 * sheet left open on a Sunday keeps moving with the score behind it — the same
 * reason `LiveBoard` stores the open matchup as an identity, not an object.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { LivePlayerRow, PlayerBoxScore, PlayerMeta } from '../../../types/live-scoring';
import {
  scorePlayerStats,
  type LiveScoringRulesResponse,
} from '../../../utils/live/scoring-rules';
import { positionLabel } from '../../../utils/mfl-live-lineup';

const fmt = (n: number) => n.toFixed(2);
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

/**
 * One request per (league, year) per page life. A FAILED read is dropped from
 * the cache so the next open retries — never pin a failure.
 */
const rulesCache = new Map<string, Promise<LiveScoringRulesResponse>>();

function loadRules(leagueId: string, year: number): Promise<LiveScoringRulesResponse> {
  const key = `${leagueId}:${year}`;
  let hit = rulesCache.get(key);
  if (!hit) {
    const failed: LiveScoringRulesResponse = { ok: false, leagueId, year: String(year), rules: null };
    hit = fetch(
      `/api/live-scoring-rules?L=${encodeURIComponent(leagueId)}&year=${encodeURIComponent(String(year))}`,
      { headers: { Accept: 'application/json' } },
    )
      .then((res) => res.json())
      // `res.ok` is not "the data is good" — gate on the flag.
      .then((data: LiveScoringRulesResponse) => (data && data.ok === true ? data : failed))
      .catch(() => failed)
      .then((data) => {
        if (!data.ok) rulesCache.delete(key);
        return data;
      });
    rulesCache.set(key, hit);
  }
  return hit;
}

type RulesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; rules: LiveScoringRulesResponse['rules'] };

export interface LvStatSheetProps {
  row: LivePlayerRow;
  meta?: PlayerMeta;
  box?: PlayerBoxScore;
  detailStatus?: 'ok' | 'error' | 'pending';
  /** The MFL league whose rules score this row. */
  leagueId: string;
  year: number;
  /** Franchise that rostered him in this matchup — named in the header. */
  franchiseName?: string;
  onClose: () => void;
}

export default function LvStatSheet({
  row,
  meta,
  box,
  detailStatus = 'ok',
  leagueId,
  year,
  franchiseName,
  onClose,
}: LvStatSheetProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [rules, setRules] = useState<RulesState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setRules({ status: 'loading' });
    loadRules(leagueId, year).then((data) => {
      if (cancelled) return;
      setRules(data.ok ? { status: 'ok', rules: data.rules } : { status: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [leagueId, year]);

  const close = useCallback(() => {
    onClose();
    previousFocus.current?.focus();
  }, [onClose]);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
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
    // Mount/unmount only — `close` changes identity with the parent's render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === 'undefined') return null;

  const position = meta?.position ?? '';
  const isDef = position.toUpperCase() === 'DEF';
  const name = meta?.name ?? `Player ${row.id}`;
  const team = isDef ? '' : (meta?.nflTeam ?? '');
  const stats = box?.stats;

  const sheet =
    rules.status === 'ok' || rules.status === 'error'
      ? scorePlayerStats({
          rules: rules.status === 'ok' ? rules.rules : null,
          position,
          stats: stats ?? {},
          fgLengths: box?.fgLengths,
          total: row.live,
        })
      : null;

  /**
   * Why there are no lines, when there are none. Each is a different fact and
   * says so: "no stats yet" must never be how an ESPN outage reads.
   */
  let empty = '';
  if (isDef) {
    empty =
      "Team defense scoring isn't broken down here — ESPN's box score has no line for a defense.";
  } else if (detailStatus === 'error') {
    empty = "Couldn't load stats from ESPN right now. The total is MFL's.";
  } else if (detailStatus === 'pending') {
    empty = 'Loading stats…';
  } else if (!stats || Object.keys(stats).length === 0) {
    empty = 'No stats yet.';
  }

  const showPoints = rules.status !== 'error' && !(rules.status === 'ok' && rules.rules === null);
  const lines = empty ? [] : (sheet?.lines ?? []);

  let note = '';
  if (!empty && rules.status === 'error') {
    note = "Couldn't load this league's scoring rules, so points per stat aren't shown.";
  } else if (!empty && rules.status === 'ok' && rules.rules === null) {
    note = "This league doesn't publish its scoring rules, so points per stat aren't shown.";
  }

  const titleId = `lv-sheet-title-${row.id}`;

  return createPortal(
    <div
      className="lv-sheet"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="lv-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="lv-sheet__header">
          <div className="lv-sheet__who">
            <h2 className="lv-sheet__title" id={titleId}>
              {name}
            </h2>
            <p className="lv-sheet__sub">
              {[positionLabel(position) || position, team, franchiseName].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="lv-sheet__total" aria-label={`${fmt(row.live)} points`}>
            {row.live.toFixed(1)}
            <span className="lv-sheet__pts">pts</span>
          </div>
          <button type="button" className="lv-sheet__close" onClick={close} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="lv-sheet__body">
          {empty ? (
            <p className="lv-sheet__empty">{empty}</p>
          ) : (
            <table className="lv-sheet__table">
              <thead>
                <tr>
                  <th scope="col">Stat</th>
                  <th scope="col" className="lv-sheet__num">
                    Value
                  </th>
                  {showPoints && (
                    <th scope="col" className="lv-sheet__num">
                      Pts
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.event}>
                    <th scope="row">{l.label}</th>
                    <td className="lv-sheet__num">{l.value}</td>
                    {showPoints && (
                      <td
                        className={`lv-sheet__num lv-sheet__pt${
                          (l.points ?? 0) < 0 ? ' lv-sheet__pt--neg' : ''
                        }`}
                      >
                        {rules.status === 'loading' ? '…' : signed(l.points ?? 0)}
                      </td>
                    )}
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={showPoints ? 3 : 2} className="lv-sheet__none">
                      No scoring stats yet.
                    </td>
                  </tr>
                )}
                {showPoints && sheet && sheet.unitemized !== 0 && (
                  <tr className="lv-sheet__other">
                    <th scope="row" colSpan={2}>
                      Not itemized
                      <span className="lv-sheet__hint">
                        Scoring the box score doesn't break out, or a stat still updating
                      </span>
                    </th>
                    <td className="lv-sheet__num lv-sheet__pt">{signed(sheet.unitemized)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={showPoints ? 2 : 1}>
                    Total
                  </th>
                  <td className="lv-sheet__num">{fmt(row.live)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {note && <p className="lv-sheet__note">{note}</p>}
          {box?.statLine && !empty && <p className="lv-sheet__line">{box.statLine}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
