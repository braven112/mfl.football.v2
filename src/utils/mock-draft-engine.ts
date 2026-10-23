/**
 * The mock-draft engine: every rule that used to live in PartyKit's
 * `party/draft-room.ts`, as pure functions over a session and a clock.
 *
 * PartyKit kept the draft alive with a process: a `setInterval` that ticked
 * the clock and a microtask chain that ran the AI's picks. A Vercel function
 * has no process between requests, so time is DATA here instead. The session
 * carries the moment its pick clock runs out (`pickDeadline`), and every read
 * first catches up whatever is overdue (`advance`): an expired clock becomes
 * an auto-pick, then the AI teams pick in turn until a human is on the clock
 * or the draft is done. A draft nobody is watching simply stands still, and
 * the next poll replays what should have happened, at the times it should
 * have happened.
 *
 * Nothing here touches Redis — `mock-draft-store.ts` owns storage and the
 * lock, so this file can be tested with nothing but a fake `now`.
 */

import {
  isFranchiseAutoDrafted,
  type MockDraftSession,
  type MockParticipant,
  type MockPick,
} from '../types/draft-room';

/** The session as the engine stores it: the client type plus server-only bookkeeping. */
export type EngineSession = MockDraftSession & {
  /** MFL draft unit, for a league that drafts by conference (the AFL). */
  unit?: string;
  conference?: string | null;
  /** Deleted from its lobby; saves must not list it again. */
  unlisted?: boolean;
};

/** The ranked lists auto-pick reads. Stored apart from the session: it is big and only read to pick. */
export interface MockDraftPool {
  rankedLists?: Record<string, string[]>;
  rankingAssignments?: Record<string, string>;
  defaultRankingSource?: string;
  /** Legacy single list, from sessions created before per-source lists. */
  rankedPlayerIds?: string[];
}

export type MockDraftAction =
  | { type: 'join'; enableAutoPick?: boolean }
  | { type: 'pick'; playerId: string; overallPickNumber?: number }
  | { type: 'toggle-auto' }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'reset' }
  | { type: 'undo' }
  | { type: 'set-timer'; timerSeconds: number }
  | { type: 'set-auto-draft'; targetFranchiseId: string; autoDraft: boolean };

export const MOCK_DRAFT_ACTIONS = new Set<MockDraftAction['type']>([
  'join', 'pick', 'toggle-auto', 'start', 'pause', 'resume', 'skip', 'reset', 'undo',
  'set-timer', 'set-auto-draft',
]);

export type ActionResult = { ok: true; session: EngineSession } | { ok: false; error: string };

const totalPicks = (s: EngineSession) => s.totalRounds * s.picksPerRound;
const onClock = (s: EngineSession) => s.draftOrder[s.currentPickIndex];

/** Does anything need doing before this session can be shown as of `now`? */
export function needsAdvance(session: EngineSession, now: number): boolean {
  if (session.status !== 'active') return false;
  if (session.currentPickIndex >= totalPicks(session)) return true;
  if (session.aiHold) return false;
  if (isFranchiseAutoDrafted(session, onClock(session))) return true;
  return session.pickDeadline == null || session.pickDeadline <= now;
}

/** The player auto-pick takes for the team on the clock. Same lookup order PartyKit used. */
export function chooseAutoPick(session: EngineSession, pool: MockDraftPool): string | undefined {
  const picked = new Set(session.picks.filter((p) => p.playerId).map((p) => p.playerId!));
  const from = (list: string[] | undefined) => list?.find((id) => !picked.has(id));
  const lists = pool.rankedLists ?? {};
  const defaultSource = pool.defaultRankingSource ?? session.defaultRankingSource ?? 'mfl-rookie';
  const assignments = pool.rankingAssignments ?? session.rankingAssignments ?? {};
  const source = assignments[onClock(session)] ?? defaultSource;

  let id = from(lists[source]);
  if (!id && source !== defaultSource) id = from(lists[defaultSource]);
  if (!id) id = from(pool.rankedPlayerIds);
  if (!id) {
    for (const list of Object.values(lists)) {
      id = from(list);
      if (id) break;
    }
  }
  return id;
}

