/**
 * Trade-Builder Drafts as a Tip Source.
 *
 * Reads each franchise's saved draft trades from `dt:{franchiseId}` (written by
 * src/pages/api/trades/drafts.ts) and projects them into Redis sorted sets that
 * the rumor scanner reads alongside real pending-offer history.
 *
 * Drafts are intentional saves — the owner clicked "save" on a trade they were
 * building. That's a much weaker signal than a submitted offer, but stronger
 * than ephemeral builder activity. So we model drafts as a discounted,
 * shorter-lived input that can NEVER on its own create a rumor (the rumor
 * pipeline only iterates real `offerMap` entries) and can NEVER unlock the
 * `named` escalation tier (capped at `tightened_circle` in the consumer).
 *
 * Reasoning is captured in CLAUDE.md and the rumor-scan Phase 6b block.
 *
 * Redis keys (this module owns the writes):
 *   schefter:tb_drafts:player:{playerId}  ZSET  member="{fid}:{draftId}" score=updatedAt
 *   schefter:tb_drafts:owner:{fid}        ZSET  member=draftId           score=updatedAt
 *
 * Both decay to a 3-day window each run.
 *
 * Pure-ish: requires a redis client, but no file I/O. Caller passes the team
 * map; we walk only the franchise ids the league actually has.
 */

export const TB_DRAFT_PLAYER_KEY_PREFIX = 'schefter:tb_drafts:player:';
export const TB_DRAFT_OWNER_KEY_PREFIX = 'schefter:tb_drafts:owner:';
export const TB_DRAFT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const TB_DRAFT_KEY_TTL_SEC = 7 * 24 * 60 * 60;
/**
 * Soft discount applied when blending draft offerers with real submitted
 * offerers. 1 saved draft = 0.4 of a real offer for count-based tier and
 * probability calculations. Drafts can elevate a player from `base` to
 * `tightened_circle` but never past it — that cap is enforced in the
 * rumor scanner where it has access to both real and draft counts.
 */
export const TB_DRAFT_OFFERER_WEIGHT = 0.4;

/**
 * Walk every franchise's saved drafts hash, refresh the sorted-set windows,
 * and return summary counts for logging.
 *
 * @param {object} args
 * @param {any}    args.redis        Upstash Redis client
 * @param {Map}    args.teams        Map<franchiseId, { division, ... }>
 * @param {boolean} args.dryRun
 * @param {(...a: any[]) => void} [args.log]
 * @param {(...a: any[]) => void} [args.warn]
 * @returns {Promise<{ ownersScanned: number, draftsScanned: number, playerEntries: number }>}
 */
