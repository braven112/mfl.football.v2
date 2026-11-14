/**
 * The deadline wrap-up: Schefter's one post about the deals that did NOT get
 * done before the trade deadline.
 *
 * Brandon (2026-11-14), after a post-deadline "four offers are circling… more
 * to come": once the deadline passes, put the pending offers in context —
 * many deals were still on the table and did not get done — and never imply
 * more trades are coming. Then, per offer:
 *   - the player in it was since traded elsewhere → a MISSED OPPORTUNITY;
 *   - he was not, and rosters carry over (contracts / keepers) → the deal may
 *     still MATERIALIZE IN SOME FORM IN THE OFFSEASON;
 *   - a league whose rosters do not carry over has no offseason to point to,
 *     so the dead ends are just dead ends.
 *
 * Teams are never named. A proposal that never executed is private between
 * two owners; the wrap names at most a few players (the marquee one per deal),
 * which is what the trade-offer lane's own disclosure ladder ends at.
 *
 * Pure: the scanner gathers offers, rosters and trades and passes them in.
 */

import { deadOfferReason, offerPlayerIds } from './schefter-trading-window.mjs';
import { tradeSignatureOf } from './schefter-offer-beats.mjs';

/** How long after the deadline the wrap may still go out (a missed run is not fatal). */
export const DEADLINE_WRAP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** The run-up whose completed trades the wrap counts. */
export const DEADLINE_RUNUP_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * @param {{
 *   offers: Array<Record<string, any>>,
 *   cutoffMs: number,
 *   completedTrades: Array<Record<string, any>>,
 *   rosterOwnerByPlayerId?: Map<string, string>,
 *   lastTradedAt?: Map<string, number>,
 *   playerMap?: Map<string, { name?: string, position?: string }>,
 *   adpRankByPlayerId?: Map<string, number>,
 *   rostersCarryOver: boolean,
 * }} args
 */
