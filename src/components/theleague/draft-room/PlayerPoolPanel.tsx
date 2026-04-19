import React, { useMemo, useState } from 'react';
import type { DraftRoomPlayer, DraftRoomPick, DraftQueueItem, DraftContext, RspTier } from '../../../types/draft-room';
import { POSITION_COLORS } from '../../../types/draft-room';
import { PlayerCell } from '../PlayerCell.tsx';
import { PlayerDetailModal } from './PlayerDetailModal';
import { calculateDraftPickSalary } from '../../../utils/draft-pick-cap-impact';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'PK', 'DEF'] as const;
const TIER_ORDER: RspTier[] = ['A', 'B', 'C', 'D', 'E', 'F'];

interface PlayerPoolPanelProps {
  players: DraftRoomPlayer[];
  picks: DraftRoomPick[];
  queue: DraftQueueItem[];
  searchQuery: string;
  positionFilter: string | null;
  onSearchChange: (query: string) => void;
  onPositionFilterChange: (pos: string | null) => void;
  onAddToQueue: (playerId: string) => void;
  rookiesOnly: boolean;
  onRookiesOnlyChange: (value: boolean) => void;
  draftContext: DraftContext;
  isUserTurn?: boolean;
  onSubmitPick?: (playerId: string) => void;
  currentPick?: DraftRoomPick | null;
}

function rankCompare(a: DraftRoomPlayer, b: DraftRoomPlayer): number {
  // Sort order: RSP tier (A first) → RSP score (desc) → ADP rank (asc)
  const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
  const at = a.rspTier ? tierOrder[a.rspTier] : 99;
  const bt = b.rspTier ? tierOrder[b.rspTier] : 99;
  if (at !== bt) return at - bt;
  const as = a.rspScore ?? 0;
  const bs = b.rspScore ?? 0;
  if (as !== bs) return bs - as;
  const ar = a.adpRank ?? 9999;
  const br = b.adpRank ?? 9999;
  return ar - br;
}

function computeAdpDelta(
  player: DraftRoomPlayer,
  currentOverallPick?: number
): { text: string; kind: 'reach' | 'steal' | 'par' } | null {
  if (!player.adpAveragePick || !currentOverallPick) return null;
  const delta = player.adpAveragePick - currentOverallPick;
  if (Math.abs(delta) < 1.5) return { text: 'ADP', kind: 'par' };
  if (delta > 0) return { text: `+${Math.round(delta)}`, kind: 'steal' };
  return { text: `${Math.round(delta)}`, kind: 'reach' };
}

