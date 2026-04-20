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

/**
 * Age-based framing hint for the LLM voice.
 * - `fresh`    : first_seen less than 48h ago → rumor-mill voice (phones ringing)
 * - `lingering`: first_seen 48h+ ago → "offered but phones aren't picking up"
 *
 * No guaranteed post — the per-run dice roll (p=0.0075) still gates emission.
 * Lingering offers can still fail the roll forever; that's the design.
 */
export type TradeOfferFramingHint = 'fresh' | 'lingering';

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
  /**
   * Age-based voice hint resolved from `first_seen` timestamp at scan time.
   * 'fresh' = <48h since first observed, 'lingering' = 48h+.
   */
  framingHint: TradeOfferFramingHint;
  /** Age in ms since first observed — audit / debug only */
  offerAgeMs: number;
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
  /**
   * Division of the TIPSTER's own franchise (resolved server-side from the
   * authed user). Used by the rumor scanner for "reverse-the-lens" framing
   * on hostile tips — "hearing an owner in the [tipsterDivision] isn't happy
   * with the league office" — which passes on the sentiment while
   * redirecting attention to the source's division rather than quoting an
   * insult. Only set for `source: 'web'`.
   */
  tipsterDivision?: string;
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
  /**
   * Phase 7 — Whisper back. Rumor post id this tip is a follow-up to, if any.
   * The scanner groups whisper-backs under a `thread-followup` scope so Schefter
   * opens with continuity language ("Following up on yesterday's chatter…").
   */
  repliesToPostId?: string;
  /**
   * Style Book — the tip text attacks Schefter personally (pejorative against
   * the bot). Set by the detection paths in `scripts/schefter-groupme-listen.mjs`
   * (named, GroupMe) and `src/pages/api/schefter/tip.ts` (anonymous, web).
   * Surfaces on the LLM-facing safe object so HARD RULE 15 can fire the Style
   * Book bit with running-count flavor.
   */
  attackOnSchefter?: true;
  /**
   * Running seasonal count of attacks from this tipster (GroupMe author OR
   * anonymous web-tip hash, scoped to its own leaderboard). Drives the count-
   * based escalation in the Style Book bit (1 = "first entry", 3 = "file's
   * getting thick", 4+ = "power user").
   */
  styleBookCount?: number;
  /**
   * Stable codename for an anonymous web tipster (e.g. "Burner Phone").
   * Set only on `source: 'web'` tips that were flagged as Style Book attacks —
   * gives Schefter a durable handle to reference in posts without revealing
   * the tipster's identity. Resolved at submission time from the existing
   * tipster-codenames system (same key as tipster-stats leaderboard).
   */
  tipsterCodename?: string;
}

/** Max age of a rumor post that whisper-backs can still attach to (ms). */
export const WHISPER_BACK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface RumorPost {
  id: string;
  body: string;
  tipIds: string[];
  hadRogerRiff: boolean;
  postedAt: number;
}

export const TIP_TEXT_MIN = 1;
export const TIP_TEXT_MAX = 500;
