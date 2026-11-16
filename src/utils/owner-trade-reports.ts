/**
 * Owner Trade Reports
 *
 * Aggregates pending trade proposals that owners see while using the app.
 * Each owner can legitimately view their own pending trades — we record the
 * raw MFL rows into a shared Redis hash so the Schefter rumor scanner can
 * learn about proposals even when commissioner lockout blocks league-wide
 * reads.
 *
 * The rumor scanner already implements the cumulative-probability leak model
 * (base probability in scripts/lib/redact-trade-offer.mjs#OFFER_POST_PROBABILITY,
 * codenames, vague framing). This module is just the intake pipe — it never
 * decides what gets published.
 *
 * Hash: `schefter:[<navSlug>:]trade_offers:owner_reports`, one per league
 *   (TheLeague's keeps the legacy unprefixed key)
 *   field: offerId (MFL trade_id)
 *   value: { raw, firstSeenAt, lastSeenAt, reportedBy: [franchiseId, ...] }
 *
 * 30-day TTL matches OFFER_STATE_TTL_SEC in scripts/schefter-rumor-scan.mjs.
 */

import theleagueConfig from '../data/theleague.config.json';
import { LEAGUES, getLeagueById } from '../config/leagues';
import { getRedis } from './redis-client';
import { loadLeagueData } from './league-data';
import { resolveTradeProposer } from './mfl-trade-ops';
import { schefterKey } from '../../scripts/lib/schefter-keys.mjs';

const TTL_SECONDS = 30 * 24 * 60 * 60;

type TeamsConfig = { teams?: Array<{ name?: string; franchiseId?: string }> };

function nameMapOf(config: TeamsConfig | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const team of config?.teams ?? []) {
    if (team?.name && team?.franchiseId) map.set(String(team.name).toLowerCase(), String(team.franchiseId));
  }
  return map;
}

// TheLeague's config is already bundled (src/data); every other league's is
// read from the league-data store by its registry `configPath`, never
// imported, so a new league adds nothing to the function bundle.
const THELEAGUE_NAMES = nameMapOf(theleagueConfig as TeamsConfig);
const loadedNames = new Map<string, Map<string, string>>([[LEAGUES.theleague.id, THELEAGUE_NAMES]]);

/**
 * Team names → franchise ids for a league. MFL's owner view names the
 * proposer only in prose ("X proposed a trade to Y"), so the names come from
 * the league's own config. Empty when it has none.
 */
export async function loadTeamNameMap(leagueId: string): Promise<Map<string, string>> {
  const cached = loadedNames.get(leagueId);
  if (cached) return cached;
  const configPath = getLeagueById(leagueId)?.configPath;
  if (!configPath) return new Map();
  const config = await loadLeagueData<TeamsConfig>(configPath).catch(() => null);
  const map = nameMapOf(config);
  if (map.size > 0) loadedNames.set(leagueId, map);
  return map;
}

/**
 * The league's report hash when it takes reports — its registry
 * `features.tradeRumors` (the "Trade rumors" league setting) is on — else
 * null. TheLeague's key stays byte-identical to the legacy
 * `schefter:trade_offers:owner_reports`; the AFL's is `schefter:afl:…`, the
 * key the rumor scanner already reads for it (OFFER_OWNER_REPORTS_KEY).
 */
export function ownerReportsKeyFor(leagueId: string): string | null {
  const league = getLeagueById(leagueId);
  if (!league?.features?.tradeRumors) return null;
  return schefterKey(league.navSlug, 'trade_offers:owner_reports');
}

/** True when owner reads in this MFL league should be captured at all. */
export function leagueTakesOwnerTradeReports(leagueId: string): boolean {
  return ownerReportsKeyFor(leagueId) !== null;
}

export interface OwnerTradeReport {
  raw: Record<string, unknown>;
  firstSeenAt: number;
  lastSeenAt: number;
  reportedBy: string[];
}

function offerIdOf(raw: Record<string, unknown>): string | null {
  const id = raw.id ?? raw.trade_id;
  if (id == null) return null;
  const s = String(id).trim();
  return s.length > 0 ? s : null;
}

/**
 * MFL's owner-view `pendingTrades` payload omits the `franchise` (originator)
 * field — it only carries `offeredto` (the partner) plus a `description` like
 * "Pacific Pigskins proposed a trade to ...". Mirror the resolver in
 * `resolveTradeProposer` (src/utils/mfl-trade-ops.ts), shared with `/api/trades/pending`, so the rumor scanner's
 * downstream `String(raw.franchise || '').padStart(4, '0')` doesn't collapse
 * to `'0000'` and surface as "Team 0000" in the admin archive.
 */