function recordPick(session: EngineSession, playerId: string, isAutoPick: boolean, at: number): void {
  const index = session.currentPickIndex;
  const overallPickNumber = index + 1;
  const round = Math.ceil(overallPickNumber / session.picksPerRound);
  const pick: MockPick = {
    overallPickNumber,
    round,
    pickInRound: overallPickNumber - (round - 1) * session.picksPerRound,
    franchiseId: session.draftOrder[index],
    playerId,
    pickedAt: new Date(at).toISOString(),
    isAutoPick,
  };
  const slot = session.picks.findIndex((p) => p.overallPickNumber === overallPickNumber);
  if (slot === -1) session.picks.push(pick);
  else session.picks[slot] = pick;

  session.currentPickIndex = index + 1;
  session.pickDeadline = null;
  session.aiHold = false;
  if (session.currentPickIndex >= totalPicks(session)) session.status = 'completed';
}

function autoPick(session: EngineSession, pool: MockDraftPool, at: number): void {
  // A synthetic id is the last resort; create tops every list up with the
  // whole pool, so this effectively never fires.
  recordPick(session, chooseAutoPick(session, pool) ?? `auto-${at}`, true, at);
}

/**
 * Catch the session up to `now`. Returns true if anything changed.
 *
 * `at` is the draft's own clock: an expired pick lands at its deadline, not
 * at whenever the next poll happened to arrive, so the clock that follows it
 * starts from there. A draft left alone for ten minutes therefore plays out
 * exactly as it would have with someone watching.
 */
export function advance(session: EngineSession, pool: MockDraftPool, now: number): boolean {
  let changed = false;
  let at = now;
  // Bounded by the number of picks; the guard is only against a bug looping forever.
  for (let guard = totalPicks(session) + 2; guard > 0; guard--) {
    if (session.status !== 'active') break;
    if (session.currentPickIndex >= totalPicks(session)) {
      session.status = 'completed';
      session.pickDeadline = null;
      changed = true;
      break;
    }
    if (session.aiHold) break;
    if (isFranchiseAutoDrafted(session, onClock(session))) {
      autoPick(session, pool, at);
      changed = true;
      continue;
    }
    if (session.pickDeadline == null) {
      session.pickDeadline = at + session.timerSeconds * 1000;
      changed = true;
    }
    if (session.pickDeadline > now) break;
    at = session.pickDeadline;
    autoPick(session, pool, at);
    changed = true;
  }
  return changed;
}

/** Whole-board reset to an empty draft, on the clock from pick one. */
function emptyPicks(session: EngineSession): MockPick[] {
  return Array.from({ length: totalPicks(session) }, (_, i) => {
    const overallPickNumber = i + 1;
    const round = Math.ceil(overallPickNumber / session.picksPerRound);
    return {
      overallPickNumber,
      round,
      pickInRound: overallPickNumber - (round - 1) * session.picksPerRound,
      franchiseId: session.draftOrder[i],
    };
  });
}

/**
 * Apply one owner's action. `actor` is the franchise the SERVER resolved from
 * the signed session — never a field of the message, which PartyKit trusted.
 * The session is mutated in place; the caller saves it on `ok`.
 */
