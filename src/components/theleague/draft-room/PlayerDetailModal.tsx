import React, { useEffect, useRef, useCallback } from 'react';
import type { DraftRoomPlayer, DraftRoomPick } from '../../../types/draft-room';
import { POSITION_COLORS } from '../../../types/draft-room';
import { calculateDraftPickSalary } from '../../../utils/draft-pick-cap-impact';

interface PlayerDetailModalProps {
  player: DraftRoomPlayer | null;
  /** The current pick slot (if any) — used to preview Y1 salary. */
  currentPick: DraftRoomPick | null;
  isQueued: boolean;
  isUserTurn: boolean;
  /** When set (live drafts), the Draft button becomes an MFL deep-link. */
  mflPickUrl?: string;
  onClose: () => void;
  onAddToQueue: (playerId: string) => void;
  onDraft: (playerId: string) => void;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function computeSalaryCurve(base: number, years = 5): number[] {
  // 10% annual escalation
  return Array.from({ length: years }, (_, i) => Math.round(base * Math.pow(1.1, i)));
}

function computeAdpDelta(player: DraftRoomPlayer, currentOverallPick: number | undefined): {
  text: string;
  kind: 'reach' | 'steal' | 'par';
} | null {
  if (!player.adpAveragePick || !currentOverallPick) return null;
  const delta = player.adpAveragePick - currentOverallPick;
  if (Math.abs(delta) < 0.5) return { text: 'at ADP', kind: 'par' };
  if (delta > 0) return { text: `+${delta.toFixed(1)} vs ADP`, kind: 'steal' };
  return { text: `${delta.toFixed(1)} vs ADP`, kind: 'reach' };
}

export function PlayerDetailModal({
  player,
  currentPick,
  isQueued,
  isUserTurn,
  mflPickUrl,
  onClose,
  onAddToQueue,
  onDraft,
}: PlayerDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Close on Escape; save/restore focus
  useEffect(() => {
    if (!player) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    modalRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocusRef.current?.focus();
    };
  }, [player, onClose]);

