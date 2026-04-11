import React, { useState, useMemo } from 'react';
import type { TradeBuilderTeam, TradeBuilderPlayer } from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';
import { PlayerCell } from '../PlayerCell';
import type { RankingLookup } from '../../../utils/rankings-lookup';
import { getPlayerRank, COMPOSITE_IMPORT_ID } from '../../../utils/rankings-lookup';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

interface Props {
  team: TradeBuilderTeam;
  selectedPlayerIds: string[];
  onAdd: (playerId: string) => void;
  rankingLookup?: RankingLookup | null;
}

export default function PlayerSelector({ team, selectedPlayerIds, onAdd, rankingLookup }: Props) {
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [tradeBaitOnly, setTradeBaitOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sortByRank, setSortByRank] = useState(false);

  const hasCompositeRanks = !!rankingLookup?.byImport.has(COMPOSITE_IMPORT_ID);

  const tradeBaitCount = useMemo(
    () => team.players.filter((p) => p.tradeBait && !selectedPlayerIds.includes(p.id)).length,
    [team.players, selectedPlayerIds]
  );

  const filteredPlayers = useMemo(() => {
    let players = team.players.filter(
      (p) => !selectedPlayerIds.includes(p.id)
    );

    if (tradeBaitOnly) {
      players = players.filter((p) => p.tradeBait);
    }

    if (posFilter !== 'ALL') {
      players = players.filter((p) => p.position === posFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      players = players.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q) ||
          p.nflTeam.toLowerCase().includes(q)
      );
    }

    // Sort: by rank if toggled, otherwise default (trade bait -> position -> salary)
    if (sortByRank && hasCompositeRanks && rankingLookup) {
      const compositeMap = rankingLookup.byImport.get(COMPOSITE_IMPORT_ID);
      players.sort((a, b) => {
        const rankA = compositeMap?.get(a.id) ?? Infinity;
        const rankB = compositeMap?.get(b.id) ?? Infinity;
        return rankA - rankB;
      });
    } else {
      const posOrder = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
      players.sort((a, b) => {
        if (!tradeBaitOnly) {
          if (a.tradeBait && !b.tradeBait) return -1;
          if (!a.tradeBait && b.tradeBait) return 1;
        }
        const posA = posOrder.indexOf(a.position);
        const posB = posOrder.indexOf(b.position);
        if (posA !== posB) return posA - posB;
        return b.salary - a.salary;
      });
    }

    return players;
  }, [team.players, selectedPlayerIds, search, posFilter, tradeBaitOnly, sortByRank, hasCompositeRanks, rankingLookup]);

  const displayPlayers = expanded ? filteredPlayers : filteredPlayers.slice(0, 8);

  return (
    <div className="player-selector">
      <h3 className="player-selector__title">Available Players</h3>

      <div className="player-selector__filters">
        <input
          type="text"
          className="player-selector__search"
          placeholder="Search players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="player-selector__positions">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              className={`player-selector__pos-btn ${posFilter === pos ? 'player-selector__pos-btn--active' : ''}`}
              onClick={() => setPosFilter(pos)}
            >
              {pos}
            </button>
          ))}
          {tradeBaitCount > 0 && (
            <button
              className={`player-selector__pos-btn player-selector__pos-btn--bait ${tradeBaitOnly ? 'player-selector__pos-btn--active' : ''}`}
              onClick={() => setTradeBaitOnly(!tradeBaitOnly)}
              title="Show only players on the trade block"
            >
              Trade Bait ({tradeBaitCount})
            </button>
          )}
          {hasCompositeRanks && (
            <button
              className={`player-selector__pos-btn player-selector__pos-btn--rank ${sortByRank ? 'player-selector__pos-btn--active' : ''}`}
              onClick={() => setSortByRank(!sortByRank)}
              title="Sort by My Rank"
            >
              # Rank
            </button>
          )}
        </div>
      </div>

      <div className="player-selector__list">
        {displayPlayers.map((player) => (
          <PlayerRow
            key={player.id}
            player={player}
            onAdd={onAdd}
            compositeRank={hasCompositeRanks && rankingLookup ? getPlayerRank(rankingLookup, player.id, COMPOSITE_IMPORT_ID) : null}
          />
        ))}
        {filteredPlayers.length === 0 && (
          <div className="player-selector__empty">No players found</div>
        )}
      </div>

      {filteredPlayers.length > 8 && (
        <button
          className="player-selector__toggle"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? 'Show less'
            : `Show all (${filteredPlayers.length} players)`}
        </button>
      )}

      <style>{`
        .player-selector__title {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--color-gray-900, #111827);
          margin: 0 0 0.5rem;
          padding-left: 0.625rem;
          border-left: 2px solid var(--color-primary, #1c497c);
        }
        .player-selector__filters {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .player-selector__search {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-sm, 0.25rem);
          font-size: 0.875rem;
          background: var(--content-bg, #fff);
          color: var(--color-gray-900, #111827);
          box-sizing: border-box;
        }
        .player-selector__search:focus-visible {
          outline: none;
          border-color: var(--color-primary, #1c497c);
          box-shadow: 0 0 0 2px rgba(28, 73, 124, 0.1);
        }
        .player-selector__positions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }
        .player-selector__pos-btn {
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--content-border, #e2e8f0);
          border-radius: var(--radius-sm, 0.25rem);
          background: transparent;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          color: var(--color-gray-500, #6b7280);
          transition: all 0.1s ease;
        }
        .player-selector__pos-btn--active {
          background: var(--color-primary, #1c497c);
          color: #fff;
          border-color: var(--color-primary, #1c497c);
        }
        .player-selector__pos-btn--bait {
          margin-left: 0.25rem;
          border-color: var(--color-warning, #f59e0b);
          color: var(--color-warning-dark, #d97706);
        }
        .player-selector__pos-btn--bait.player-selector__pos-btn--active {
          background: var(--color-warning, #f59e0b);
          border-color: var(--color-warning, #f59e0b);
          color: #fff;
        }
        .player-selector__pos-btn--rank {
          margin-left: 0.25rem;
          border-color: var(--color-primary, #1c497c);
          color: var(--color-primary, #1c497c);
        }
        .player-selector__list {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          margin-top: 0.5rem;
          max-height: 400px;
          overflow-y: auto;
        }
        .player-selector__empty {
          text-align: center;
          color: var(--color-gray-500, #6b7280);
          font-size: 0.875rem;
          padding: 1rem 0;
        }
        .player-selector__toggle {
          background: none;
          border: none;
          color: var(--color-primary, #1c497c);
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0.5rem 0;
          text-align: center;
          width: 100%;
        }
        .player-selector__toggle:hover {
          text-decoration: underline;
        }
        .player-selector__pos-btn:focus-visible,
        .player-selector__toggle:focus-visible {
          outline: 2px solid var(--color-primary, #1c497c);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

function PlayerRow({
  player,
  onAdd,
  compositeRank,
}: {
  player: TradeBuilderPlayer;
  onAdd: (id: string) => void;
  compositeRank: number | null;
}) {
  return (
    <div className={`player-row${player.tradeBait ? ' player-row--trade-bait' : ''}`}>
      <PlayerCell
        size="compact"
        className="player-row__lockup"
        name={player.name}
        headshot={player.headshot}
        position={player.position}
        nflTeam={player.nflTeam}
        nflLogo={player.nflLogo}
        metaSlot={<>
          {player.isRookie && <span className="player-row__badge player-row__badge--rookie">R</span>}
          {player.isFranchiseTagged && <span className="player-row__badge player-row__badge--tag">F</span>}
          {player.tradeBait && <span className="player-row__trade-bait" title="On Trade Block">T</span>}
        </>}
      />
      {compositeRank != null && (
        <span className="player-row__rank" title="My Rank (Composite)">#{compositeRank}</span>
      )}
      <div className="player-row__contract">
        <span className="player-row__salary">{formatCurrency(player.salary)}</span>
        <span className="player-row__years">{player.contractYears}yr</span>
      </div>
      <button
        className="player-row__add"
        onClick={() => onAdd(player.id)}
        title={`Add ${player.name} to trade`}
        aria-label={`Add ${player.name} to trade`}
      >
        +
      </button>

      <style>{`
        .player-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.5rem;
          border-radius: var(--radius-sm, 0.25rem);
          transition: background 0.1s ease;
        }
        .player-row:hover {
          background: var(--color-gray-50, #f9fafb);
        }
        .player-row--trade-bait {
          background: var(--color-warning-light, #fef3c7);
          border-left: 2px solid var(--color-warning, #f59e0b);
        }
        .player-row--trade-bait:hover {
          background: var(--color-warning-light, #fef3c7);
        }
        .player-row__lockup {
          flex: 1;
          min-width: 0;
        }
        .player-row__contract {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.0625rem;
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }
        .player-row__salary {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--color-gray-500, #6b7280);
          white-space: nowrap;
        }
        .player-row__years {
          font-size: 0.625rem;
          color: var(--color-gray-500, #6b7280);
          white-space: nowrap;
        }
        .player-row__badge {
          font-size: 0.5625rem;
          font-weight: 700;
          padding: 0.0625rem 0.1875rem;
          border-radius: 0.1875rem;
          flex-shrink: 0;
        }
        .player-row__badge--rookie {
          background: var(--color-info-light, #dbeafe);
          color: var(--color-info-dark, #2563eb);
        }
        .player-row__badge--tag {
          background: var(--color-franchise-tag-light, #ede9fe);
          color: var(--color-franchise-tag, #7c3aed);
        }
        .player-row__rank {
          font-size: 0.625rem;
          font-weight: 700;
          color: var(--color-primary, #1c497c);
          background: var(--color-primary-light, #dbeafe);
          padding: 0.0625rem 0.25rem;
          border-radius: 0.1875rem;
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .player-row__trade-bait {
          font-size: 0.75rem;
          cursor: default;
        }
        .player-row__add {
          background: var(--btn-secondary-bg, #2e8743);
          color: #fff;
          border: none;
          border-radius: var(--radius-sm, 0.25rem);
          width: 1.5rem;
          height: 1.5rem;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: opacity 0.1s ease;
        }
        .player-row__add:hover {
          opacity: 0.85;
        }
      `}</style>
    </div>
  );
}
