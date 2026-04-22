/**
 * PartyKit WebSocket server for Mock Draft sessions.
 * Each room is keyed by `{sessionId}`.
 *
 * All session state (picks, timer, participants) lives in Durable Object storage.
 * Completely independent of draft-room.ts (which handles real draft chat).
 *
 * Client → Server messages:
 *   join       — register as a participant
 *   pick       — make a draft pick
 *   toggle-auto — toggle auto-pick for the sender
 *   start      — creator starts the draft (lobby → active)
 *   pause      — creator pauses
 *   resume     — creator resumes
 *   skip       — creator skips current pick
 *
 * Server → Client messages:
 *   session           — full state sync (on join + after mutations)
 *   pick-made         — individual pick broadcast
 *   pick-clock        — timer tick (every second)
 *   error             — validation error
 *   participant-joined
 *   participant-left
 */

import type * as Party from 'partykit/server';

// ── Inline types (PartyKit runs in a separate runtime — cannot import from src/) ──

type MockDraftStatus = 'lobby' | 'active' | 'paused' | 'completed';

type MockRankingSource =
  | 'mfl-rookie'
  | 'mfl-dynasty'
  | 'sleeper'
  | 'ktc'
  | 'fbg'
  | 'random';

interface MockDraftSession {
  id: string;
  leagueId: string;
  leagueYear: number;
  createdBy: string;
  createdAt: string;
  status: MockDraftStatus;
  draftOrder: string[];
  picksPerRound: number;
  totalRounds: number;
  currentPickIndex: number;
  timerSeconds: number;
  picks: MockPick[];
  participants: MockParticipant[];
  useRealOrder: boolean;
  rankingAssignments?: Record<string, MockRankingSource>;
  defaultRankingSource?: MockRankingSource;
}

interface MockPick {
  overallPickNumber: number;
  round: number;
  pickInRound: number;
  franchiseId: string;
  playerId?: string;
  pickedAt?: string;
  isAutoPick?: boolean;
}

interface MockParticipant {
  franchiseId: string;
  connectedAt: string;
  isAutoPickEnabled: boolean;
  isConnected: boolean;
}

// ── Client → Server message types ───────────────────────────────────────────

interface JoinMessage {
  type: 'join';
  franchiseId: string;
  enableAutoPick?: boolean;
}

interface PickMessage {
  type: 'pick';
  franchiseId: string;
  playerId: string;
}

interface ToggleAutoMessage {
  type: 'toggle-auto';
  franchiseId: string;
}

interface StartMessage {
  type: 'start';
  franchiseId: string;
}

interface PauseMessage {
  type: 'pause';
  franchiseId: string;
}

interface ResumeMessage {
  type: 'resume';
  franchiseId: string;
}

interface SkipMessage {
  type: 'skip';
  franchiseId: string;
}

interface ResetMessage {
  type: 'reset';
  franchiseId: string;
}

interface UndoMessage {
  type: 'undo';
  franchiseId: string;
}

type ClientMessage =
  | JoinMessage
  | PickMessage
  | ToggleAutoMessage
  | StartMessage
  | PauseMessage
  | ResumeMessage
  | SkipMessage
  | ResetMessage
  | UndoMessage;

// ── Constants ───────────────────────────────────────────────────────────────

const SESSION_KEY = 'session';

export default class MockDraftServer implements Party.Server {
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private clockSeconds = 0;