  const onBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!player) return null;

  const posColor = POSITION_COLORS[player.position] || POSITION_COLORS.DEF;
  const adpDelta = computeAdpDelta(player, currentPick?.overallPickNumber);

  // Y1 slot salary preview (only meaningful for rookies at current pick)
  const y1Salary = currentPick && player.isRookie
    ? calculateDraftPickSalary(currentPick.round, currentPick.overallPickNumber, player.position)
    : null;
  const salaryCurve = y1Salary ? computeSalaryCurve(y1Salary) : null;

  return (
    <div className="dr-modal-overlay" onClick={onBackdrop} role="presentation">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dr-modal-title"
        tabIndex={-1}
        className="dr-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: hero strip */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '1rem',
            borderBottom: `3px solid ${posColor}`,
            background: 'var(--color-gray-50, #f9fafb)',
            flexShrink: 0,
          }}
        >
          <img
            src={player.headshot}
            alt=""
            loading="lazy"
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              objectFit: 'cover',
              objectPosition: 'top',
              flexShrink: 0,
              background: 'var(--color-gray-100, #f3f4f6)',
              border: `2px solid ${posColor}`,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              id="dr-modal-title"
              style={{
                margin: 0,
                fontSize: '1.125rem',
                fontWeight: 800,
                color: 'var(--color-gray-900, #111827)',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {player.name}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: posColor }}>{player.position}</span>
              {player.nflTeam && <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500, #6b7280)' }}>· {player.nflTeam}</span>}
              {player.college && <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500, #6b7280)' }}>· {player.college}</span>}
              {player.age !== undefined && <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500, #6b7280)' }}>· Age {player.age}</span>}
              {player.rspTier && (
                <span className="dr-tier-badge" data-tier={player.rspTier} aria-label={`RSP Tier ${player.rspTier}`}>
                  Tier {player.rspTier}
                </span>
              )}
              {player.isRookie && (
                <span
                  style={{
                    fontSize: '0.5625rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--color-primary, #1c497c)',
                    background: 'rgba(28, 73, 124, 0.1)',
                    padding: '0.125rem 0.375rem',
                    borderRadius: 'var(--radius-sm, 0.25rem)',
                  }}
                >
                  Rookie
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close player detail"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              width: 32,
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-md, 0.5rem)',
              cursor: 'pointer',
              color: 'var(--color-gray-500, #6b7280)',
              fontSize: '1.25rem',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </header>

        {/* Metrics strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--content-border, #e2e8f0)',
            flexShrink: 0,
          }}
        >
          <MetricCell
            label="RSP Rank"
            value={player.rspPositionRank || '—'}
            sublabel={player.rspGrade}
          />
          <MetricCell
            label="ADP"
            value={player.adpAveragePick ? player.adpAveragePick.toFixed(1) : '—'}
            sublabel={player.adpRank ? `#${player.adpRank}` : undefined}
          />
          <MetricCell
            label="vs ADP"
            value={adpDelta?.text || '—'}
            sublabel={adpDelta?.kind ? '' : undefined}
            valueColor={
              adpDelta?.kind === 'steal'
                ? 'var(--dr-adp-value-steal)'
                : adpDelta?.kind === 'reach'
                  ? 'var(--dr-adp-value-reach)'
                  : undefined
            }
          />
          {y1Salary && (
            <MetricCell
              label="Y1 Salary"
              value={formatCurrency(y1Salary)}
              sublabel={currentPick ? `Pick ${currentPick.round}.${String(currentPick.pickInRound).padStart(2, '0')}` : undefined}
            />
          )}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
          {/* Fantasy advice */}
          {player.rspFantasyAdvice && (
            <Section title="Fantasy Advice">
              <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.55, color: 'var(--color-gray-800, #1f2937)' }}>
                {player.rspFantasyAdvice}
              </p>
            </Section>
          )}

          {/* Scouting notes */}
          {player.rspNotes && (
            <Section title="Scouting Report">
              <p style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.55, color: 'var(--color-gray-700, #374151)', whiteSpace: 'pre-wrap' }}>
                {player.rspNotes}
              </p>
            </Section>
          )}

          {/* Comparison + type symbols */}
          {(player.rspComparison || player.rspTypes?.length) && (
            <Section title="Profile">
              {player.rspComparison && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-gray-500, #6b7280)', letterSpacing: '0.06em' }}>
                    Comparison
                  </span>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-800, #1f2937)' }}>
                    {player.rspComparison}
                  </div>
                </div>
              )}
              {player.rspTypes && player.rspTypes.length > 0 && (
                <div>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-gray-500, #6b7280)', letterSpacing: '0.06em' }}>
                    Types
                  </span>
                  <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                    {player.rspTypes.map((t) => (
                      <span
                        key={t}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0.125rem 0.375rem',
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          background: 'var(--color-gray-100, #f3f4f6)',
                          color: 'var(--color-gray-700, #374151)',
                          borderRadius: 'var(--radius-sm, 0.25rem)',
                        }}
                        title={t}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Y1-Y5 salary curve */}
          {salaryCurve && (
            <Section title="Contract Projection (10% annual escalation)">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '0.25rem',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {salaryCurve.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0.5rem 0.25rem',
                      background: i === 0 ? 'rgba(28, 73, 124, 0.08)' : 'var(--color-gray-50, #f9fafb)',
                      border: i === 0 ? '1px solid var(--color-primary, #1c497c)' : '1px solid var(--content-border, #e2e8f0)',
                      borderRadius: 'var(--radius-sm, 0.25rem)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-gray-500, #6b7280)' }}>
                      Y{i + 1}
                    </div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-gray-900, #111827)', marginTop: '0.125rem' }}>
                      {formatCurrency(s)}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Fallback when no RSP data */}
          {!player.rspNotes && !player.rspFantasyAdvice && !player.rspComparison && (
            <div
              style={{
                padding: '1.5rem',
                textAlign: 'center',
                color: 'var(--color-gray-400, #9ca3af)',
                fontSize: '0.8125rem',
                background: 'var(--color-gray-50, #f9fafb)',
                borderRadius: 'var(--radius-md, 0.5rem)',
              }}
            >
              No scouting report available for this player.
            </div>
          )}
        </div>

        {/* Sticky action footer */}
        <footer
          style={{
            display: 'flex',
            gap: '0.5rem',
            padding: '0.75rem 1rem',
            borderTop: '1px solid var(--content-border, #e2e8f0)',
            background: 'var(--color-gray-50, #f9fafb)',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => !isQueued && onAddToQueue(player.id)}
            disabled={isQueued}
            style={{
              flex: 1,
              padding: '0.625rem 0.75rem',
              fontSize: '0.8125rem',
              fontWeight: 700,
              border: `1.5px solid ${isQueued ? 'var(--color-primary, #1c497c)' : 'var(--content-border, #e2e8f0)'}`,
              borderRadius: 'var(--radius-md, 0.5rem)',
              background: isQueued ? 'rgba(28, 73, 124, 0.08)' : 'var(--content-bg, #ffffff)',
              color: isQueued ? 'var(--color-primary, #1c497c)' : 'var(--color-gray-700, #374151)',
              cursor: isQueued ? 'default' : 'pointer',
            }}
          >
            {isQueued ? '✓ In Queue' : '+ Add to Queue'}
          </button>
          {isUserTurn && mflPickUrl ? (
            <a
              href={mflPickUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1,
                padding: '0.625rem 0.75rem',
                fontSize: '0.8125rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                border: 'none',
                borderRadius: 'var(--radius-md, 0.5rem)',
                background: 'var(--color-success, #16a34a)',
                color: '#ffffff',
                cursor: 'pointer',
                textAlign: 'center',
                textDecoration: 'none',
                boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)',
              }}
            >
              Pick on MFL ↗
            </a>
          ) : isUserTurn ? (
            <button
              type="button"
              onClick={() => onDraft(player.id)}
              style={{
                flex: 1,
                padding: '0.625rem 0.75rem',
                fontSize: '0.8125rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                border: 'none',
                borderRadius: 'var(--radius-md, 0.5rem)',
                background: 'var(--color-success, #16a34a)',
                color: '#ffffff',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)',
              }}
            >
              Draft {player.name.split(' ')[0]}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function MetricCell({
  label,
  value,
  sublabel,
  valueColor,
}: {
  label: string;
  value: string;
  sublabel?: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        padding: '0.5rem',
        background: 'var(--color-gray-50, #f9fafb)',
        borderRadius: 'var(--radius-md, 0.5rem)',
        border: '1px solid var(--content-border, #e2e8f0)',
      }}
    >
      <div
        style={{
          fontSize: '0.5625rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-gray-500, #6b7280)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '0.9375rem',
          fontWeight: 700,
          color: valueColor || 'var(--color-gray-900, #111827)',
          lineHeight: 1.2,
          marginTop: '0.125rem',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {sublabel && (
        <div style={{ fontSize: '0.625rem', color: 'var(--color-gray-500, #6b7280)', marginTop: '0.0625rem' }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '1rem' }}>
      <h3
        style={{
          margin: '0 0 0.375rem',
          fontSize: '0.6875rem',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--color-gray-500, #6b7280)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}
