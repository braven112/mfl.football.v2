/**
 * useMockDraftPoll
 *
 * Keeps a mock (or best-ball official) draft board in step with the server by
 * polling `/api/mock-draft/session` about once a second, and sends the
 * owner's actions to `/api/mock-draft/action`. This replaced the PartyKit
 * socket when its host went dark (Oct 2026); the server side is plain Redis.
 *
 * The pick clock is not ticked by the server any more. The session carries
 * the moment the clock runs out (`pickDeadline`), and this hook counts down
 * to it locally against the server's clock, so the countdown stays smooth
 * between polls and does not trust the phone's own time.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { MockDraftSession, DraftRoomPick, DraftRoomAction } from '../types/draft-room';

interface UseMockDraftPollOptions {
  sessionId: string;
  franchiseId: string;
  dispatch: React.Dispatch<DraftRoomAction>;
  /** Whether this hook should be active (false = no polling) */
  enabled: boolean;
}

const ACTIVE_POLL_MS = 1000;
const HIDDEN_POLL_MS = 5000;
const IDLE_POLL_MS = 10000;

/** Convert MockDraftSession picks → DraftRoomPick[] for the shared board/pool */
function convertMockPicks(session: MockDraftSession): DraftRoomPick[] {
  return session.picks.map((p) => ({
    round: p.round,
    pickInRound: p.pickInRound,
    overallPickNumber: p.overallPickNumber,
    franchiseId: p.franchiseId,
    playerId: p.playerId || '',
    timestamp: p.pickedAt
      ? String(Math.floor(new Date(p.pickedAt).getTime() / 1000))
      : '',
    comments: p.isAutoPick ? '[Auto-pick]' : '',
    isTraded: false,
  }));
}

export function useMockDraftPoll({ sessionId, franchiseId, dispatch, enabled }: UseMockDraftPollOptions) {
  const sessionRef = useRef<MockDraftSession | null>(null);
  /** serverNow − Date.now(), from the latest response. */
  const offsetRef = useRef(0);
  const pickInFlightRef = useRef(false);
  /** Report a missing session once, not on every poll. */
  const missingRef = useRef(false);
  /** Lets an action response trigger an immediate re-render of the clock. */
  const clockRef = useRef(-1);

  const tickClock = useCallback(() => {
    const s = sessionRef.current;
    let seconds = 0;
    if (s?.status === 'active' && s.pickDeadline != null) {
      seconds = Math.max(0, Math.ceil((s.pickDeadline - (Date.now() + offsetRef.current)) / 1000));
    } else if (s?.status === 'paused' && s.pausedRemainingMs != null) {
      seconds = Math.ceil(s.pausedRemainingMs / 1000);
    }
    if (seconds !== clockRef.current) {
      clockRef.current = seconds;
      dispatch({ type: 'MOCK_CLOCK_TICK', secondsRemaining: seconds });
    }
  }, [dispatch]);

  /** Apply a session from any response, dropping one older than what is on screen. */
  const apply = useCallback(
    (session: MockDraftSession, serverNow: number) => {
      offsetRef.current = serverNow - Date.now();
      const prev = sessionRef.current;
      const sameDraft = prev && prev.createdAt === session.createdAt;
      if (sameDraft && (session.version ?? 0) < (prev.version ?? 0)) return;
      sessionRef.current = session;
      if (!sameDraft || session.version !== prev.version) {
        dispatch({ type: 'MOCK_SESSION_SYNC', session });
        dispatch({ type: 'POLL_SUCCESS', picks: convertMockPicks(session) });
      }
      tickClock();
    },
    [dispatch, tickClock],
  );

  const post = useCallback(
    async (msg: Record<string, unknown>, quiet = false) => {
      try {
        const res = await fetch('/api/mock-draft/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...msg, sessionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.session) apply(data.session, data.serverNow ?? Date.now());
        else if (!quiet) dispatch({ type: 'SET_SUBMIT_ERROR', error: data?.error || 'Mock draft error' });
      } catch {
        if (!quiet) dispatch({ type: 'SET_SUBMIT_ERROR', error: 'Could not reach the draft — check your connection.' });
      }
    },
    [sessionId, apply, dispatch],
  );

  /**
   * Send an owner action. The acting franchise is the signed-in owner's, so
   * any `franchiseId` in `msg` is ignored by the server. A pick names the
   * slot it was made for, so one that lands after the clock already took
   * that slot is refused rather than spent on the owner's NEXT pick.
   */
  const send = useCallback(
    (msg: Record<string, unknown>) => {
      if (msg.type === 'pick') {
        if (pickInFlightRef.current) return;
        pickInFlightRef.current = true;
        const current = sessionRef.current;
        const withSlot = current ? { ...msg, overallPickNumber: current.currentPickIndex + 1 } : msg;
        void post(withSlot).finally(() => {
          pickInFlightRef.current = false;
        });
        return;
      }
      void post(msg);
    },
    [post],
  );

  useEffect(() => {
    if (!enabled || !sessionId) return;

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/mock-draft/session?id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (data?.session) apply(data.session, data.serverNow ?? Date.now());
        else if (res.status === 404 && !missingRef.current) {
          missingRef.current = true;
          dispatch({ type: 'SET_SUBMIT_ERROR', error: 'Session not found' });
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (!active) return;
      const status = sessionRef.current?.status;
      const delay = document.hidden
        ? HIDDEN_POLL_MS
        : status === 'completed'
          ? IDLE_POLL_MS
          : ACTIVE_POLL_MS;
      timeoutId = setTimeout(poll, delay);
    };

    // Join first (the creator walking in starts a lobby draft), then poll.
    // Quiet: a signed-out viewer or another league's owner may watch a board
    // they cannot act on, and that is not an error worth a banner.
    if (franchiseId) void post({ type: 'join', enableAutoPick: false }, true).finally(() => active && poll());
    else void poll();

    const clock = setInterval(tickClock, 250);
    const onVisible = () => {
      if (!document.hidden && active) {
        clearTimeout(timeoutId);
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      clearTimeout(timeoutId);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, sessionId, franchiseId, apply, post, tickClock, dispatch]);

  return { send };
}
