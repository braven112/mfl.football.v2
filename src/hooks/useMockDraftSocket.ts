/**
 * useMockDraftSocket
 *
 * Connects to the PartyKit mock-draft party for a given session.
 * Handles session sync, pick events, timer ticks, and participant events.
 * Returns a send function for client → server messages.
 */

import { useEffect, useRef, useCallback } from 'react';
import PartySocket from 'partysocket';
import type { MockDraftSession, MockPick, DraftRoomPick, DraftRoomAction } from '../types/draft-room';

interface UseMockDraftSocketOptions {
  partyHost: string;
  sessionId: string;
  franchiseId: string;
  dispatch: React.Dispatch<DraftRoomAction>;
  /** Whether this hook should be active (false = no connection) */
  enabled: boolean;
}

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

export function useMockDraftSocket({
  partyHost,
  sessionId,
  franchiseId,
  dispatch,
  enabled,
}: UseMockDraftSocketOptions) {
  const socketRef = useRef<PartySocket | null>(null);

  // Send a message to the PartyKit server
  const send = useCallback(
    (msg: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !partyHost || !sessionId || !franchiseId) return;

    const socket = new PartySocket({
      host: partyHost,
      room: sessionId,
      party: 'mock-draft',
    });

    socket.addEventListener('open', () => {
      // Join the session as this franchise
      socket.send(
        JSON.stringify({
          type: 'join',
          franchiseId,
          enableAutoPick: false,
        }),
      );
    });

    socket.addEventListener('message', (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data as string);

        switch (data.type) {
          case 'session': {
            const session = data.session as MockDraftSession;
            dispatch({ type: 'MOCK_SESSION_SYNC', session });
            // Also update the shared picks so DraftBoardPanel renders them
            dispatch({ type: 'POLL_SUCCESS', picks: convertMockPicks(session) });
            break;
          }

          case 'pick-made': {
            const session = data.session as MockDraftSession;
            const pick = data.pick as MockPick;
            dispatch({ type: 'MOCK_PICK_MADE', pick, session });
            dispatch({ type: 'POLL_SUCCESS', picks: convertMockPicks(session) });
            break;
          }

          case 'pick-clock': {
            dispatch({
              type: 'MOCK_CLOCK_TICK',
              secondsRemaining: data.secondsRemaining,
            });
            break;
          }

          case 'error': {
            dispatch({
              type: 'SET_SUBMIT_ERROR',
              error: data.message || 'Mock draft error',
            });
            break;
          }

          // participant-joined and participant-left are informational —
          // the full participant list is in the session sync
          default:
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    });

    socketRef.current = socket;

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [enabled, partyHost, sessionId, franchiseId, dispatch]);

  return { send };
}
