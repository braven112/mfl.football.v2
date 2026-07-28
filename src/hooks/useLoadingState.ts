/**
 * useLoadingState — React hook that drives elapsed-time loading-tier
 * escalation, replacing scattered `isLoading` booleans.
 *
 * The tier comes from `resolveLoadingTier` (the one escalation rule of the
 * loading system — see docs/claude/loading-standards.md). The hook schedules
 * a re-resolve at each threshold boundary, so a component simply renders
 * whatever `tier` says:
 *
 *   const { isLoading, tier, start, stop } = useLoadingState('content');
 *   ...
 *   start();
 *   await fetch(...);
 *   stop();
 *
 *   {isLoading && tier === 'branded' && <BrandedMoment ... />}
 *   {isLoading && tier !== 'branded' && <ThinkingDots ... />}
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LOADING_THRESHOLDS,
  resolveLoadingTier,
  type LoadingContext,
  type LoadingTier,
} from '../utils/loading-tier';

export interface LoadingState {
  /** True between start() and stop(). */
  isLoading: boolean;
  /** Current indicator tier for the elapsed wait ('none' when idle). */
  tier: LoadingTier;
  /** Mark the start of a wait. Safe to call again to restart the clock. */
  start: () => void;
  /** Mark the end of the wait. */
  stop: () => void;
}

export function useLoadingState(context: LoadingContext = 'content'): LoadingState {
  const [isLoading, setIsLoading] = useState(false);
  const [tier, setTier] = useState<LoadingTier>('none');
  const startedAtRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  const start = useCallback(() => {
    clearTimers();
    startedAtRef.current = Date.now();
    setIsLoading(true);
    setTier(resolveLoadingTier(0, context));

    // Re-resolve exactly at each threshold boundary — no polling.
    const boundaries = [
      LOADING_THRESHOLDS.optimistic,
      LOADING_THRESHOLDS.inline,
      LOADING_THRESHOLDS.branded,
    ];
    for (const ms of boundaries) {
      timersRef.current.push(
        window.setTimeout(() => {
          if (startedAtRef.current === null) return;
          setTier(resolveLoadingTier(Date.now() - startedAtRef.current, context));
        }, ms),
      );
    }
  }, [context, clearTimers]);

  const stop = useCallback(() => {
    clearTimers();
    startedAtRef.current = null;
    setIsLoading(false);
    setTier('none');
  }, [clearTimers]);

  // Clean up pending timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  return { isLoading, tier, start, stop };
}
