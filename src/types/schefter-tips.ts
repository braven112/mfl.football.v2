/**
 * Schefter Rumor Mill — Tip & Rumor Post Types
 *
 * Anonymous tips submitted by owners via /theleague/schefter/tip are queued
 * in Redis, drained by scripts/schefter-rumor-scan.mjs, and posted to the
 * Schefter feed as a `rumor_mill` transaction subtype.
 *
 * Tipster identity is never stored raw — only the sha256 hash of
 * `${userId}${SCHEFTER_TIPSTER_SALT}` (see utils/schefter-tipster-hash.ts).
 */

export const TIP_TOPICS = ['trade', 'roster', 'prediction', 'commish', 'other'] as const;
export type TipTopic = (typeof TIP_TOPICS)[number];

export const LEAGUE_WIDE_HINT = 'league-wide';
export const COMMISH_HINT = 'commish';

export type TipSource = 'web' | 'groupme' | 'trade_offer';

/**
 * Phase 6 — Trade-Offer Rumors: player-escalation tier.
 *
 * Derived from `schefter:player_offer_history:{playerId}` — count of distinct
 * offering franchises who've shopped a player in the last 21 days.
 * - `base`            : <3 distinct offerers → no player-specific language
 * - `tightened_circle`: =3 distinct offerers → archetype hints allowed ("aging WR")
 * - `named`           : ≥4 distinct offerers → name OK, must use hedges
 */
export type PlayerEscalationTier = 'base' | 'tightened_circle' | 'named';

/** "first_offer" = 1 offer in 7d window, "repeat_offer" = 2-3, "serial" = 4+. */
export type TradeOfferVolumeHint = 'first_offer' | 'repeat_offer' | 'serial';

export interface EscalatedPlayer {
  name: string;
  position: string;
  tier: PlayerEscalationTier;
  /** Count of distinct offering franchises in last 21d (for audit / prompt context) */
  distinctOfferers: number;
}

/**
 * Structured trade-offer tip pushed to `schefter:tips:queue` by the
 * Phase 6b offer-scan step. Unlike web/groupme tips, `text` is empty —
 * the LLM synthesizes the post from the structured redacted fields.
 */
export interface TradeOfferTip extends Omit<Tip, 'source' | 'text'> {
  source: 'trade_offer';
  attributable: false;
  /** Always empty — LLM generates from structured fields below */
  text: '';
  topic: 'trade';
  /** Owner's 7d offer count, bucketed */
  volumeHint: TradeOfferVolumeHint;
  /** Deduped NFL positions involved on either side, e.g. ['RB','WR'] */
  positionTokens: string[];
  /** Pick descriptors with round + year, no slot. e.g. ["2027 1st","2026 3rd"] */
  pickTokens: string[];
  /** Set ONLY when division has had ≥2 offers in the rolling window */
  divisionHint?: string;
  /** Set when escalation tier is tightened_circle or named */
  escalatedPlayer?: EscalatedPlayer;
  /** Raw offer id — audit only, never pass to the LLM */
  offerId: string;
  /** Franchise who originated the offer — audit only, never to LLM */
  offeringFranchiseId: string;
}

export interface Tip {
  /** Unique ID (crypto.randomUUID for web, "gm_{messageId}" for groupme) */
  id: string;
  /** sha256(userId + SCHEFTER_TIPSTER_SALT) for web; omitted/placeholder for groupme */
  hashedOwnerId?: string;
  /** Franchise id (e.g. "0003") or "league-wide" or undefined */
  franchiseHint?: string;
  /** Resolved server-side from franchise config when franchiseHint is a franchise id */
  division?: string;
  topic: TipTopic;
  /** Trimmed, 1–500 chars */
  text: string;
  /** epoch ms */
  submittedAt: number;
  source: TipSource;
  /** true for groupme tips where the author can be named */
  attributable?: boolean;
  /** GroupMe sender display name (only when attributable) */
  author?: string;
  /** GroupMe message id (for dedup & audit) — only set for source === 'groupme' */
  mentionMessageId?: string;
}

export interface RumorPost {
  id: string;
  body: string;
  tipIds: string[];
  hadRogerRiff: boolean;
  postedAt: number;
}

export const TIP_TEXT_MIN = 1;
export const TIP_TEXT_MAX = 500;
