import React, { useState, useMemo } from 'react';
import type { TradeBuilderTeam } from '../../../types/trade-builder';
import { formatCurrency } from '../../../utils/formatters';

const DEFAULT_HEADSHOT = 'https://www49.myfantasyleague.com/player_photos_2010/no_photo_available.jpg';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

interface TradeBaitEntry {
  player: TradeBuilderPlayer;
  team: TradeBuilderTeam;
}

interface Props {
  teams: TradeBuilderTeam[];
  leagueYear: number;
  onStartTrade: (franchiseId: string, playerId: string) => void;
}

export default function TradeBaitMarketplace({ teams, leagueYear, onStartTrade }: Props) {
  const [posFilter, setPosFilter] = useState('ALL');
  const [collapsed, setCollapsed] = useState(false);

  const allTradeBait = useMemo(() => {
    const entries: TradeBaitEntry[] = [];
    for (const team of teams) {
      for (const player of team.players) {
        if (player.tradeBait) {
          entries.push({ player, team });
        }
      }
    }
    // Sort by position order, then salary desc
    const posOrder = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
    entries.sort((a, b) => {
      const posA = posOrder.indexOf(a.player.position);
      const posB = posOrder.indexOf(b.player.position);
      if (posA !== posB) return posA - posB;
      return b.player.salary - a.player.salary;
    });
    return entries;
  }, [teams]);

  const filtered = useMemo(() => {
    if (posFilter === 'ALL') return allTradeBait;
    return allTradeBait.filter((e) => e.player.position === posFilter);
  }, [allTradeBait, posFilter]);

  // Count per position for filter badges
  const positionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of allTradeBait) {
      counts[entry.player.position] = (counts[entry.player.position] || 0) + 1;
    }
    return counts;
  }, [allTradeBait]);

  // Group by team for the grouped view
  const groupedByTeam = useMemo(() => {
    const map = new Map<string, { team: TradeBuilderTeam; players: TradeBuilderPlayer[] }>();
    for (const entry of filtered) {
      if (!map.has(entry.team.franchiseId)) {
        map.set(entry.team.franchiseId, { team: entry.team, players: [] });
      }
      map.get(entry.team.franchiseId)!.players.push(entry.player);
    }
    return Array.from(map.values());
  }, [filtered]);

  if (allTradeBait.length === 0) {
    return (
      <div className="marketplace">
        <div className="marketplace__empty">
          <div className="marketplace__empty-icon">🏷️</div>
          <h3 className="marketplace__empty-title">No players on the trade block yet</h3>
          <p className="marketplace__empty-text">
            Be the first to put players on the trade block and let the league know you're open for business.
          </p>
          <a
            href="/theleague/rosters"
            className="marketplace__cta-btn"
          >
            Manage Your Trade Bait
          </a>
          <p className="marketplace__empty-hint">
            On the Rosters page, click the <span className="marketplace__action-icon" aria-label="action menu"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></span> button next to any player to add them to the trade block.
          </p>
        </div>
        <style>{marketplaceStyles}</style>
      </div>
    );
  }

  const handleStartTrade = (franchiseId: string, playerId: string) => {
    onStartTrade(franchiseId, playerId);
    // Scroll to the trade builder panels
    const panels = document.querySelector('.trade-builder__panels');
    if (panels) {
      panels.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="marketplace">
      <div className="marketplace__header" onClick={() => setCollapsed(!collapsed)}>
        <div className="marketplace__header-left">
          <h2 className="marketplace__title">
            🏷️ Trade Bait Marketplace
          </h2>
          <span className="marketplace__count">
            {allTradeBait.length} player{allTradeBait.length !== 1 ? 's' : ''} available from {groupedByTeam.length} team{groupedByTeam.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          className="marketplace__collapse-btn"
          aria-label={collapsed ? 'Expand marketplace' : 'Collapse marketplace'}
        >
          {collapsed ? '▼' : '▲'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="marketplace__filters">
            {POSITIONS.map((pos) => {
              const count = pos === 'ALL' ? allTradeBait.length : (positionCounts[pos] || 0);
              if (pos !== 'ALL' && count === 0) return null;
              return (
                <button
                  key={pos}
                  className={`marketplace__filter-btn ${posFilter === pos ? 'marketplace__filter-btn--active' : ''}`}
                  onClick={() => setPosFilter(pos)}
                >
                  {pos}
                  <span className="marketplace__filter-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="marketplace__grid">
            {groupedByTeam.map(({ team, players }) => (
              <div key={team.franchiseId} className="marketplace__team-group">
                <div className="marketplace__team-header">
                  {team.icon && (
                    <img src={team.icon} alt="" className="marketplace__team-icon" />
                  )}
                  <span className="marketplace__team-name">{team.nameShort}</span>
                </div>
                <div className="marketplace__players">
                  {players.map((player) => {
                    const isDef = player.position.toUpperCase() === 'DEF';
                    const avatarSrc = isDef && player.nflLogo ? player.nflLogo : (player.headshot || DEFAULT_HEADSHOT);
                    return (
                      <button
                        key={player.id}
                        className="marketplace__player"
                        onClick={() => handleStartTrade(team.franchiseId, player.id)}
                        title={`Start a trade for ${player.name}`}
                      >
                        <div className={`marketplace__player-avatar${isDef ? ' marketplace__player-avatar--def' : ''}`}>
                          <img
                            src={avatarSrc}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={(e) => { (e.target as HTMLImageElement).onerror = null; (e.target as HTMLImageElement).src = DEFAULT_HEADSHOT; }}
                          />
                        </div>
                        <div className="marketplace__player-info">
                          <span className="marketplace__player-name">{player.name}</span>
                          <div className="marketplace__player-meta">
                            {!isDef && player.nflLogo && (
                              <img src={player.nflLogo} alt="" className="marketplace__player-nfl-logo" loading="lazy" decoding="async" />
                            )}
                            <span className="marketplace__player-pos">{player.position}</span>
                            {player.isRookie && <span className="marketplace__badge marketplace__badge--rookie">R</span>}
                            {player.isFranchiseTagged && <span className="marketplace__badge marketplace__badge--tag">F</span>}
                          </div>
                        </div>
                        <div className="marketplace__player-contract">
                          <span className="marketplace__player-salary">{formatCurrency(player.salary)}</span>
                          <span className="marketplace__player-years">{player.contractYears}yr</span>
                        </div>
                        <span className="marketplace__trade-arrow" aria-hidden="true">→</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="marketplace__footer">
            <a
              href="/theleague/rosters"
              className="marketplace__cta-btn"
            >
              Manage Your Trade Bait
            </a>
            <span className="marketplace__footer-hint">
              Click the <span className="marketplace__action-icon" aria-label="action menu"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></span> button next to any player on the Rosters page to add them to the trade block
            </span>
          </div>
        </>
      )}

      <style>{marketplaceStyles}</style>
    </div>
  );
}

const marketplaceStyles = `
  .marketplace {
    background: var(--primary-content-bg-color, #fff);
    border: 1px solid var(--primary-content-border-color, #e2e8f0);
    border-radius: 0.75rem;
    margin-top: 2.5rem;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }
  .marketplace__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.875rem 1rem;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--primary-content-border-color, #e2e8f0);
    background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  }
  .marketplace__header:hover {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  }
  .marketplace__header-left {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .marketplace__title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-color, #1f2937);
    margin: 0;
  }
  .marketplace__count {
    font-size: 0.8125rem;
    color: #92400e;
    font-weight: 500;
  }
  .marketplace__collapse-btn {
    background: none;
    border: none;
    font-size: 0.75rem;
    color: var(--muted-text-color, #6b7280);
    cursor: pointer;
    padding: 0.25rem;
  }
  .marketplace__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--primary-content-border-color, #e2e8f0);
  }
  .marketplace__filter-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3125rem 0.625rem;
    border: 1px solid var(--primary-content-border-color, #e2e8f0);
    border-radius: 1rem;
    background: transparent;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    color: var(--muted-text-color, #6b7280);
    transition: all 0.1s ease;
  }
  .marketplace__filter-btn:hover {
    border-color: #f59e0b;
    color: #92400e;
  }
  .marketplace__filter-btn--active {
    background: #f59e0b;
    color: #fff;
    border-color: #f59e0b;
  }
  .marketplace__filter-btn--active:hover {
    background: #d97706;
    border-color: #d97706;
  }
  .marketplace__filter-count {
    font-size: 0.625rem;
    opacity: 0.8;
  }
  .marketplace__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 0;
  }
  .marketplace__team-group {
    border-right: 1px solid var(--primary-content-border-color, #e2e8f0);
    border-bottom: 1px solid var(--primary-content-border-color, #e2e8f0);
  }
  .marketplace__team-group:last-child {
    border-right: none;
  }
  .marketplace__team-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--primary-light-bg, #f8fafc);
    border-bottom: 1px solid var(--primary-content-border-color, #e2e8f0);
  }
  .marketplace__team-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .marketplace__team-name {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--text-color, #1f2937);
  }
  .marketplace__players {
    display: flex;
    flex-direction: column;
  }
  .marketplace__player {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    border-bottom: 1px solid var(--primary-content-border-color, #f1f5f9);
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.1s ease;
    font-family: inherit;
  }
  .marketplace__player:last-child {
    border-bottom: none;
  }
  .marketplace__player:hover {
    background: #fffbeb;
  }
  .marketplace__player:hover .marketplace__trade-arrow {
    opacity: 1;
    transform: translateX(0);
  }
  .marketplace__player-avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    background: var(--avatar-bg-color, #f3f4f6);
    border: 1px solid #e2e8f0;
  }
  .marketplace__player-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }
  .marketplace__player-avatar--def img {
    object-fit: contain;
    object-position: center;
  }
  .marketplace__player-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .marketplace__player-name {
    font-weight: 600;
    font-size: 0.8125rem;
    color: var(--text-color, #1f2937);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  .marketplace__player-meta {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-secondary-color, #64748b);
  }
  .marketplace__player-nfl-logo {
    width: 14px;
    height: 14px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .marketplace__player-pos {
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }
  .marketplace__badge {
    font-size: 0.5625rem;
    font-weight: 700;
    padding: 0.0625rem 0.1875rem;
    border-radius: 0.1875rem;
  }
  .marketplace__badge--rookie {
    background: #dbeafe;
    color: #1d4ed8;
  }
  .marketplace__badge--tag {
    background: #fef3c7;
    color: #92400e;
  }
  .marketplace__player-contract {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.0625rem;
    flex-shrink: 0;
  }
  .marketplace__player-salary {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted-text-color, #6b7280);
    white-space: nowrap;
  }
  .marketplace__player-years {
    font-size: 0.625rem;
    color: var(--muted-text-color, #6b7280);
    white-space: nowrap;
  }
  .marketplace__trade-arrow {
    flex-shrink: 0;
    font-size: 1rem;
    font-weight: 700;
    color: #f59e0b;
    opacity: 0;
    transform: translateX(-4px);
    transition: all 0.15s ease;
  }
  .marketplace__footer {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
    border-top: 1px solid #fde68a;
    flex-wrap: wrap;
  }
  .marketplace__cta-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    background: #f59e0b;
    color: #fff;
    border: none;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .marketplace__cta-btn:hover {
    background: #d97706;
    color: #fff;
  }
  .marketplace__footer-hint {
    font-size: 0.75rem;
    color: #92400e;
    flex: 1;
    min-width: 200px;
  }
  .marketplace__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 1rem;
    text-align: center;
  }
  .marketplace__empty-icon {
    font-size: 2rem;
  }
  .marketplace__empty-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-color, #1f2937);
    margin: 0;
  }
  .marketplace__empty-text {
    font-size: 0.875rem;
    color: var(--muted-text-color, #6b7280);
    margin: 0;
    max-width: 400px;
  }
  .marketplace__empty-hint {
    font-size: 0.8125rem;
    color: var(--color-gray-500, #6b7280);
    margin: 0;
    max-width: 400px;
    line-height: 1.5;
  }
  .marketplace__action-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    width: 22px;
    height: 22px;
    border: 1px solid var(--content-border, #e2e8f0);
    border-radius: var(--radius-sm, 0.25rem);
    background: var(--color-gray-50, #f9fafb);
    color: var(--color-gray-500, #6b7280);
    margin: 0 0.125rem;
  }
  @media (max-width: 768px) {
    .marketplace__grid {
      grid-template-columns: 1fr;
    }
    .marketplace__team-group {
      border-right: none;
    }
    .marketplace__footer {
      flex-direction: column;
      align-items: stretch;
      text-align: center;
    }
    .marketplace__cta-btn {
      justify-content: center;
    }
  }
`;