export function PlayerPoolPanel({
  players,
  picks,
  queue,
  searchQuery,
  positionFilter,
  onSearchChange,
  onPositionFilterChange,
  onAddToQueue,
  rookiesOnly,
  onRookiesOnlyChange,
  draftContext,
  isUserTurn = false,
  onSubmitPick,
  currentPick = null,
}: PlayerPoolPanelProps) {
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);

  const draftedIds = useMemo(
    () => new Set(picks.filter((p) => p.playerId).map((p) => p.playerId)),
    [picks]
  );
  const queuedIds = useMemo(() => new Set(queue.map((i) => i.playerId)), [queue]);

  // Base available pool (post-drafted filter)
  const availablePool = useMemo(
    () => players.filter((p) => !draftedIds.has(p.id)),
    [players, draftedIds]
  );

  const rookieCount = useMemo(() => availablePool.filter((p) => p.isRookie).length, [availablePool]);

  // Per-position counts for the positional strip (from the current filter base)
  const positionCounts = useMemo(() => {
    let base = availablePool;
    if (rookiesOnly) base = base.filter((p) => p.isRookie);
    const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, PK: 0, DEF: 0 };
    for (const p of base) {
      if (counts[p.position] !== undefined) counts[p.position]++;
    }
    return counts;
  }, [availablePool, rookiesOnly]);

  // Filtered list for display
  const { filteredPlayers, totalMatches } = useMemo(() => {
    let list = availablePool;
    if (rookiesOnly) list = list.filter((p) => p.isRookie === true);
    if (positionFilter) list = list.filter((p) => p.position === positionFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.nflTeam.toLowerCase().includes(q) ||
          (p.college?.toLowerCase().includes(q) ?? false)
      );
    }
    const sorted = [...list].sort(rankCompare);
    return { filteredPlayers: sorted.slice(0, 100), totalMatches: sorted.length };
  }, [availablePool, rookiesOnly, positionFilter, searchQuery]);

  // Group by tier when we're showing rookies (since RSP data is rookie-focused)
  const groupedByTier = useMemo(() => {
    if (!rookiesOnly) return null;
    const groups = new Map<RspTier | 'UNTIERED', DraftRoomPlayer[]>();
    for (const p of filteredPlayers) {
      const key = (p.rspTier as RspTier) || 'UNTIERED';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return groups;
  }, [filteredPlayers, rookiesOnly]);

  const detailPlayer = detailPlayerId ? players.find((p) => p.id === detailPlayerId) || null : null;

  const renderRow = (player: DraftRoomPlayer) => {
    const isQueued = queuedIds.has(player.id);
    const adpDelta = computeAdpDelta(player, currentPick?.overallPickNumber);
    const slotSalary =
      isUserTurn && currentPick && player.isRookie
        ? calculateDraftPickSalary(currentPick.round, currentPick.overallPickNumber, player.position)
        : null;

    const meta = (
      <>
        {player.rspTier && (
          <span
            className="dr-tier-badge"
            data-tier={player.rspTier}
            aria-label={`RSP Tier ${player.rspTier}`}
            style={{ marginLeft: '0.25rem' }}
          >
            {player.rspTier}
          </span>
        )}
        {player.rspPositionRank && (
          <span
            style={{
              marginLeft: '0.25rem',
              fontSize: '0.5625rem',
              fontWeight: 700,
              color: 'var(--color-gray-500, #6b7280)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.02em',
            }}
            aria-label={`RSP rank ${player.rspPositionRank}`}
          >
            · {player.rspPositionRank}
          </span>
        )}
        {adpDelta && (
          <span
            className="dr-adp-delta"
            data-delta-kind={adpDelta.kind}
            style={{ marginLeft: '0.375rem' }}
            aria-label={`ADP delta ${adpDelta.text}`}
          >
            {adpDelta.text}
          </span>
        )}
        {slotSalary && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.5625rem',
              fontWeight: 700,
              color: 'var(--color-gray-600, #4b5563)',
              fontVariantNumeric: 'tabular-nums',
            }}
            aria-label={`Year 1 salary if drafted at this pick: ${slotSalary}`}
          >
            {slotSalary >= 1_000_000 ? `$${(slotSalary / 1_000_000).toFixed(1)}M` : `$${Math.round(slotSalary / 1000)}K`}
          </span>
        )}
      </>
    );

    return (
      <div
        key={player.id}
        className="dr-player-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.375rem 0.75rem',
          borderBottom: '1px solid var(--color-gray-50, #f9fafb)',
          gap: '0.5rem',
        }}
      >
        <button
          type="button"
          onClick={() => setDetailPlayerId(player.id)}
          aria-label={`View details for ${player.name}`}
          style={{
            flex: 1,
            minWidth: 0,
            padding: 0,
            border: 'none',
            background: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <PlayerCell
            name={player.name}
            headshot={player.headshot}
            position={player.position}
            nflTeam={player.nflTeam}
            mflId={player.mflId}
            espnId={player.espnId}
            size="compact"
            metaSlot={meta}
          />
        </button>
        {isUserTurn && onSubmitPick && (
          <button
            onClick={() => onSubmitPick(player.id)}
            aria-label={`Draft ${player.name}`}
            className="dr-draft-btn"
            style={{
              flexShrink: 0,
              padding: '0.25rem 0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: 'var(--radius-sm, 0.25rem)',
              background: 'var(--color-success, #16a34a)',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: '0.625rem',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              lineHeight: 1,
            }}
          >
            Draft
          </button>
        )}
        <button
          onClick={() => !isQueued && onAddToQueue(player.id)}
          aria-label={isQueued ? `${player.name} is in your queue` : `Add ${player.name} to queue`}
          disabled={isQueued}
          className="dr-add-queue-btn"
          style={{
            flexShrink: 0,
            width: '1.5rem',
            height: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid',
            borderColor: isQueued ? 'var(--color-primary, #1c497c)' : 'var(--color-gray-300, #d1d5db)',
            borderRadius: 'var(--radius-sm, 0.25rem)',
            background: isQueued ? 'var(--color-primary, #1c497c)' : 'transparent',
            color: isQueued ? '#ffffff' : 'var(--color-gray-400, #9ca3af)',
            cursor: isQueued ? 'default' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 700,
            lineHeight: 1,
            padding: 0,
          }}
        >
          {isQueued ? '✓' : '+'}
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--content-border, #e2e8f0)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
              color: 'var(--color-gray-900, #111827)',
              paddingLeft: '0.625rem',
              borderLeft: '2px solid var(--color-primary, #1c497c)',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
          >
            Available
          </span>
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--color-gray-400, #9ca3af)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
              marginLeft: 'auto',
            }}
          >
            <strong style={{ color: 'var(--color-gray-700, #374151)', fontWeight: 700 }}>{totalMatches}</strong>
            {totalMatches > 100 && ' · top 100 shown'}
          </span>
        </div>

        <input
          type="search"
          placeholder="Search by name, team, or college…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Filter players"
          className="dr-search-input"
          style={{
            width: '100%',
            padding: '0.375rem 0.625rem',
            border: '1px solid var(--content-border, #e2e8f0)',
            borderRadius: 'var(--radius-md, 0.5rem)',
            fontSize: '0.8125rem',
            background: 'var(--color-gray-50, #f9fafb)',
          }}
        />

        {draftContext === 'rookie' && (
          <button
            type="button"
            role="switch"
            aria-pressed={rookiesOnly}
            aria-label={rookiesOnly ? `Showing rookies only` : `Showing all players`}
            onClick={() => onRookiesOnlyChange(!rookiesOnly)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              marginTop: '0.375rem',
              marginBottom: '0.125rem',
              padding: '0.25rem 0.625rem',
              borderRadius: 'var(--radius-full, 9999px)',
              border: rookiesOnly
                ? '1.5px solid var(--color-primary, #1c497c)'
                : '1.5px dashed var(--color-gray-300, #d1d5db)',
              background: rookiesOnly ? 'var(--color-primary, #1c497c)' : 'transparent',
              color: rookiesOnly ? '#ffffff' : 'var(--color-gray-500, #6b7280)',
              fontSize: '0.6875rem',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            Rookies
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '1.125rem',
                height: '1.125rem',
                padding: '0 0.25rem',
                borderRadius: 'var(--radius-full, 9999px)',
                fontSize: '0.5625rem',
                fontWeight: 700,
                background: rookiesOnly ? 'rgba(255,255,255,0.2)' : 'var(--color-gray-100, #f3f4f6)',
                color: rookiesOnly ? '#ffffff' : 'var(--color-gray-600, #4b5563)',
              }}
            >
              {rookieCount}
            </span>
          </button>
        )}

        <div
          role="radiogroup"
          aria-label="Filter by position"
          style={{ display: 'flex', gap: '0.25rem', marginTop: '0.375rem', flexWrap: 'wrap' }}
        >
          {POSITIONS.map((pos) => {
            const isActive = pos === 'ALL' ? !positionFilter : positionFilter === pos;
            return (
              <button
                key={pos}
                role="radio"
                aria-checked={isActive}
                aria-label={`Filter by ${pos === 'ALL' ? 'all positions' : pos + ' position'}`}
                onClick={() => onPositionFilterChange(pos === 'ALL' ? null : pos)}
                className="dr-pos-filter"
                style={{
                  padding: '0.1875rem 0.5rem',
                  borderRadius: 'var(--radius-full, 9999px)',
                  border: 'none',
                  fontSize: '0.625rem',
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  background: isActive ? 'var(--color-primary, #1c497c)' : 'var(--color-gray-100, #f3f4f6)',
                  color: isActive ? '#ffffff' : 'var(--color-gray-500, #6b7280)',
                }}
              >
                {pos}
              </button>
            );
          })}
        </div>
      </div>

      {/* Positional count strip — visible when rookiesOnly so drafters see tier runs */}
      {rookiesOnly && (
        <div className="dr-pos-strip" role="group" aria-label="Available counts by position">
          {(['QB', 'RB', 'WR', 'TE'] as const).map((pos) => {
            const active = positionFilter === pos;
            return (
              <button
                key={pos}
                type="button"
                aria-pressed={active}
                className="dr-pos-strip-item"
                onClick={() => onPositionFilterChange(active ? null : pos)}
              >
                <span
                  className="dr-pos-strip-dot"
                  style={{ background: POSITION_COLORS[pos] }}
                  aria-hidden="true"
                />
                <span className="dr-pos-strip-label">{pos}</span>
                <span className="dr-pos-strip-count">{positionCounts[pos]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Player list */}
      <div style={{ flex: 1, overflow: 'auto' }} aria-label="Available players list">
        {filteredPlayers.length === 0 ? (
          <div
            style={{
              padding: '2rem 1rem',
              textAlign: 'center',
              color: 'var(--color-gray-400, #9ca3af)',
              fontSize: '0.8125rem',
            }}
          >
            {searchQuery || positionFilter ? 'No players match your filters.' : 'No players available.'}
          </div>
        ) : groupedByTier ? (
          <div>
            {TIER_ORDER.filter((t) => groupedByTier.has(t) && (groupedByTier.get(t)?.length ?? 0) > 0).map((tier) => {
              const group = groupedByTier.get(tier)!;
              return (
                <section key={tier} aria-labelledby={`dr-tier-h-${tier}`}>
                  <h3
                    id={`dr-tier-h-${tier}`}
                    className="dr-tier-band"
                    data-tier={tier}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      margin: 0,
                      padding: '0.25rem 0.75rem',
                      fontSize: '0.625rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: 'var(--color-gray-700, #374151)',
                      borderLeft: '3px solid',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    <span>Tier {tier}</span>
                    <span style={{ color: 'var(--color-gray-500, #6b7280)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      · {group.length}
                    </span>
                  </h3>
                  {group.map(renderRow)}
                </section>
              );
            })}
            {(() => {
              const untiered = groupedByTier.get('UNTIERED') || [];
              if (untiered.length === 0) return null;
              return (
                <section aria-labelledby="dr-tier-h-untiered">
                  <h3
                    id="dr-tier-h-untiered"
                    style={{
                      margin: 0,
                      padding: '0.25rem 0.75rem',
                      fontSize: '0.625rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: 'var(--color-gray-500, #6b7280)',
                      background: 'var(--color-gray-50, #f9fafb)',
                      borderLeft: '3px solid var(--color-gray-300, #d1d5db)',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    Unranked · {untiered.length}
                  </h3>
                  {untiered.map(renderRow)}
                </section>
              );
            })()}
            {totalMatches > 100 && (
              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.6875rem',
                  color: 'var(--color-gray-400, #9ca3af)',
                  textAlign: 'center',
                  borderTop: '1px solid var(--color-gray-50, #f9fafb)',
                }}
              >
                Showing 100 of {totalMatches} — refine your search
              </div>
            )}
          </div>
        ) : (
          <div>
            {filteredPlayers.map(renderRow)}
            {totalMatches > 100 && (
              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.6875rem',
                  color: 'var(--color-gray-400, #9ca3af)',
                  textAlign: 'center',
                  borderTop: '1px solid var(--color-gray-50, #f9fafb)',
                }}
              >
                Showing 100 of {totalMatches} — refine your search
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail modal */}
      <PlayerDetailModal
        player={detailPlayer}
        currentPick={currentPick}
        isQueued={detailPlayer ? queuedIds.has(detailPlayer.id) : false}
        isUserTurn={isUserTurn}
        onClose={() => setDetailPlayerId(null)}
        onAddToQueue={(id) => {
          onAddToQueue(id);
        }}
        onDraft={(id) => {
          if (onSubmitPick) onSubmitPick(id);
          setDetailPlayerId(null);
        }}
      />
    </div>
  );
}