export function resolveOriginatorFid(
  raw: Record<string, unknown>,
  reportingFranchiseId: string,
  teamNameToFid: Map<string, string> = THELEAGUE_NAMES,
): string {
  const existing = String(raw.franchise ?? '').trim();
  if (existing) return existing.padStart(4, '0');
  return resolveTradeProposer(raw, reportingFranchiseId, teamNameToFid);
}

/**
 * MFL returns different field names for owner-view vs commish-view
 * `pendingTrades`. The rumor scanner expects commish-view shape
 * (`franchise1_gave_up` / `franchise2_gave_up`). Normalize so downstream
 * never has to care about the source.
 *
 * Owner view has `will_give_up` = assets the OWNER gives, `will_receive`
 * = assets the OWNER gets. `franchise` = originator, `offeredto` = recipient.
 * When owner is the originator, will_give_up == franchise1_gave_up.
 * When owner is the recipient, will_give_up == franchise2_gave_up.
 */
function normalizeRaw(
  raw: Record<string, unknown>,
  reportingFranchiseId: string,
  teamNameToFid: Map<string, string>,
): Record<string, unknown> {
  // Even commish-shaped rows can be missing `franchise` if MFL changes the
  // field set; populate it unconditionally so downstream never sees `'0000'`.
  const originator = resolveOriginatorFid(raw, reportingFranchiseId, teamNameToFid);

  if (raw.franchise1_gave_up !== undefined || raw.franchise2_gave_up !== undefined) {
    return originator && !raw.franchise ? { ...raw, franchise: originator } : raw;
  }

  const willGiveUp = raw.will_give_up;
  const willReceive = raw.will_receive;
  if (willGiveUp === undefined && willReceive === undefined) return raw;

  const reporterPadded = String(reportingFranchiseId).padStart(4, '0');
  const ownerIsOriginator = originator === reporterPadded;

  const f1 = ownerIsOriginator ? willGiveUp : willReceive;
  const f2 = ownerIsOriginator ? willReceive : willGiveUp;

  return {
    ...raw,
    franchise: originator || (raw.franchise as string | undefined) || '',
    franchise1_gave_up: f1 ?? '',
    franchise2_gave_up: f2 ?? '',
    franchise2: raw.franchise2 ?? raw.offeredto ?? '',
  };
}

/**
 * Record raw pending-trade rows that an authenticated owner just fetched
 * from MFL. Upserts each offer into the hash — if we've seen it before,
 * refresh `lastSeenAt` and append the reporter; if it's new, stamp
 * `firstSeenAt`. Never throws — log-and-continue on any Redis failure.
 *
 * Gated per league HERE (not at call sites) so no future caller can forget
 * it: a league takes reports only when its registry `features.tradeRumors`
 * is on (the "Trade rumors" league setting, `ownerReportsKeyFor`) and its
 * config names its teams. Rows land in that league's own hash, which is the
 * one its rumor scan reads. Callers pass the league the rows were READ from;
 * anything else is a silent no-op.
 */
export async function reportOwnerTrades(
  franchiseId: string,
  rawTrades: Array<Record<string, unknown>>,
  leagueId: string,
): Promise<void> {
  const hashKey = ownerReportsKeyFor(leagueId);
  if (!hashKey) return;
  if (!franchiseId || !rawTrades || rawTrades.length === 0) return;

  // Without the league's team names a proposer can't be resolved, and the
  // scanner would stamp the row '0000'. Refuse rather than guess.
  const teamNameToFid = await loadTeamNameMap(leagueId);
  if (teamNameToFid.size === 0) {
    console.warn('[owner-trade-reports] no team names for league', leagueId, '— not recording');
    return;
  }

  const redis = await getRedis();
  if (!redis) return;

  const now = Date.now();

  for (const raw of rawTrades) {
    const offerId = offerIdOf(raw);
    if (!offerId) continue;

    try {
      const normalized = normalizeRaw(raw, franchiseId, teamNameToFid);
      const existing = await redis.hget<OwnerTradeReport>(hashKey, offerId);
      const reportedBy = existing?.reportedBy ?? [];
      const next: OwnerTradeReport = {
        raw: normalized,
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        reportedBy: reportedBy.includes(franchiseId)
          ? reportedBy
          : [...reportedBy, franchiseId],
      };
      await redis.hset(hashKey, { [offerId]: next });
    } catch (err) {
      console.warn('[owner-trade-reports] upsert failed for', offerId, err);
    }
  }

  try {
    await redis.expire(hashKey, TTL_SECONDS);
  } catch {
    // non-fatal
  }
}
