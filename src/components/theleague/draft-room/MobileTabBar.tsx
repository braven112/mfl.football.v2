import React from 'react';

interface MobileTabBarProps {
  activeTab: 'board' | 'players' | 'queue' | 'chat';
  onTabChange: (tab: 'board' | 'players' | 'queue' | 'chat') => void;
  chatUnread?: number;
  queueCount?: number;
}

const TABS: Array<{ id: 'board' | 'players' | 'queue' | 'chat'; label: string }> = [
  { id: 'board', label: 'Board' },
  { id: 'players', label: 'Players' },
  { id: 'queue', label: 'Queue' },
  { id: 'chat', label: 'Chat' },
];

export function MobileTabBar({ activeTab, onTabChange, chatUnread = 0, queueCount = 0 }: MobileTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Draft room views"
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--content-border, #e2e8f0)',
        background: 'var(--content-bg, #ffffff)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const badgeCount = tab.id === 'chat' ? chatUnread : tab.id === 'queue' ? queueCount : 0;
        const showBadge = badgeCount > 0;
        return (
          <button
            key={tab.id}
            id={`dr-tab-${tab.id}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`dr-panel-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            style={{
              flex: 1,
              padding: '0.625rem 0',
              border: 'none',
              borderBottom: isActive
                ? '2px solid var(--dr-tab-active-border, #1c497c)'
                : '2px solid transparent',
              background: 'transparent',
              color: isActive
                ? 'var(--dr-tab-active-text, #1c497c)'
                : 'var(--dr-tab-inactive-text, #9ca3af)',
              fontSize: '0.625rem',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              transition: 'color 0.15s ease, border-color 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.25rem',
              position: 'relative',
            }}
          >
            {tab.label}
            {showBadge && (
              <span
                aria-label={tab.id === 'chat'
                  ? `${badgeCount} unread message${badgeCount !== 1 ? 's' : ''}`
                  : `${badgeCount} in queue`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '1rem',
                  height: '1rem',
                  padding: '0 0.2rem',
                  borderRadius: 'var(--radius-full, 9999px)',
                  background: tab.id === 'chat' && !isActive
                    ? 'var(--dr-chat-unread-bg, #dc2626)'
                    : isActive
                      ? 'var(--color-primary, #1c497c)'
                      : 'var(--color-gray-300, #d1d5db)',
                  color: '#ffffff',
                  fontSize: '0.5rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1,
                }}
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
