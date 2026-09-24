/**
 * Which free agents MFL has LOCKED — players who cannot be added right now,
 * most often because they were recently dropped (the AFL locks a dropped player
 * until the next Sunday kickoff; TheLeague until Sunday 10:15 PT).
 *
 * MFL states this itself, so nothing here derives it from a calendar:
 * `export?TYPE=freeAgents` tags each locked row `status: "locked"`, which is
 * what its own add/drop page renders as the `*` after a name. Trying to add one
 * anyway is refused by MFL, and before this reader existed that refusal reached
 * the owner as a bare "Claim failed (HTTP 502)".
 *
 * AVAILABILITY IS PER UNIT. The AFL answers one `leagueUnit` per conference
 * (`CONFERENCE00`, `CONFERENCE01`) and the same player can be locked in one and
 * absent (rostered) in the other — a 49ers DEF dropped in the AL was locked
 * there and held in the NL. So the result is keyed by unit, and the key is the
 * conference id the rest of the app uses ('00', '01'); a single-pool league
 * (TheLeague, unit `LEAGUE`) keys its one list under ''.
 */
import { buildMflExportUrl } from './mfl-url';
import { fetchWithTimeout } from './fetch-with-timeout';

/** `{ [unitKey]: Set<playerId> }` — '' for a single-pool league, else the conference id. */
export type LockedPlayersByUnit = Record<string, Set<string>>;

/** Unit key for a `leagueUnit.unit` label: `CONFERENCE00` → '00', `LEAGUE` → ''. */
export function lockedUnitKey(unit: unknown): string {
  const m = /^CONFERENCE(\w+)$/i.exec(String(unit ?? ''));
  return m ? m[1] : '';
}

/**
 * Parse a `freeAgents` export into the locked ids per unit. Null when the
 * payload is not a freeAgents answer at all (MFL errors come back as HTTP 200
 * with an `error` body) — null is "unknown", never "nobody is locked".
 */
export function parseLockedPlayers(json: unknown): LockedPlayersByUnit | null {
  const fa = (json as { freeAgents?: { leagueUnit?: unknown } } | null)?.freeAgents;
  if (!fa || fa.leagueUnit == null) return null;
  const units = Array.isArray(fa.leagueUnit) ? fa.leagueUnit : [fa.leagueUnit];
  const out: LockedPlayersByUnit = {};
  for (const u of units as Array<{ unit?: unknown; player?: unknown }>) {
    const key = lockedUnitKey(u?.unit);
    const set = (out[key] ??= new Set<string>());
    const players = Array.isArray(u?.player) ? u.player : u?.player ? [u.player] : [];
    for (const p of players as Array<{ id?: unknown; status?: unknown }>) {
      if (p?.id != null && String(p.status ?? '').toLowerCase() === 'locked') set.add(String(p.id));
    }
  }
  return out;
}

/** Whether `playerId` is locked in the unit that governs `conferenceId` (null = single pool). */
export function isPlayerLocked(
  locked: LockedPlayersByUnit | null,
  playerId: string,
  conferenceId: string | null,
): boolean {
  if (!locked) return false;
  return locked[conferenceId ?? '']?.has(String(playerId)) ?? false;
}

// One MFL read per league per warm instance per minute — the lock list only
// moves on a drop or at the lock's expiry, and the claim route re-reads fresh.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: LockedPlayersByUnit | null }>();

/**
 * Fetch the league's locked free agents. Returns null on any failure — callers
 * must treat that as "unknown" and carry on (the page shows no lock icons, the
 * claim route lets MFL decide), never as a reason to refuse.
 *
 * `fresh` skips the cache: the claim route is about to write, and a lock that
 * lifted (or landed) in the last minute should not decide it.
 */
export async function fetchLockedPlayers(
  leagueId: string,
  year: number | string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<LockedPlayersByUnit | null> {
  const key = `${leagueId}:${year}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: LockedPlayersByUnit | null = null;
  try {
    const url = buildMflExportUrl({
      type: 'freeAgents',
      leagueId,
      year,
      params: { _: fresh ? Date.now() : undefined },
    });
    const res = await fetchWithTimeout(url, { timeoutMs: 5000 });
    if (res.ok) value = parseLockedPlayers(await res.json());
  } catch (err) {
    console.warn('[mfl-locked-players] freeAgents read failed:', err);
  }
  // Only a successful read is cached for the full TTL; a failure retries next call.
  if (value) cache.set(key, { at: Date.now(), value });
  return value;
}
