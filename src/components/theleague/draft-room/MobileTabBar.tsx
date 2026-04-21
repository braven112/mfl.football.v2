import React from 'react';

type DraftTabId = 'board' | 'players' | 'queue' | 'chat';

interface MobileTabBarProps {
  activeTab: DraftTabId;
  onTabChange: (tab: DraftTabId) => void;
  chatUnread?: number;
  queueCount?: number;
}

const TABS: Array<{ id: DraftTabId; label: string }> = [
  { id: 'board', label: 'Board' },
  { id: 'players', label: 'Players' },
  { id: 'queue', label: 'Queue' },
  { id: 'chat', label: 'Chat' },
];

export function MobileTabBar({ activeTab, onTabChange, chatUnread = 0, queueCount = 0 }: MobileTabBarProps) {
  return (
    <div role="tablist" aria-label="Draft room views" className="dr-tabbar">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const badgeCount = tab.id === 'chat' ? chatUnread : tab.id === 'queue' ? queueCount : 0;
        const showBadge = badgeCount > 0;
        const isUnread = tab.id === 'chat';
        return (
          <button
            key={tab.id}
            id={`dr-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`dr-panel-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className="dr-tab-btn"
          >
            {tab.label}
            {showBadge && (
              <span
                className="dr-tab-btn__badge"
                data-variant={isUnread ? 'unread' : undefined}
                aria-label={isUnread
                  ? `${badgeCount} unread message${badgeCount !== 1 ? 's' : ''}`
                  : `${badgeCount} in queue`}
              >
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