  constructor(readonly room: Party.Room) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const session = await this.getSession();
    if (!session) {
      conn.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      return;
    }
    // Send full state to the newly connected client
    conn.send(JSON.stringify({ type: 'session', session }));
  }

  async onMessage(message: string, sender: Party.Connection) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }

    if (!msg.type) return;

    switch (msg.type) {
      case 'join':
        return this.handleJoin(msg, sender);
      case 'pick':
        return this.handlePick(msg, sender);
      case 'toggle-auto':
        return this.handleToggleAuto(msg);
      case 'start':
        return this.handleStart(msg);
      case 'pause':
        return this.handlePause(msg);
      case 'resume':
        return this.handleResume(msg);
      case 'skip':
        return this.handleSkip(msg);
      case 'reset':
        return this.handleReset(msg);
      case 'undo':
        return this.handleUndo(msg);
  }

  async onClose(conn: Party.Connection) {
    // Mark participant as disconnected using the connection's stored franchiseId
    const franchiseId = conn.state?.franchiseId as string | undefined;
    if (!franchiseId) return;

    const session = await this.getSession();
    if (!session) return;

    const participant = session.participants.find((p) => p.franchiseId === franchiseId);
    if (participant) {
      // Only mark disconnected if no other connections exist for this franchise
      const otherConns = [...this.room.getConnections()].filter(
        (c) => c.id !== conn.id && c.state?.franchiseId === franchiseId,
      );
      if (otherConns.length === 0) {
        participant.isConnected = false;
        await this.saveSession(session);
        this.room.broadcast(
          JSON.stringify({ type: 'participant-left', franchiseId }),
        );
      }
    }
  }

  // ── Message handlers ──────────────────────────────────────────────────────

  private async handleJoin(msg: JoinMessage, conn: Party.Connection) {
    const session = await this.getSession();
    if (!session) {
      conn.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      return;
    }

    // Store franchiseId on the connection for onClose tracking
    conn.setState({ franchiseId: msg.franchiseId });

    const existing = session.participants.find((p) => p.franchiseId === msg.franchiseId);
    if (existing) {
      existing.isConnected = true;
      existing.isAutoPickEnabled = msg.enableAutoPick ?? existing.isAutoPickEnabled;
    } else {
      session.participants.push({
        franchiseId: msg.franchiseId,
        connectedAt: new Date().toISOString(),
        isAutoPickEnabled: msg.enableAutoPick ?? false,
        isConnected: true,
      });
    }

    await this.saveSession(session);

    // Auto-start when the creator joins and draft is still in lobby
    if (session.status === 'lobby' && msg.franchiseId === session.createdBy) {
      session.status = 'active';
      await this.saveSession(session);
      this.broadcastSession(session);
      this.scheduleNextPick(session);
      return;
    }

    // Send full state to the joiner
    conn.send(JSON.stringify({ type: 'session', session }));

    // Broadcast join to others
    this.room.broadcast(
      JSON.stringify({ type: 'participant-joined', franchiseId: msg.franchiseId }),
      [conn.id],
    );
  }

  private async handlePick(msg: PickMessage, sender: Party.Connection) {
    const session = await this.getSession();
    if (!session) return;

    // Validate: draft must be active
    if (session.status !== 'active') {
      sender.send(JSON.stringify({ type: 'error', message: 'Draft is not active' }));
      return;
    }

    // Validate: it must be this franchise's turn
    const currentFranchise = session.draftOrder[session.currentPickIndex];
    if (currentFranchise !== msg.franchiseId) {
      sender.send(JSON.stringify({ type: 'error', message: 'Not your turn' }));
      return;
    }

    // Validate: player not already picked
    if (session.picks.some((p) => p.playerId === msg.playerId)) {
      sender.send(JSON.stringify({ type: 'error', message: 'Player already drafted' }));
      return;
    }

    await this.makePick(session, msg.playerId, false);
  }

  private async handleToggleAuto(msg: ToggleAutoMessage) {
    const session = await this.getSession();
    if (!session) return;

    const participant = session.participants.find((p) => p.franchiseId === msg.franchiseId);
    if (!participant) return;

    participant.isAutoPickEnabled = !participant.isAutoPickEnabled;
    await this.saveSession(session);
    this.broadcastSession(session);
  }

  private async handleStart(msg: StartMessage) {
    const session = await this.getSession();
    if (!session) return;

    // Only the creator can start
    if (msg.franchiseId !== session.createdBy) {
      this.sendError(msg.franchiseId, 'Only the session creator can start the draft');
      return;
    }

    if (session.status !== 'lobby') {
      this.sendError(msg.franchiseId, 'Draft already started');
      return;
    }

    session.status = 'active';
    await this.saveSession(session);
    this.broadcastSession(session);
    this.scheduleNextPick(session);
  }

  private async handlePause(msg: PauseMessage) {
    const session = await this.getSession();
    if (!session) return;

    if (msg.franchiseId !== session.createdBy) {
      this.sendError(msg.franchiseId, 'Only the session creator can pause');
      return;
    }

    if (session.status !== 'active') return;

    session.status = 'paused';
    this.stopTimer();
    await this.saveSession(session);
    this.broadcastSession(session);
  }

  private async handleResume(msg: ResumeMessage) {
    const session = await this.getSession();
    if (!session) return;

    if (msg.franchiseId !== session.createdBy) {
      this.sendError(msg.franchiseId, 'Only the session creator can resume');
      return;
    }

    if (session.status !== 'paused') return;

    session.status = 'active';
    await this.saveSession(session);
    this.broadcastSession(session);
    this.scheduleNextPick(session);
  }

  private async handleSkip(msg: SkipMessage) {
    const session = await this.getSession();
    if (!session) return;

    if (msg.franchiseId !== session.createdBy) {
      this.sendError(msg.franchiseId, 'Only the session creator can skip');
      return;
    }

    if (session.status !== 'active') return;

    // Auto-pick for the current team (skip = force auto-pick)
    await this.autoPick(session);
  }

  private async handleReset(msg: ResetMessage) {
    const session = await this.getSession();
    if (!session) return;

    // Only the creator can reset
    if (msg.franchiseId !== session.createdBy) {
      this.sendError(msg.franchiseId, 'Only the session creator can reset');
      return;
    }

    this.stopTimer();

    // Clear all picks back to empty slots
    session.currentPickIndex = 0;
    session.status = 'active';
    session.picks = [];
    const totalPicks = session.totalRounds * session.picksPerRound;
    for (let i = 0; i < totalPicks; i++) {
      const round = Math.ceil((i + 1) / session.picksPerRound);
      const pickInRound = (i + 1) - (round - 1) * session.picksPerRound;
      session.picks.push({
        overallPickNumber: i + 1,
        round,
        pickInRound,
        franchiseId: session.draftOrder[i],
      });
    }

    await this.saveSession(session);
    this.broadcastSession(session);
    this.scheduleNextPick(session);
  }

  /**
   * Revert the most recent pick so the slot goes back on the clock. Used
   * by the creator to un-do an AI auto-pick they didn't like (or a
   * mis-click of their own). Re-opens the draft if it had just completed.
   */
  private async handleUndo(msg: UndoMessage) {
    const session = await this.getSession();
    if (!session) return;

    if (msg.franchiseId !== session.createdBy) {
      this.sendError(msg.franchiseId, 'Only the session creator can undo');
      return;
    }

    if (session.currentPickIndex <= 0) {
      this.sendError(msg.franchiseId, 'No pick to undo');
      return;
    }

    this.stopTimer();

    const lastIndex = session.currentPickIndex - 1;
    const lastSlot = session.picks[lastIndex];
    if (lastSlot) {
      session.picks[lastIndex] = {
        overallPickNumber: lastSlot.overallPickNumber,
        round: lastSlot.round,
        pickInRound: lastSlot.pickInRound,
        franchiseId: lastSlot.franchiseId,
      };
    }
    session.currentPickIndex = lastIndex;
    if (session.status === 'completed') session.status = 'active';

    await this.saveSession(session);
    this.broadcastSession(session);
    this.scheduleNextPick(session);
  }

  // ── Pick logic ────────────────────────────────────────────────────────────

  private async makePick(
    session: MockDraftSession,
    playerId: string,
    isAutoPick: boolean,
  ): Promise<void> {
    const pickIndex = session.currentPickIndex;
    const overallPickNumber = pickIndex + 1;
    const round = Math.ceil(overallPickNumber / session.picksPerRound);
    const pickInRound = overallPickNumber - (round - 1) * session.picksPerRound;

    const pick: MockPick = {
      overallPickNumber,
      round,
      pickInRound,
      franchiseId: session.draftOrder[pickIndex],
      playerId,
      pickedAt: new Date().toISOString(),
      isAutoPick,
    };

    // Update the matching slot in session.picks
    const slotIndex = session.picks.findIndex(
      (p) => p.overallPickNumber === overallPickNumber,
    );
    if (slotIndex !== -1) {
      session.picks[slotIndex] = pick;
    } else {
      session.picks.push(pick);
    }

    // Advance to next pick
    session.currentPickIndex = pickIndex + 1;

    // Check if draft is complete
    const totalPicks = session.totalRounds * session.picksPerRound;
    if (session.currentPickIndex >= totalPicks) {
      session.status = 'completed';
      this.stopTimer();
    }

    await this.saveSession(session);

    // Broadcast the pick
    this.room.broadcast(JSON.stringify({ type: 'pick-made', pick, session }));

    // Schedule the next pick: either AI auto-picks on a short delay or
    // the human gets their full configured timer.
    if (session.status === 'active') {
      this.scheduleNextPick(session);
    }
  }

  /**
   * Auto-pick: select the first available player by overallPickNumber order.
   * In a real implementation this would use ADP data — for now, the client
   * seeds an `availablePlayers` list and the server just grabs the first
   * un-drafted playerId from the pre-built pick slots. Since we don't have
   * ADP data on the server, we pick a placeholder that the client will
   * resolve. The API route that creates the session can embed a ranked
   * player list in storage for smarter auto-picks.
   */
  private async autoPick(session: MockDraftSession): Promise<void> {
    // Determine which source this team drafts from. Assignments may live on
    // the session or in standalone storage (new create route writes both).
    const onClockFranchise = session.draftOrder[session.currentPickIndex];
    const assignments =
      session.rankingAssignments ??
      (await this.room.storage.get<Record<string, MockRankingSource>>('ranking-assignments')) ??
      {};
    const defaultSource: MockRankingSource =
      session.defaultRankingSource ??
      (await this.room.storage.get<MockRankingSource>('default-ranking-source')) ??
      'mfl-rookie';
    const source: MockRankingSource = assignments[onClockFranchise] ?? defaultSource;

    // Per-source lists written by the create route. Legacy single list used
    // as a fallback for sessions created before the multi-source rollout.
    const rankedLists =
      (await this.room.storage.get<Partial<Record<MockRankingSource, string[]>>>('ranked-lists')) ??
      {};
    const legacy = (await this.room.storage.get<string[]>('ranked-players')) ?? [];

    const pickedPlayerIds = new Set(
      session.picks.filter((p) => p.playerId).map((p) => p.playerId!),
    );

    const pickFrom = (list: string[] | undefined): string | undefined =>
      list?.find((id) => !pickedPlayerIds.has(id));

    // 1. Assigned source
    let nextPlayerId = pickFrom(rankedLists[source]);
    // 2. Default source
    if (!nextPlayerId && source !== defaultSource) {
      nextPlayerId = pickFrom(rankedLists[defaultSource]);
    }
    // 3. Legacy flat list
    if (!nextPlayerId) nextPlayerId = pickFrom(legacy);
    // 4. Any other source that still has a player
    if (!nextPlayerId) {
      for (const [, list] of Object.entries(rankedLists)) {
        const candidate = pickFrom(list);
        if (candidate) {
          nextPlayerId = candidate;
          break;
        }
      }
    }

    if (!nextPlayerId) {
      // Genuinely out of players — shouldn't happen; create route tops up.
      await this.makePick(session, `auto-${Date.now()}`, true);
      return;
    }

    await this.makePick(session, nextPlayerId, true);
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

  /**
   * Decide what to do after a pick lands (or when a draft starts/resets).
   *
   * Only use case the mock draft supports: a solo drafter vs AI.
   * → The creator's team gets the full user-configured timer.
   * → Every other seat auto-picks immediately. The chain keeps rattling
   *   through AI seats until we hit the creator's slot or the draft
   *   finishes, so 17 back-to-back AI picks happen in < 50ms rather
   *   than blocking on a half-second delay per seat.
   */
  private scheduleNextPick(session: MockDraftSession): void {
    if (session.status !== 'active') return;

    const onClockFranchise = session.draftOrder[session.currentPickIndex];
    const isCreatorTurn = onClockFranchise === session.createdBy;

    if (isCreatorTurn) {
      this.startTimer(session);
      return;
    }

    // AI seat — no timer. Fire the auto-pick on a microtask so the
    // current broadcast flushes to the socket first, otherwise the
    // client receives a burst of interleaved pick-made events.
    this.stopTimer();
    this.room.broadcast(
      JSON.stringify({ type: 'pick-clock', secondsRemaining: 0 }),
    );

    Promise.resolve().then(() => {
      this.runAiAutoPick().catch((err) => {
        console.error('[mock-draft] AI auto-pick failed:', err);
      });
    });
  }

  /**
   * Re-read the session before auto-picking to guard against a reset or
   * a manual creator pick landing in between.
   */
  private async runAiAutoPick(): Promise<void> {
    const session = await this.getSession();
    if (!session || session.status !== 'active') return;

    const onClockFranchise = session.draftOrder[session.currentPickIndex];
    if (onClockFranchise === session.createdBy) return;

    await this.autoPick(session);
  }

  private startTimer(session: MockDraftSession): void {
    this.stopTimer();
    this.clockSeconds = session.timerSeconds;

    // Broadcast initial clock value
    this.room.broadcast(
      JSON.stringify({ type: 'pick-clock', secondsRemaining: this.clockSeconds }),
    );

    this.timerInterval = setInterval(async () => {
      this.clockSeconds--;

      this.room.broadcast(
        JSON.stringify({ type: 'pick-clock', secondsRemaining: this.clockSeconds }),
      );

      if (this.clockSeconds <= 0) {
        this.stopTimer();

        // Timer expired — auto-pick or skip
        const currentSession = await this.getSession();
        if (!currentSession || currentSession.status !== 'active') return;

        await this.autoPick(currentSession);
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.clockSeconds = 0;
  }

  // ── Storage helpers ───────────────────────────────────────────────────────

  private async getSession(): Promise<MockDraftSession | null> {
    return (await this.room.storage.get<MockDraftSession>(SESSION_KEY)) ?? null;
  }

  private async saveSession(session: MockDraftSession): Promise<void> {
    await this.room.storage.put(SESSION_KEY, session);
  }

  // ── Broadcast helpers ─────────────────────────────────────────────────────

  private broadcastSession(session: MockDraftSession): void {
    this.room.broadcast(JSON.stringify({ type: 'session', session }));
  }

  private sendError(franchiseId: string, message: string): void {
    for (const conn of this.room.getConnections()) {
      if (conn.state?.franchiseId === franchiseId) {
        conn.send(JSON.stringify({ type: 'error', message }));
      }
    }
  }

  // ── HTTP request handler (room-level — has access to this.room.storage) ───

  async onRequest(req: Party.Request): Promise<Response> {
    const JSON_CT = { 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
      // Registry rooms return their session list
      if (this.room.id.endsWith('-registry')) {
        const sessions =
          (await this.room.storage.get<Record<string, any>>('sessions')) ?? {};
        return new Response(JSON.stringify({ sessions: Object.values(sessions) }), {
          status: 200,
          headers: JSON_CT,
        });
      }

      // Regular session rooms return the current session
      const session = await this.getSession();
      if (!session) {
        return new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404,
          headers: JSON_CT,
        });
      }
      return new Response(JSON.stringify({ session }), {
        status: 200,
        headers: JSON_CT,
      });
    }

    if (req.method === 'POST') {
      try {
        const body = (await req.json()) as any;

        // Registry room: register/unregister/update sessions
        if (this.room.id.endsWith('-registry')) {
          const sessions =
            (await this.room.storage.get<Record<string, any>>('sessions')) ?? {};

          if (body.action === 'register' && body.sessionId && body.summary) {
            sessions[body.sessionId] = body.summary;
            await this.room.storage.put('sessions', sessions);
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: JSON_CT,
            });
          }

          if (body.action === 'unregister' && body.sessionId) {
            delete sessions[body.sessionId];
            await this.room.storage.put('sessions', sessions);
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: JSON_CT,
            });
          }

          if (body.action === 'update' && body.sessionId && body.summary) {
            sessions[body.sessionId] = body.summary;
            await this.room.storage.put('sessions', sessions);
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: JSON_CT,
            });
          }

          return new Response('Unknown registry action', { status: 400 });
        }

        // Session room: initialize session + ranked players
        if (body.session) {
          await this.room.storage.put(SESSION_KEY, body.session);
        }
        if (body.rankedPlayerIds) {
          await this.room.storage.put('ranked-players', body.rankedPlayerIds);
        }
        if (body.rankingSource) {
          await this.room.storage.put('ranking-source', body.rankingSource);
        }
        // Phase 2: per-source lists + per-team assignments
        if (body.rankedLists && typeof body.rankedLists === 'object') {
          await this.room.storage.put('ranked-lists', body.rankedLists);
        }
        if (body.rankingAssignments && typeof body.rankingAssignments === 'object') {
          await this.room.storage.put('ranking-assignments', body.rankingAssignments);
        }
        if (body.defaultRankingSource) {
          await this.room.storage.put('default-ranking-source', body.defaultRankingSource);
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: JSON_CT,
        });
      } catch {
        return new Response('Invalid JSON body', { status: 400 });
      }
    }

    return new Response('Method not allowed', { status: 405 });
  }
}

// ── Module-level fetch handler (health check only) ────────────────────────────

export const onFetch: Party.FetchHandler = async (req) => {
  return new Response('Mock Draft PartyKit server is running.', { status: 200 });
};