export function buildDeadlineWrapFacts({
  offers,
  cutoffMs,
  completedTrades,
  rosterOwnerByPlayerId,
  lastTradedAt,
  playerMap,
  adpRankByPlayerId,
  rostersCarryOver,
}) {
  const completedSignatures = new Set(completedTrades.map((t) => tradeSignatureOf(t)).filter(Boolean));
  const runupStart = cutoffMs - DEADLINE_RUNUP_MS;
  // No upper bound at the cutoff: a deal only has to be ACCEPTED before the
  // deadline, and the commissioner may approve (process) it after (Brandon,
  // 2026-11-14). MFL stamps the processing time, so a trade stamped after the
  // cutoff is still a deadline deal, never a late one. Trading is closed, so
  // nothing stamped after the cutoff can be a new deal.
  const completedInRunup = completedTrades.filter((t) => {
    const ms = Number(t?.timestamp) * 1000;
    return Number.isFinite(ms) && ms >= runupStart;
  }).length;

  const nameOf = (id) => {
    const raw = playerMap?.get?.(id)?.name;
    if (!raw) return null;
    // MFL stores "Last, First".
    const [last, first] = String(raw).split(',').map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  };
  const marquee = (ids) => ids
    .filter((id) => nameOf(id))
    .sort((a, b) => (adpRankByPlayerId?.get?.(a) ?? 1e9) - (adpRankByPlayerId?.get?.(b) ?? 1e9))[0] ?? null;

  const seen = new Set();
  const missed = [];
  const stillAlive = [];
  for (const raw of offers) {
    // Open AT the deadline: made before it, not executed, not expired before it.
    const proposedMs = Number(raw?.timestamp) * 1000;
    if (!Number.isFinite(proposedMs) || proposedMs <= 0 || proposedMs > cutoffMs) continue;
    const expiresMs = Number(raw?.expires) * 1000;
    if (Number.isFinite(expiresMs) && expiresMs > 0 && expiresMs <= cutoffMs) continue;
    const sig = tradeSignatureOf(raw);
    if (sig && completedSignatures.has(sig)) continue;
    // One deal, once — the same proposal can arrive from MFL and an owner report.
    const key = sig ?? String(raw?.id ?? '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    const ids = offerPlayerIds(raw);
    const dead = deadOfferReason(raw, { rosterOwnerByPlayerId, lastTradedAt });
    if (dead) {
      // The player who moved is the story of a missed opportunity.
      const moved = ids.find((id) => (lastTradedAt?.get?.(id) ?? 0) > proposedMs) ?? marquee(ids);
      missed.push({ player: moved ? nameOf(moved) : null });
    } else {
      const star = marquee(ids);
      stillAlive.push({ player: star ? nameOf(star) : null });
    }
  }

  const uniqueNames = (rows) => [...new Set(rows.map((r) => r.player).filter(Boolean))];
  return {
    openAtDeadline: missed.length + stillAlive.length,
    completedInRunup,
    rostersCarryOver,
    missedPlayers: uniqueNames(missed).slice(0, 2),
    missedCount: missed.length,
    stillAlivePlayers: uniqueNames(stillAlive).slice(0, 2),
    stillAliveCount: stillAlive.length,
  };
}

/** Nothing worth a wrap: no deal was left open and no trade got done. */
export function wrapHasStory(facts) {
  return facts.openAtDeadline > 0 || facts.completedInRunup > 0;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The deterministic version — used when the model is unavailable, and as the model's floor. */
export function deadlineWrapTemplate(facts, cutoffLabel) {
  const parts = [];
  const when = cutoffLabel ? `The trade deadline came and went (${cutoffLabel}).` : 'The trade deadline came and went.';
  parts.push(when);
  if (facts.completedInRunup > 0) {
    parts.push(`${plural(facts.completedInRunup, 'deal', 'deals')} got done in the final stretch.`);
  }
  if (facts.openAtDeadline > 0) {
    parts.push(`${plural(facts.openAtDeadline, 'offer was', 'offers were')} still on the table when the clock hit zero, and none of them got done.`);
  }
  if (facts.missedPlayers.length > 0) {
    parts.push(facts.missedPlayers.length > 1
      ? `The ${facts.missedPlayers.join(' and ')} talks are missed opportunities now. Both were traded elsewhere first.`
      : `The ${facts.missedPlayers[0]} talks are a missed opportunity now. He was traded elsewhere first.`);
  }
  if (facts.rostersCarryOver && facts.stillAlivePlayers.length > 0) {
    parts.push(`Keep an eye on ${facts.stillAlivePlayers.join(' and ')} this offseason. Those conversations don't have to be over.`);
  }
  return parts.join(' ');
}

export function deadlineWrapSystemPrompt() {
  return `You are Claude Schefter, a dynasty fantasy football beat reporter. File ONE short deadline wrap-up post (2-3 sentences, each short) about the trade deadline that just passed.

RULES:
- Trading is CLOSED. Talk about trades only in the past tense. NEVER say or imply a trade is coming, being worked on, imminent, or "more to come".
- Lead with the context: the deadline passed, and many deals that were on the table did not get done before it.
- Use ONLY the numbers and player names in the FACTS. Never invent a number, name, team or reason.
- NEVER name a fantasy team or owner. You may name the players listed in FACTS.
- missedPlayers: offers built around a player who was traded elsewhere first. Frame them as a missed opportunity.
- stillAlivePlayers: only when rostersCarryOver is true. Those deals may still materialize in some form in the offseason; say so as possibility, never as a report that talks are ongoing.
- When rostersCarryOver is false, do not mention the offseason.
- Output JSON only: {"post": "<text>"}.`;
}

export function deadlineWrapUserMessage(facts, cutoffLabel) {
  return `FACTS:\n${JSON.stringify({ deadline: cutoffLabel, ...facts }, null, 2)}\n\nWrite the post.`;
}