export async function scanDraftTrades({ redis, teams, dryRun, log = () => {}, warn = () => {} }) {
  const summary = { ownersScanned: 0, draftsScanned: 0, playerEntries: 0 };
  if (!redis || !teams) return summary;

  const nowMs = Date.now();
  const windowStart = nowMs - TB_DRAFT_WINDOW_MS;

  for (const [fid] of teams) {
    let drafts;
    try {
      drafts = await redis.get(`dt:${fid}`);
    } catch (err) {
      warn(`  [tb-drafts] read dt:${fid} failed: ${err.message}`);
      continue;
    }
    if (!Array.isArray(drafts) || drafts.length === 0) continue;
    summary.ownersScanned += 1;

    const ownerKey = TB_DRAFT_OWNER_KEY_PREFIX + fid;

    for (const draft of drafts) {
      const updatedAt = Number(draft?.updatedAt ?? draft?.createdAt ?? 0);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;
      // Skip stale drafts — outside the 3-day window.
      if (updatedAt < windowStart) continue;

      const draftId = String(draft?.id ?? '');
      if (!draftId) continue;

      // Identify owner's side of the trade. The franchise that saved the
      // draft is, by definition, one of the two parties — match teamA / teamB
      // by franchiseId. If neither side resolves to the owner, skip; that's
      // a corrupt/abandoned draft (e.g. owner cleared the team selector).
      const sides = [draft.teamA, draft.teamB].filter(Boolean);
      const ownerSide = sides.find((s) => String(s?.franchiseId ?? '').padStart(4, '0') === String(fid).padStart(4, '0'));
      if (!ownerSide) continue;

      // "Players offered" = players on owner's own side. That's the trade-
      // block signal we want — owner is building a draft to ship them out.
      const offered = Array.isArray(ownerSide.playerIds) ? ownerSide.playerIds : [];
      if (offered.length === 0 && (!Array.isArray(ownerSide.draftPicks) || ownerSide.draftPicks.length === 0)) {
        // Empty owner side (e.g. just receiving — that's "interest", not
        // "shopping"; skip for now, scanner doesn't model interest yet).
        continue;
      }
      summary.draftsScanned += 1;

      if (!dryRun) {
        try {
          await redis.zadd(ownerKey, { score: updatedAt, member: draftId });
        } catch (err) {
          warn(`  [tb-drafts] owner zadd failed for ${fid}: ${err.message}`);
        }
      }

      for (const pid of offered) {
        if (!pid) continue;
        const pKey = TB_DRAFT_PLAYER_KEY_PREFIX + pid;
        if (!dryRun) {
          try {
            await redis.zadd(pKey, { score: updatedAt, member: `${fid}:${draftId}` });
            await redis.expire(pKey, TB_DRAFT_KEY_TTL_SEC);
          } catch (err) {
            warn(`  [tb-drafts] player zadd failed for ${pid}: ${err.message}`);
          }
        }
        summary.playerEntries += 1;
      }
    }

    // Trim owner key to the 3-day window and refresh TTL.
    if (!dryRun) {
      try {
        await redis.zremrangebyscore(ownerKey, 0, windowStart);
        await redis.expire(ownerKey, TB_DRAFT_KEY_TTL_SEC);
      } catch (err) {
        warn(`  [tb-drafts] owner trim/expire failed for ${fid}: ${err.message}`);
      }
    }
  }

  log(
    `  [tb-drafts] owners=${summary.ownersScanned} drafts=${summary.draftsScanned} ` +
      `playerEntries=${summary.playerEntries}`,
  );
  return summary;
}

/**
 * Read the set of distinct franchise ids that have a saved draft involving
 * `playerId` within the rolling 3-day window. The rumor scanner blends this
 * with the real-offer offerer set when computing player escalation tier.
 *
 * Pure read — never mutates.
 */
export async function getDraftOfferersForPlayer({ redis, playerId, nowMs = Date.now() }) {
  if (!redis || !playerId) return new Set();
  const key = TB_DRAFT_PLAYER_KEY_PREFIX + playerId;
  const windowStart = nowMs - TB_DRAFT_WINDOW_MS;
  let members = [];
  try {
    members = await redis.zrange(key, windowStart, nowMs, { byScore: true });
  } catch {
    return new Set();
  }
  const fids = new Set();
  for (const m of members ?? []) {
    const fid = String(m).split(':')[0];
    if (fid) fids.add(fid);
  }
  return fids;
}

/**
 * Read the count of distinct draft entries an owner has open in the 3-day
 * window. Returned as a *raw* count — the consumer applies
 * `TB_DRAFT_OFFERER_WEIGHT` when blending with real submitted-offer counts.
 */
export async function getOwnerDraftCount({ redis, franchiseId, nowMs = Date.now() }) {
  if (!redis || !franchiseId) return 0;
  const key = TB_DRAFT_OWNER_KEY_PREFIX + franchiseId;
  const windowStart = nowMs - TB_DRAFT_WINDOW_MS;
  try {
    const members = await redis.zrange(key, windowStart, nowMs, { byScore: true });
    return Array.isArray(members) ? members.length : 0;
  } catch {
    return 0;
  }
}
