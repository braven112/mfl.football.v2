import React, { useState, useMemo } from 'react';
import type { TradeBuilderTeam, TradeBuilderPlayer } from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';

const DEFAULT_HEADSHOT = 'https://www49.myfantasyleague.com/player_photos_2010/no_photo_available.jpg';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

interface Props {
  team: TradeBuilderTeam;
  selectedPlayerIds: string[];
  onAdd: (playerId: string) => void;
}

export default function PlayerSelector({ team, selectedPlayerIds, onAdd }: Props) {
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [expanded, setExpanded] = useState(false);

  const filteredPlayers = useMemo(() => {
    let players = team.players.filter(
      (p) => !selectedPlayerIds.includes(p.id)
    );

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

    // Sort by position order, then salary desc
    const posOrder = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
    players.sort((a, b) => {
      const posA = posOrder.indexOf(a.position);
      const posB = posOrder.indexOf(b.position);
      if (posA !== posB) return posA - posB;
      return b.salary - a.salary;
    });

    return players;
  }, [team.players, selectedPlayerIds, search, posFilter]);

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
        </div>
      </div>

      <div className="player-selector__list">
        {displayPlayers.map((player) => (
          <PlayerRow key={player.id} player={player} onAdd={onAdd} />
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
          font-size: 0.8125rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-text-color, #6b7280);
          margin: 0 0 0.5rem;
        }
        .player-selector__filters {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .player-selector__search {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--primary-content-border-color, #e2e8f0);
          border-radius: 0.375rem;
          font-size: 0.875rem;
          background: var(--primary-content-bg-color, #fff);
          color: var(--text-color, #1f2937);
          box-sizing: border-box;
        }
        .player-selector__search:focus {
          outline: none;
          border-color: var(--primary-color, #1c497c);
          box-shadow: 0 0 0 2px rgba(28, 73, 124, 0.1);
        }
        .player-selector__positions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.25rem;
        }
        .player-selector__pos-btn {
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--primary-content-border-color, #e2e8f0);
          border-radius: 0.25rem;
          background: transparent;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          color: var(--muted-text-color, #6b7280);
          transition: all 0.1s ease;
        }
        .player-selector__pos-btn--active {
          background: var(--primary-color, #1c497c);
          color: #fff;
          border-color: var(--primary-color, #1c497c);
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
          color: var(--muted-text-color, #6b7280);
          font-size: 0.875rem;
          padding: 1rem 0;
        }
        .player-selector__toggle {
          background: none;
          border: none;
          color: var(--primary-color, #1c497c);
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
      `}</style>
    </div>
  );
}

function PlayerRow({
  player,
  onAdd,
}: {
  player: TradeBuilderPlayer;
  onAdd: (id: string) => void;
}) {
  const isDef = player.position.toUpperCase() === 'DEF';
  const avatarSrc = isDef && player.nflLogo ? player.nflLogo : (player.headshot || DEFAULT_HEADSHOT);

  return (
    <div className="player-row">
      <div className={`player-row__avatar${isDef ? ' player-row__avatar--def' : ''}`}>
        <img
          src={avatarSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(e) => { (e.target as HTMLImageElement).onerror = null; (e.target as HTMLImageElement).src = DEFAULT_HEADSHOT; }}
        />
      </div>
      <div className="player-row__info">
        <span className="player-row__name">{player.name}</span>
        <div className="player-row__meta">
          {!isDef && player.nflLogo && (
            <img src={player.nflLogo} alt="" className="player-row__nfl-logo" loading="lazy" decoding="async" />
          )}
          <span className="player-row__pos">{player.position}</span>
          {player.isRookie && <span className="player-row__badge player-row__badge--rookie">R</span>}
          {player.isFranchiseTagged && <span className="player-row__badge player-row__badge--tag">F</span>}
        </div>
      </div>
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
          border-radius: 0.375rem;
          transition: background 0.1s ease;
        }
        .player-row:hover {
          background: var(--primary-light-bg, #f0f4f8);
        }
        .player-row__avatar {
          flex-shrink: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          overflow: hidden;
          background: var(--avatar-bg-color, #f3f4f6);
          border: 1px solid #e2e8f0;
        }
        .player-row__avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
        }
        .player-row__avatar--def img {
          object-fit: contain;
          object-position: center;
        }
        .player-row__info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .player-row__name {
          font-weight: 600;
          font-size: 0.8125rem;
          color: var(--text-color, #1f2937);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
        }
        .player-row__meta {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.75rem;
          color: var(--text-secondary-color, #64748b);
        }
        .player-row__nfl-logo {
          width: 14px;
          height: 14px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .player-row__pos {
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }
        .player-row__contract {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.0625rem;
          flex-shrink: 0;
        }
        .player-row__salary {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-text-color, #6b7280);
          white-space: nowrap;
        }
        .player-row__years {
          font-size: 0.625rem;
          color: var(--muted-text-color, #6b7280);
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
          background: #dbeafe;
          color: #1d4ed8;
        }
        .player-row__badge--tag {
          background: #fef3c7;
          color: #92400e;
        }
        .player-row__add {
          background: var(--secondary-color, #2e8743);
          color: #fff;
          border: none;
          border-radius: 0.25rem;
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
