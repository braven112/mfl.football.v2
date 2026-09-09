/**
 * "This owner already has the app" — the record that retires the install
 * banner across every device they sign in on.
 *
 * The client-side pitch (src/utils/pwa-install.ts) can only answer for the
 * browser it is running in: `display-mode: standalone` is false in desktop
 * Chrome even for an owner whose phone has had the app on its Home Screen
 * since August, and Chrome keeps firing `beforeinstallprompt` there because,
 * on THAT device, it genuinely is installable. So a device-local dismissal
 * ("Not now", 60 days, localStorage) cannot express "I have this already" —
 * the owner has to swipe the same banner away on every browser, forever.
 *
 * This is the account-level half. One tiny record per league + franchise:
 *
 *   key:   app:install:{mflLeagueId}:{franchiseId}
 *   value: { installedAt, source }
 *
 * League + franchise ALWAYS come from the signed session JWT at the API
 * layer, never from a request body — both leagues have a franchise 0001, so
 * an unscoped key would let one league's owner silence the other's banner.
 *
 * Degrades to "no record" when Redis is unavailable, which shows the banner
 * rather than hiding it: a storage outage must not quietly cut off the only
 * route an iPhone owner has to notifications at all.
 */

import { getRedis } from './redis-client';

/** How we learned the owner has the app. */
export type InstallSource =
  /** A device reported `display-mode: standalone` — they were IN the app. */
  | 'standalone'
  /** The browser fired `appinstalled` while they were on the site. */
  | 'appinstalled'
  /** They told us, by clicking "I already have it" on the banner. */
  | 'declared';

export interface InstallState {
  /** ISO timestamp of the first report. */
  installedAt: string;
  source: InstallSource;
}

const SOURCES: readonly InstallSource[] = ['standalone', 'appinstalled', 'declared'];

export function isInstallSource(value: unknown): value is InstallSource {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value);
}

/** Redis key for a franchise's install record. */
export function installStateKey(leagueId: string, franchiseId: string): string {
  return `app:install:${leagueId}:${franchiseId}`;
}

/** Coerce whatever came back out of storage into a usable record, or null. */
export function parseInstallState(raw: unknown): InstallState | null {
  const value = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const installedAt = typeof record.installedAt === 'string' ? record.installedAt : '';
  if (!installedAt || Number.isNaN(Date.parse(installedAt))) return null;
  // An unrecognized source is still a real report — a record written by a
  // newer deploy must not read as "never installed" and put the banner back.
  return {
    installedAt,
    source: isInstallSource(record.source) ? record.source : 'declared',
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The stored record, or null when there is none / storage is down. */
export async function readInstallState(
  leagueId: string,
  franchiseId: string,
): Promise<InstallState | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    return parseInstallState(await redis.get<InstallState | string>(installStateKey(leagueId, franchiseId)));
  } catch (err) {
    console.error('[app-install-state] read failed:', err);
    return null;
  }
}

/**
 * Record that the owner has the app. Idempotent and first-write-wins: the
 * FIRST report is the interesting date, and every later page load in the
 * installed app would otherwise rewrite it. Returns the effective record.
 *
 * The write is `SET NX` rather than get-then-set, because an owner reports
 * from more than one place at once by design — a phone opening the installed
 * app while a laptop tab is still open is the ordinary case here, not a
 * contrived race. Both would read no record and the later write would win,
 * which quietly makes "first-write-wins" untrue in exactly the situation it
 * was written for. Same shape as `claimCodename` in schefter-codenames.ts:
 * try to own the key, and read the winner's value when someone else did.
 */
export async function recordInstalled(
  leagueId: string,
  franchiseId: string,
  source: InstallSource,
  now: Date = new Date(),
): Promise<InstallState | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const key = installStateKey(leagueId, franchiseId);
  const next: InstallState = { installedAt: now.toISOString(), source };
  try {
    const wrote = await redis.set(key, JSON.stringify(next), { nx: true });
    if (wrote === 'OK' || wrote === true) return next;
    // Someone got there first — theirs is the record, and it is the one the
    // caller must be told about. A read that comes back unusable still means
    // a record exists, so report ours rather than a false "storage down".
    return parseInstallState(await redis.get<InstallState | string>(key)) ?? next;
  } catch (err) {
    console.error('[app-install-state] write failed:', err);
    return null;
  }
}
