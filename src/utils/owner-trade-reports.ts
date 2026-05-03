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
 * (p=0.0075/run, codenames, vague framing). This module is just the intake
 * pipe — it never decides what gets published.
 *
 * Hash: `schefter:trade_offers:owner_reports`
 *   field: offerId (MFL trade_id)
 *   value: { raw, firstSeenAt, lastSeenAt, reportedBy: [franchiseId, ...] }
 *
 * 30-day TTL matches OFFER_STATE_TTL_SEC in scripts/schefter-rumor-scan.mjs.
 */

import leagueConfig from '../data/theleague.config.json';

const HASH_KEY = 'schefter:trade_offers:owner_reports';
const TTL_SECONDS = 30 * 24 * 60 * 60;

export interface OwnerTradeReport {
  raw: Record<string, unknown>;
  firstSeenAt: number;
  lastSeenAt: number;
  reportedBy: string[];
}

type RedisClient = {
  hget: <T>(key: string, field: string) => Promise<T | null>;
  hset: (key: string, fieldValues: Record<string, unknown>) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

let _redis: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[owner-trade-reports] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

function offerIdOf(raw: Record<string, unknown>): string | null {
  const id = raw.id ?? raw.trade_id;
  if (id == null) return null;
  const s = String(id).trim();
  return s.length > 0 ? s : null;
}

const teamNameToFid = new Map<string, string>();
for (const team of (leagueConfig as { teams?: Array<{ name?: string; franchiseId?: string }> }).teams ?? []) {
  if (team?.name && team?.franchiseId) {
    teamNameToFid.set(String(team.name).toLowerCase(), String(team.franchiseId));
  }
}

/**
 * MFL's owner-view `pendingTrades` payload omits the `franchise` (originator)
 * field — it only carries `offeredto` (the partner) plus a `description` like
 * "Pacific Pigskins proposed a trade to ...". Mirror the resolver in
 * `src/pages/api/trades/pending.ts#resolveProposer` so the rumor scanner's
 * downstream `String(raw.franchise || '').padStart(4, '0')` doesn't collapse
 * to `'0000'` and surface as "Team 0000" in the admin archive.
 */
export function resolveOriginatorFid(
  raw: Record<string, unknown>,
  reportingFranchiseId: string,
): string {
  const reporterPadded = String(reportingFranchiseId).padStart(4, '0');
  const existing = String(raw.franchise ?? '').trim();
  if (existing) return existing.padStart(4, '0');

  const partner = String(raw.offeredto ?? raw.franchise2 ?? '').trim().padStart(4, '0');
  // Owner view: `offeredto` is always the counter-party. If the reporter is
  // not the partner, the reporter authored the offer.
  if (partner && partner !== reporterPadded) return reporterPadded;

  // Reporter is the recipient — pull the proposer's name from the description.
  const desc = String(raw.description ?? '');
  const match = desc.match(/^(.+?)\s+proposed a trade to\s/i);
  if (match) {
    const fid = teamNameToFid.get(match[1].trim().toLowerCase());
    if (fid) return fid.padStart(4, '0');
  }
  return '';
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
): Record<string, unknown> {
  // Even commish-shaped rows can be missing `franchise` if MFL changes the
  // field set; populate it unconditionally so downstream never sees `'0000'`.
  const originator = resolveOriginatorFid(raw, reportingFranchiseId);

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
 */
export async function reportOwnerTrades(
  franchiseId: string,
  rawTrades: Array<Record<string, unknown>>,
): Promise<void> {
  if (!franchiseId || !rawTrades || rawTrades.length === 0) return;

  const redis = await getRedis();
  if (!redis) return;

  const now = Date.now();

  for (const raw of rawTrades) {
    const offerId = offerIdOf(raw);
    if (!offerId) continue;

    try {
      const normalized = normalizeRaw(raw, franchiseId);
      const existing = await redis.hget<OwnerTradeReport>(HASH_KEY, offerId);
      const reportedBy = existing?.reportedBy ?? [];
      const next: OwnerTradeReport = {
        raw: normalized,
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        reportedBy: reportedBy.includes(franchiseId)
          ? reportedBy
          : [...reportedBy, franchiseId],
      };
      await redis.hset(HASH_KEY, { [offerId]: next });
    } catch (err) {
      console.warn('[owner-trade-reports] upsert failed for', offerId, err);
    }
  }

  try {
    await redis.expire(HASH_KEY, TTL_SECONDS);
  } catch {
    // non-fatal
  }
}
