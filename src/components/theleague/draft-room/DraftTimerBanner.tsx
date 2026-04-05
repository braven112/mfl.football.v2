import React, { useState, useEffect, useMemo } from 'react';
import type { DraftRoomPick, DraftRoomTeam, DraftKind } from '../../../types/draft-room';
import { chooseTeamName } from '../../../utils/team-names';

interface DraftTimerBannerProps {
  currentPick: DraftRoomPick | null;
  currentTeam: DraftRoomTeam | null;
  draftKind: DraftKind;
  draftLimitHours: string;
  draftTimerSusp: string;
  draftComplete: boolean;
  /** Mock mode: server-driven countdown seconds (overrides internal timer) */
  mockClockSeconds?: number;
  /** Optional actions rendered on the right side (e.g. Reset button) */
  actions?: React.ReactNode;
}

function parseTimerHours(limitStr: string): number {
  // Format: "12:00" → 12 hours, or "8" → 8 hours
  const parts = limitStr.split(':');
  return parseInt(parts[0]) || 8;
}

function isInSuspendedWindow(now: Date, suspStr: string): boolean {
  if (!suspStr) return false;
  const parts = suspStr.split(' ').map(Number);
  if (parts.length < 2) return false;
  const hour = now.getHours();
  return hour >= parts[0] && hour < parts[1];
}

function getSuspendedEndHour(suspStr: string): number {
  const parts = suspStr.split(' ').map(Number);
  return parts.length >= 2 ? parts[1] : 7;
}

interface TimerState {
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  isSuspended: boolean;
}

function calculateDeadline(previousTimestamp: string, draftKind: DraftKind, limitHours: number): number | null {
  const ts = parseInt(previousTimestamp);
  if (!ts || isNaN(ts)) return null;

  const pickTimeMs = ts * 1000;
  if (draftKind === 'email') {
    return pickTimeMs + limitHours * 60 * 60 * 1000;
  }
  // Live: limitHours is actually minutes for live drafts
  return pickTimeMs + limitHours * 60 * 1000;
}

function useTimer(
  currentPick: DraftRoomPick | null,
  draftKind: DraftKind,
  draftLimitHours: string,
  draftTimerSusp: string,
  draftComplete: boolean
): TimerState {
  const limitHours = parseTimerHours(draftLimitHours);

  // Find the previous pick's timestamp to calculate deadline
  const previousTimestamp = useMemo(() => {
    if (!currentPick) return '';
    // The timer starts from the previous pick's timestamp
    // For the first pick, there's no previous — use '' which means timer hasn't started
    return currentPick.timestamp || '';
  }, [currentPick]);

  const deadline = useMemo(
    () => calculateDeadline(previousTimestamp, draftKind, limitHours),
    [previousTimestamp, draftKind, limitHours]
  );

  const [timer, setTimer] = useState<TimerState>({
    hours: 0, minutes: 0, seconds: 0, isExpired: false, isSuspended: false,
  });

  useEffect(() => {
    if (draftComplete || !deadline) {
      setTimer({ hours: 0, minutes: 0, seconds: 0, isExpired: false, isSuspended: false });
      return;
    }

    const tick = () => {
      const now = new Date();
      const suspended = isInSuspendedWindow(now, draftTimerSusp);
      const remainingMs = deadline - now.getTime();

      if (remainingMs <= 0) {
        setTimer({ hours: 0, minutes: 0, seconds: 0, isExpired: true, isSuspended: suspended });
        return;
      }

      const totalSeconds = Math.floor(remainingMs / 1000);
      setTimer({
        hours: Math.floor(totalSeconds / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
        isExpired: false,
        isSuspended: suspended,
      });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, draftComplete, draftTimerSusp]);

  return timer;
}

function formatTimer(timer: TimerState, draftKind: DraftKind): string {
  if (timer.isExpired) return 'TIME EXPIRED';

  if (draftKind === 'email') {
    if (timer.hours > 0) return `${timer.hours}h ${timer.minutes}m`;
    return `${timer.minutes}m ${timer.seconds}s`;
  }
  // Live
  const mins = timer.hours * 60 + timer.minutes;
  return `${mins}:${String(timer.seconds).padStart(2, '0')}`;
}

function getTimerColor(timer: TimerState, _draftKind: DraftKind): string {
  // Timer text is always white on the blue banner; only "TIME EXPIRED" uses danger color
  if (timer.isExpired) return 'var(--dr-timer-danger, #dc2626)';
  return 'var(--dr-timer-text, #ffffff)';
}

export function DraftTimerBanner({
  currentPick,
  currentTeam,
  draftKind,
  draftLimitHours,
  draftTimerSusp,
  draftComplete,
  mockClockSeconds,
  actions,
}: DraftTimerBannerProps) {
  const isMockTimer = mockClockSeconds !== undefined;
  const internalTimer = useTimer(currentPick, draftKind, draftLimitHours, draftTimerSusp, draftComplete);

  // In mock mode, build timer state from server-driven seconds
  const timer: TimerState = isMockTimer
    ? {
        hours: Math.floor(mockClockSeconds / 3600),
        minutes: Math.floor((mockClockSeconds % 3600) / 60),
        seconds: mockClockSeconds % 60,
        isExpired: mockClockSeconds <= 0 && !draftComplete,
        isSuspended: false,
      }
    : internalTimer;

  const pickLabel = currentPick
    ? `Round ${currentPick.round}, Pick ${currentPick.pickInRound}`
    : '';

  const bannerStyle: React.CSSProperties = {
    background: 'var(--dr-timer-bg, #1c497c)',
    color: 'var(--dr-timer-text, #ffffff)',
    padding: '0.375rem 1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    minHeight: 'var(--dr-timer-height, 56px)',
  };

  const timerStyle: React.CSSProperties = {
    fontSize: 'var(--dr-timer-font-size, 1.75rem)',
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    color: getTimerColor(timer, draftKind),
    lineHeight: 1,
  };

  if (draftComplete) {
    return (
      <div style={bannerStyle} role="region" aria-label="Draft timer and current pick">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ ...timerStyle, color: 'var(--color-success, #16a34a)', fontSize: '1.5rem' }}>
            DRAFT COMPLETE
          </span>
        </div>
        {actions}
      </div>
    );
  }

  if (!currentPick || !currentTeam) {
    return (
      <div style={bannerStyle} role="region" aria-label="Draft timer and current pick">
        <span style={{ opacity: 0.7, fontSize: '0.875rem' }}>Waiting for draft to begin...</span>
      </div>
    );
  }

  return (
    <div style={bannerStyle} role="region" aria-label="Draft timer and current pick">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
        {currentTeam.icon && (
          <img
            src={currentTeam.icon}
            alt={`${currentTeam.nameShort} logo`}
            style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', opacity: 0.65 }}>
            On the Clock · {pickLabel}
          </div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {chooseTeamName({ fullName: currentTeam.name, nameMedium: currentTeam.nameMedium, nameShort: currentTeam.nameShort, abbrev: currentTeam.abbrev })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          {timer.isSuspended ? (
            <div>
              <div style={{ ...timerStyle, fontSize: '1.25rem', opacity: 0.7 }}>CLOCK PAUSED</div>
              <div style={{ fontSize: '0.6875rem', opacity: 0.5, marginTop: '0.25rem' }}>
                Resumes at {getSuspendedEndHour(draftTimerSusp)}:00 AM
              </div>
            </div>
          ) : (
            <div role="timer" aria-label="Time remaining for current pick" style={timerStyle}>
              {formatTimer(timer, draftKind)}
            </div>
          )}
        </div>
        {actions}
      </div>
    </div>
  );
}
