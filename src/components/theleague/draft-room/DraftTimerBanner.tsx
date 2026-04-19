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
  /** True when the current pick belongs to the user — changes banner state to "you" */
  isUserTurn?: boolean;
}

type TimerDataState = 'idle' | 'other' | 'you' | 'warning' | 'danger' | 'complete' | 'suspended';

function parseTimerHours(limitStr: string): number {
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
  totalSeconds: number;
  totalLimit: number;
  isExpired: boolean;
  isSuspended: boolean;
}

function calculateDeadline(previousTimestamp: string, draftKind: DraftKind, limitHours: number): number | null {
  const ts = parseInt(previousTimestamp);
  if (!ts || isNaN(ts)) return null;
  const pickTimeMs = ts * 1000;
  if (draftKind === 'email') return pickTimeMs + limitHours * 60 * 60 * 1000;
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
  const totalLimitSeconds = draftKind === 'email' ? limitHours * 3600 : limitHours * 60;

  const previousTimestamp = useMemo(() => {
    if (!currentPick) return '';
    return currentPick.timestamp || '';
  }, [currentPick]);

  const deadline = useMemo(
    () => calculateDeadline(previousTimestamp, draftKind, limitHours),
    [previousTimestamp, draftKind, limitHours]
  );

  const [timer, setTimer] = useState<TimerState>({
    hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, totalLimit: totalLimitSeconds,
    isExpired: false, isSuspended: false,
  });

  useEffect(() => {
    if (draftComplete || !deadline) {
      setTimer({
        hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, totalLimit: totalLimitSeconds,
        isExpired: false, isSuspended: false,
      });
      return;
    }

    const tick = () => {
      const now = new Date();
      const suspended = isInSuspendedWindow(now, draftTimerSusp);
      const remainingMs = deadline - now.getTime();

      if (remainingMs <= 0) {
        setTimer({
          hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, totalLimit: totalLimitSeconds,
          isExpired: true, isSuspended: suspended,
        });
        return;
      }

      const totalSeconds = Math.floor(remainingMs / 1000);
      setTimer({
        hours: Math.floor(totalSeconds / 3600),
        minutes: Math.floor((totalSeconds % 3600) / 60),
        seconds: totalSeconds % 60,
        totalSeconds,
        totalLimit: totalLimitSeconds,
        isExpired: false,
        isSuspended: suspended,
      });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, draftComplete, draftTimerSusp, totalLimitSeconds]);

  return timer;
}

function formatTimer(timer: TimerState, draftKind: DraftKind): string {
  if (timer.isExpired) return 'TIME EXPIRED';
  if (draftKind === 'email') {
    if (timer.hours > 0) return `${timer.hours}h ${String(timer.minutes).padStart(2, '0')}m`;
    return `${timer.minutes}:${String(timer.seconds).padStart(2, '0')}`;
  }
  const mins = timer.hours * 60 + timer.minutes;
  return `${mins}:${String(timer.seconds).padStart(2, '0')}`;
}

function deriveBannerState(opts: {
  draftComplete: boolean;
  currentPick: DraftRoomPick | null;
  isUserTurn: boolean;
  timer: TimerState;
}): TimerDataState {
  const { draftComplete, currentPick, isUserTurn, timer } = opts;
  if (draftComplete) return 'complete';
  if (!currentPick) return 'idle';
  if (timer.isSuspended) return 'suspended';
  if (timer.isExpired) return 'danger';
  // Warning threshold: < 20% of total limit remaining
  const warning = timer.totalLimit > 0 && timer.totalSeconds > 0 && timer.totalSeconds < timer.totalLimit * 0.2;
  if (isUserTurn) return 'you';
  if (warning) return 'warning';
  return 'other';
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
  isUserTurn = false,
}: DraftTimerBannerProps) {
  const isMockTimer = mockClockSeconds !== undefined;
  const internalTimer = useTimer(currentPick, draftKind, draftLimitHours, draftTimerSusp, draftComplete);

  const mockLimit = draftKind === 'email' ? parseTimerHours(draftLimitHours) * 3600 : parseTimerHours(draftLimitHours) * 60;
  const timer: TimerState = isMockTimer
    ? {
        hours: Math.floor(mockClockSeconds / 3600),
        minutes: Math.floor((mockClockSeconds % 3600) / 60),
        seconds: mockClockSeconds % 60,
        totalSeconds: mockClockSeconds,
        totalLimit: mockLimit,
        isExpired: mockClockSeconds <= 0 && !draftComplete,
        isSuspended: false,
      }
    : internalTimer;

  const bannerState = deriveBannerState({ draftComplete, currentPick, isUserTurn, timer });

  if (draftComplete) {
    return (
      <div className="dr-timer-banner" data-state="complete" role="region" aria-label="Draft complete">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <DraftTrophyIcon />
          <span className="dr-timer-clock" style={{ fontSize: '1.25rem', letterSpacing: '0.04em' }}>
            DRAFT COMPLETE
          </span>
        </div>
        {actions}
      </div>
    );
  }

  if (!currentPick || !currentTeam) {
    return (
      <div className="dr-timer-banner" data-state="idle" role="region" aria-label="Draft waiting to begin">
        <span style={{ opacity: 0.8, fontSize: '0.875rem', fontWeight: 600 }}>
          Waiting for draft to begin…
        </span>
        {actions}
      </div>
    );
  }

  const pickLabel = `${currentPick.round}.${String(currentPick.pickInRound).padStart(2, '0')}`;
  const teamLabel = chooseTeamName({
    fullName: currentTeam.name,
    nameMedium: currentTeam.nameMedium,
    nameShort: currentTeam.nameShort,
    abbrev: currentTeam.abbrev,
  });

  return (
    <div
      className="dr-timer-banner"
      data-state={bannerState}
      role="region"
      aria-label={isUserTurn ? "You're on the clock" : `${teamLabel} is on the clock`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
        {currentTeam.icon && (
          <img
            src={currentTeam.icon}
            alt=""
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              flexShrink: 0,
              objectFit: 'cover',
              boxShadow: '0 0 0 2px rgba(255,255,255,0.4)',
            }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.625rem',
              fontWeight: 800,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.08em',
              opacity: 0.85,
              lineHeight: 1.1,
            }}
          >
            {isUserTurn ? "You're Up · " : 'On the Clock · '}{pickLabel}
          </div>
          <div
            style={{
              fontSize: '1rem',
              fontWeight: 800,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: 1.2,
            }}
          >
            {isUserTurn ? 'Make Your Pick' : teamLabel}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          {timer.isSuspended ? (
            <div>
              <div
                className="dr-timer-clock"
                style={{ fontSize: '1.25rem', opacity: 0.85 }}
                role="timer"
                aria-label="Clock paused"
              >
                CLOCK PAUSED
              </div>
              <div style={{ fontSize: '0.6875rem', opacity: 0.7, marginTop: '0.125rem' }}>
                Resumes at {getSuspendedEndHour(draftTimerSusp)}:00 AM
              </div>
            </div>
          ) : (
            <div role="timer" aria-label="Time remaining" className="dr-timer-clock">
              {formatTimer(timer, draftKind)}
            </div>
          )}
        </div>
        {actions}
      </div>
    </div>
  );
}

function DraftTrophyIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}
