/**
 * Loading tier resolution — the one escalation rule of the loading system.
 *
 * Given how long the user has actually waited (and whether they're waiting on
 * content vs. a discrete action), return which indicator to show. This is the
 * pure function the whole standard keys off; see docs/claude/loading-standards.md.
 *
 * Thresholds live HERE and nowhere else.
 */

export type LoadingContext = 'content' | 'discreteAction';

export type LoadingTier =
  | 'none'          // < 0.3s — show nothing
  | 'optimistic'    // 0.3–1s — show result, reconcile in background
  | 'skeleton'      // 1–10s, content load
  | 'buttonSpinner' // 1–10s, discrete action
  | 'branded';      // 10s+ — branded "on the wire" moment

/** Perceptual thresholds in milliseconds. */
export const LOADING_THRESHOLDS = {
  /** Below this, never show a loader — it would flash and read as a glitch. */
  optimistic: 300,
  /** Below this it still feels instant; above, signal that work is happening. */
  inline: 1000,
  /** Above this, attention is at risk — escalate to the branded moment. */
  branded: 10_000,
} as const;

/**
 * Resolve the loading tier for an elapsed wait.
 *
 * @param elapsedMs   milliseconds the user has been waiting (>= 0)
 * @param context     'content' (page/list/table) or 'discreteAction' (submit/login)
 */
export function resolveLoadingTier(
  elapsedMs: number,
  context: LoadingContext = 'content',
): LoadingTier {
  if (elapsedMs < LOADING_THRESHOLDS.optimistic) return 'none';
  if (elapsedMs < LOADING_THRESHOLDS.inline) return 'optimistic';
  if (elapsedMs < LOADING_THRESHOLDS.branded) {
    return context === 'discreteAction' ? 'buttonSpinner' : 'skeleton';
  }
  return 'branded';
}
