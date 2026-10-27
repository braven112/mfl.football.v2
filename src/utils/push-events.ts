/**
 * League events → alerts, for any MFL league.
 *
 * The one call every MFL Football app feature makes when something happens
 * that another owner should hear about: a trade offered or accepted, a
 * waiver run, a chat message, a draft pick that puts someone on the clock.
 * Two callers, one function:
 *
 *   - INSTANT: an app endpoint (trades, chat, draft) calls it right after MFL
 *     confirms the action the owner took in the app.
 *   - CHECKER: the one-minute MFL checker (the owner's 2026-10-27 choice)
 *     calls it for the same events when they happen on MFL's own site.
 *
 * Both report the same event under the same `key` (the id MFL gives it), and
 * the first to claim that key sends; the other is a no-op. So an action taken
 * in the app never alerts twice when the checker sees it a minute later.
 *
 * Delivery goes through `sendPushToFranchise`, the one door, so an owner's
 * settings, staging suppression and league-name scrubbing all apply. It never
 * throws: a caller's write already succeeded and must not fail on an alert.
 */

import { getRedis } from './redis-client';
import { sendPushToFranchise, type PushPayload } from './push-sender';

export type LeagueEvent =
  | {
      kind: 'trade-offer';
      leagueId: string;
      /** MFL's trade id — the same one MFL's pendingTrades export lists. */
      key: string;
      fromFranchiseId: string;
      toFranchiseId: string;
      /** Who offered, as the league knows them, e.g. "Pacific Pigskins". */
      fromName: string;
      /** One line, e.g. "Your Jefferson for their Chase and a 2nd". */
      summary?: string;
    }
  | {
      kind: 'trade-accepted';
      leagueId: string;
      /** The trade transaction's id. */
      key: string;
      /** Who offered — the owner this alert is for. */
      toFranchiseId: string;
      fromName: string;
      summary?: string;
    }
  | {
      kind: 'waiver-result';
      leagueId: string;
      /** The waiver run, e.g. its transaction batch timestamp. */
      key: string;
      franchiseId: string;
      /** Player names the owner got. */
      added: string[];
      /** Player names the owner lost a claim on, when known. */
      missed?: string[];
    }
  | {
      kind: 'chat';
      leagueId: string;
      /** The message's id in MFL's chat. */
      key: string;
      fromFranchiseId: string;
      fromName: string;
      text: string;
      /** Every franchise in the league; the sender is left out here. */
      franchiseIds: string[];
    }
  | {
      kind: 'draft-on-clock';
      leagueId: string;
      /** The franchise now on the clock. */
      franchiseId: string;
      overall: number;
      round: number;
      pick: number;
      /**
       * The draft board, when the league drafts on more than one (the AFL's
       * conferences each count overall from 1): the room's `unit`.
       */
      unit?: string;
    };

interface Alert {
  franchiseId: string;
  category: string;
  payload: PushPayload;
}

/** Room left on a lock screen; longer chat lines are cut with an ellipsis. */
const CHAT_PREVIEW = 140;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function names(list: string[]): string {
  if (list.length <= 2) return list.join(' and ');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The key two callers agree on. Pure. */
export function eventKey(event: LeagueEvent): string {
  return event.kind === 'draft-on-clock'
    ? `draft-on-clock:${event.unit ? `${event.unit}:` : ''}${event.overall}`
    : `${event.kind}:${event.key}`;
}

/**
 * Who hears about it, and what they read. Pure — the wording lives here so
 * the instant path and the checker cannot word one event two ways.
 */
export function alertsFor(event: LeagueEvent): Alert[] {
  const tag = (suffix: string) => `${event.kind}-${event.leagueId}-${suffix}`;
  switch (event.kind) {
    case 'trade-offer':
      return [{
        franchiseId: event.toFranchiseId,
        category: 'trade-offer',
        payload: {
          title: `Trade offer from ${event.fromName}`,
          body: event.summary ? clip(event.summary, CHAT_PREVIEW) : 'Open the app to see it and respond.',
          tag: tag(event.key),
        },
      }];
    case 'trade-accepted':
      return [{
        franchiseId: event.toFranchiseId,
        category: 'trade-accepted',
        payload: {
          title: `${event.fromName} accepted your trade`,
          body: event.summary ? clip(event.summary, CHAT_PREVIEW) : 'The trade is done.',
          tag: tag(event.key),
        },
      }];
    case 'waiver-result': {
      if (event.added.length === 0 && !(event.missed?.length)) return [];
      const body = event.added.length > 0
        ? `You got ${names(event.added)}.`
        : `Your claims didn't go through: ${names(event.missed ?? [])}.`;
      return [{
        franchiseId: event.franchiseId,
        category: 'waiver-result',
        payload: { title: 'Waivers are in', body, tag: tag(event.key) },
      }];
    }
    case 'chat':
      return [...new Set(event.franchiseIds)]
        .filter((id) => id && id !== event.fromFranchiseId)
        .map((franchiseId) => ({
          franchiseId,
          category: 'league-chat',
          payload: {
            title: event.fromName,
            body: clip(event.text, CHAT_PREVIEW),
            // One chat thread per league collapses into one notification.
            tag: `chat-${event.leagueId}`,
          },
        }));
    case 'draft-on-clock':
      return [{
        franchiseId: event.franchiseId,
        category: 'draft-on-clock',
        payload: {
          title: "You're on the clock",
          body: `Round ${event.round}, pick ${event.pick} (${event.overall} overall) is yours.`,
          tag: tag('draft'),
        },
      }];
  }
}

/** Long enough to outlive the checker's look-back, short enough not to pile up. */
const CLAIM_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Claim an event so it is sent once. True when this caller should send.
 * Without Redis there is nothing to dedupe against; send rather than drop.
 */
async function claim(event: LeagueEvent): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return true;
    const ok = await redis.set(`push:evt:${event.leagueId}:${eventKey(event)}`, '1', {
      nx: true,
      ex: CLAIM_TTL_SECONDS,
    });
    return ok === 'OK';
  } catch (e) {
    console.warn('[push-events] claim failed:', e);
    return true;
  }
}

/** Send an event's alerts, once. Never throws. Returns how many phones/browsers accepted it. */
export async function notifyLeagueEvent(event: LeagueEvent): Promise<number> {
  try {
    if (!/^\d+$/.test(event.leagueId)) return 0;
    const alerts = alertsFor(event);
    if (alerts.length === 0) return 0;
    if (!(await claim(event))) return 0;
    const results = await Promise.all(
      alerts.map((a) => sendPushToFranchise(event.leagueId, a.franchiseId, a.payload, a.category)),
    );
    return results.reduce((n, r) => n + r.sent, 0);
  } catch (e) {
    console.warn('[push-events] notify failed:', e);
    return 0;
  }
}
