/**
 * TradeDeadlineHero — React island for the 24-hour trade deadline countdown.
 *
 * Rendered by SeasonDailyHero when phase === 'trade-deadline' on Nov 13.
 * Displays a live countdown to midnight PT with urgency messaging.
 * Uses client:idle hydration — the countdown isn't critical until the user sees it.
 */

import { useState, useEffect, useRef } from 'react';

interface TradeDeadlineHeroProps {
  deadlineMidnightPT: string;
}

function useCountdown(targetISO: string) {
  const [remaining, setRemaining] = useState<number>(() => {
    const diff = new Date(targetISO).getTime() - Date.now();
    return Math.max(0, diff);
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => {
      const diff = new Date(targetISO).getTime() - Date.now();
      setRemaining(Math.max(0, diff));
      if (diff <= 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [targetISO]);

  return remaining;
}

function formatCountdown(ms: number): { hours: string; minutes: string; seconds: string } {
  const totalSec = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  return { hours, minutes, seconds };
}

export default function TradeDeadlineHero({ deadlineMidnightPT }: TradeDeadlineHeroProps) {
  const remaining = useCountdown(deadlineMidnightPT);
  const isExpired = remaining <= 0;
  const { hours, minutes, seconds } = formatCountdown(remaining);

  // Check for reduced motion preference
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className="tdhero" aria-label="Trade deadline countdown">
      <div className="tdhero__header">
        <span className="tdhero__eyebrow">
          {!isExpired && !prefersReducedMotion && (
            <span className="tdhero__pulse" aria-hidden="true" />
          )}
          Trade Deadline — Today
        </span>
      </div>

      <h3 className="tdhero__title">Trade Deadline</h3>

      {!isExpired && (
        <div className="tdhero__countdown" aria-live="polite" aria-atomic="true">
          {prefersReducedMotion ? (
            <p className="tdhero__static-time">Ends at midnight PT</p>
          ) : (
            <div className="tdhero__digits" role="timer">
              <div className="tdhero__digit-group">
                <span className="tdhero__digit">{hours}</span>
                <span className="tdhero__digit-label">Hours</span>
              </div>
              <span className="tdhero__separator" aria-hidden="true">:</span>
              <div className="tdhero__digit-group">
                <span className="tdhero__digit">{minutes}</span>
                <span className="tdhero__digit-label">Min</span>
              </div>
              <span className="tdhero__separator" aria-hidden="true">:</span>
              <div className="tdhero__digit-group">
                <span className="tdhero__digit">{seconds}</span>
                <span className="tdhero__digit-label">Sec</span>
              </div>
            </div>
          )}
        </div>
      )}

      {isExpired ? (
        <p className="tdhero__expired">
          The trade deadline has passed. Rosters are now locked for trades.
        </p>
      ) : (
        <p className="tdhero__message">
          Make your moves before midnight PT. After today, rosters are locked for trades.
        </p>
      )}

      {!isExpired && (
        <a href="/theleague/trade-builder" className="tdhero__cta">
          Open Trade Builder
        </a>
      )}
    </div>
  );
}