export function applyAction(
  session: EngineSession,
  pool: MockDraftPool,
  actor: string,
  action: MockDraftAction,
  now: number,
): ActionResult {
  const fail = (error: string): ActionResult => ({ ok: false, error });
  const isCreator = actor === session.createdBy;
  const done = (): ActionResult => {
    advance(session, pool, now);
    return { ok: true, session };
  };

  // Overdue work first, so every rule below judges the board as it stands now.
  advance(session, pool, now);

  switch (action.type) {
    case 'join': {
      const existing = session.participants.find((p) => p.franchiseId === actor);
      if (existing) {
        existing.isConnected = true;
        existing.isAutoPickEnabled = action.enableAutoPick ?? existing.isAutoPickEnabled;
      } else {
        const participant: MockParticipant = {
          franchiseId: actor,
          connectedAt: new Date(now).toISOString(),
          isAutoPickEnabled: action.enableAutoPick ?? false,
          isConnected: true,
        };
        session.participants.push(participant);
      }
      // The creator walking in starts a lobby draft — PartyKit did the same.
      if (session.status === 'lobby' && isCreator) session.status = 'active';
      return done();
    }

    case 'pick': {
      if (session.status !== 'active') return fail('Draft is not active');
      const current = onClock(session);
      // A pick the clock already took: the client saw an older board. Refusing
      // keeps a late tap from landing on the user's NEXT pick instead.
      if (
        typeof action.overallPickNumber === 'number' &&
        action.overallPickNumber !== session.currentPickIndex + 1
      ) {
        return fail('That pick is already in — the clock ran out');
      }
      const isOwnPick = current === actor;
      const isCreatorControlled =
        isCreator && (session.aiHold || !isFranchiseAutoDrafted(session, current));
      if (!isOwnPick && !isCreatorControlled) return fail('Not your turn');
      if (typeof action.playerId !== 'string' || !action.playerId) return fail('No player chosen');
      if (session.picks.some((p) => p.playerId === action.playerId)) return fail('Player already drafted');
      recordPick(session, action.playerId, false, now);
      return done();
    }

    case 'toggle-auto': {
      const participant = session.participants.find((p) => p.franchiseId === actor);
      if (!participant) return fail('Join the draft first');
      participant.isAutoPickEnabled = !participant.isAutoPickEnabled;
      return done();
    }

    case 'start':
      if (!isCreator) return fail('Only the session creator can start the draft');
      if (session.status !== 'lobby') return fail('Draft already started');
      session.status = 'active';
      return done();

    case 'pause':
      if (!isCreator) return fail('Only the session creator can pause');
      if (session.status !== 'active') return done();
      session.status = 'paused';
      session.pausedRemainingMs =
        session.pickDeadline != null ? Math.max(0, session.pickDeadline - now) : null;
      session.pickDeadline = null;
      return done();

    case 'resume':
      if (!isCreator) return fail('Only the session creator can resume');
      if (session.status !== 'paused') return done();
      session.status = 'active';
      // Pick up where the clock stopped, not from a fresh full clock.
      session.pickDeadline =
        session.pausedRemainingMs != null && session.pausedRemainingMs > 0
          ? now + session.pausedRemainingMs
          : null;
      session.pausedRemainingMs = null;
      return done();

    case 'skip':
      if (!isCreator) return fail('Only the session creator can skip');
      if (session.status !== 'active') return done();
      autoPick(session, pool, now);
      return done();

    case 'reset':
      if (!isCreator) return fail('Only the session creator can reset');
      session.currentPickIndex = 0;
      session.status = 'active';
      session.picks = emptyPicks(session);
      session.pickDeadline = null;
      session.pausedRemainingMs = null;
      session.aiHold = false;
      return done();

    case 'undo': {
      if (!isCreator) return fail('Only the session creator can go back');
      if (session.currentPickIndex <= 0) return fail('No pick to go back to');
      const lastIndex = session.currentPickIndex - 1;
      const last = session.picks[lastIndex];
      if (last) {
        session.picks[lastIndex] = {
          overallPickNumber: last.overallPickNumber,
          round: last.round,
          pickInRound: last.pickInRound,
          franchiseId: last.franchiseId,
        };
      }
      session.currentPickIndex = lastIndex;
      if (session.status === 'completed') session.status = 'active';
      // A human slot gets a fresh clock; an AI slot waits (see `aiHold`).
      const auto = isFranchiseAutoDrafted(session, onClock(session));
      const fresh = auto ? null : session.timerSeconds * 1000;
      session.aiHold = auto;
      if (session.status === 'paused') {
        session.pickDeadline = null;
        session.pausedRemainingMs = fresh;
      } else {
        session.pickDeadline = fresh == null ? null : now + fresh;
        session.pausedRemainingMs = null;
      }
      return { ok: true, session };
    }

    case 'set-timer': {
      if (!isCreator) return fail('Only the session creator can change the timer');
      const seconds = action.timerSeconds;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
        return fail('Timer must be between 1 and 600 seconds');
      }
      session.timerSeconds = seconds;
      // A running clock restarts at the new length, so a shorter clock bites
      // on the pick that is on the board right now.
      if (session.status === 'active' && session.pickDeadline != null) {
        session.pickDeadline = now + seconds * 1000;
      }
      return done();
    }

    case 'set-auto-draft': {
      if (!isCreator) return fail('Only the session creator can change auto-draft');
      const target = action.targetFranchiseId;
      if (typeof target !== 'string' || !session.draftOrder.includes(target)) return fail('Unknown team');
      session.autoDraft = { ...(session.autoDraft ?? {}), [target]: action.autoDraft === true };
      // Flipping the on-clock team applies at once: to auto hands the pick to
      // the AI, to manual starts that team's clock.
      if (session.status === 'active' && onClock(session) === target) {
        session.pickDeadline = null;
        session.aiHold = false;
      }
      return done();
    }
  }
  return fail('Unknown action');
}
