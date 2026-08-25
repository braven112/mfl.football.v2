/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		/** True when accessed via theleague.us — omit /theleague prefix from links */
		hideLeaguePrefix: boolean;
	}
}

interface ImportMetaEnv {
	readonly PUBLIC_VERCEL_ANALYTICS_ID: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

/**
 * Globals the rosters page hangs off `window`.
 *
 * These are not decoration. `rosters.astro`'s inline script re-runs on every
 * ClientRouter navigation back onto the page, and a listener bound to an
 * element that survives the swap would otherwise keep calling the PREVIOUS
 * run's closures. The panel therefore dispatches every handler through
 * `window.__cdpH`, which the newest run reassigns — the indirection is the fix
 * for a stale-closure bug, so do not "simplify" it away. The `__*Bound` flags
 * and the countdown timer handle exist for the same reason: they make a second
 * binding pass idempotent.
 */
interface Window {
  /**
   * Cutdown Plan handler bag. Reassigned on every init so inline `onclick`
   * attributes always reach the current run's closures.
   */
  __cdpH?: Record<string, (...args: any[]) => unknown>;
  /** setInterval handle for the cut-deadline countdown, cleared before re-arming. */
  __cdpCountdownTimer?: ReturnType<typeof setInterval> | null;
  /** One-shot guards so re-init does not stack duplicate listeners. */
  __cdpFlushBound?: boolean;
  __cdpEscBound?: boolean;
  __cdemoEscBound?: boolean;
  /** Published by the Import Rankings layer; absent when the owner has no board. */
  __rosterRankingLookup?: unknown;
  /** Installed by PlayerInjuryModal.astro when that island hydrates. */
  openPlayerInjuryModal?: (injuryData: unknown) => void;
}
