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
  /**
   * The page's SSR reference instant (honors ?testDate=). When the client's
   * real clock is far from this instant (test mode), the countdown ticks
   * against the reference clock instead of Date.now().
   */
  referenceNowISO?: string;
}

/**
 * Skew beyond this means the page was rendered with ?testDate= — anything
 * smaller is just SSR-to-hydration latency and the real clock wins.
 */
const TEST_CLOCK_SKEW_MS = 60_000;

/**
 * Returns ms remaining, or null before mount. The countdown is deliberately
 * client-only: SSR computes time from the page's reference date while the
 * client uses Date.now(), so any time-derived text in the server HTML would
 * intermittently mismatch at hydration (wildly so under ?testDate=).
 */
function useCountdown(targetISO: string, referenceNowISO?: string) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const targetMs = new Date(targetISO).getTime();
    let clockOffset = 0;
    if (referenceNowISO) {
      const skew = Date.now() - new Date(referenceNowISO).getTime();
      if (Math.abs(skew) > TEST_CLOCK_SKEW_MS) clockOffset = skew;
    }

    const tick = () => {
      const diff = targetMs - (Date.now() - clockOffset);
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
  }, [targetISO, referenceNowISO]);

  return remaining;
}

function formatCountdown(ms: number | null): { hours: string; minutes: string; seconds: string } {
  if (ms === null) return { hours: '--', minutes: '--', seconds: '--' };
  const totalSec = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  return { hours, minutes, seconds };
}

export default function TradeDeadlineHero({ deadlineMidnightPT, referenceNowISO }: TradeDeadlineHeroProps) {
  const remaining = useCountdown(deadlineMidnightPT, referenceNowISO);
  // Pre-mount (remaining === null) renders the not-expired layout with
  // placeholder digits — identical on server and client, so hydration is stable.
  const isExpired = remaining !== null && remaining <= 0;
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
