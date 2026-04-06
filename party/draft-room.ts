/**
 * PartyKit WebSocket server — handles both Draft Room Chat and Mock Draft sessions.
 *
 * Routing is by room ID:
 *   - Rooms starting with "mock-" or ending with "-registry" → Mock Draft logic
 *   - Everything else → Draft Room Chat
 *
 * ── Chat ──
 * Room keys: `league-{leagueId}-draft-{year}`
 * Message types: chat, pick, system, reaction
 *
 * ── Mock Draft ──
 * Room keys: `mock-{sessionId}` or `{leagueId}-registry`
 * Client → Server: join, pick, toggle-auto, start, pause, resume, skip, reset
 * Server → Client: session, pick-made, pick-clock, error, participant-joined/left
 */

import type * as Party from 'partykit/server';

// ══════════════════════════════════════════════════════════════════════════════
// Chat types
// ══════════════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  id: string;
  type: 'chat' | 'pick' | 'system' | 'reaction';
  senderId: string;
  senderName: string;
  senderIcon: string;
  text: string;
  timestamp: number;
  gifUrl?: string;
  replyTo?: string;
  emoji?: string;
  targetId?: string;
  reactions?: Record<string, string[]>;
}

// ══════════════════════════════════════════════════════════════════════════════
// Mock Draft types (inline — PartyKit runtime can't import from src/)
// ══════════════════════════════════════════════════════════════════════════════

type MockDraftStatus = 'lobby' | 'active' | 'paused' | 'completed';

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

interface JoinMessage { type: 'join'; franchiseId: string; enableAutoPick?: boolean; }
interface PickMessage { type: 'pick'; franchiseId: string; playerId: string; }
interface ToggleAutoMessage { type: 'toggle-auto'; franchiseId: string; }
interface StartMessage { type: 'start'; franchiseId: string; }
interface PauseMessage { type: 'pause'; franchiseId: string; }
interface ResumeMessage { type: 'resume'; franchiseId: string; }
interface SkipMessage { type: 'skip'; franchiseId: string; }
interface ResetMessage { type: 'reset'; franchiseId: string; }

type MockClientMessage =
  | JoinMessage | PickMessage | ToggleAutoMessage
  | StartMessage | PauseMessage | ResumeMessage | SkipMessage | ResetMessage;

// ══════════════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════════════

const MAX_HISTORY = 200;
const CHAT_STORAGE_KEY = 'chat-history';
const SESSION_KEY = 'session';

function isMockRoom(roomId: string): boolean {
  return roomId.startsWith('mock-') || roomId.endsWith('-registry');
}

// ══════════════════════════════════════════════════════════════════════════════
// Unified Server
// ══════════════════════════════════════════════════════════════════════════════

export default class DraftRoomServer implements Party.Server {
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private clockSeconds = 0;

  constructor(readonly room: Party.Room) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    if (isMockRoom(this.room.id)) {
      return this.mockOnConnect(conn, ctx);
    }
    return this.chatOnConnect(conn, ctx);
  }

  async onMessage(message: string, sender: Party.Connection) {
    if (isMockRoom(this.room.id)) {
      return this.mockOnMessage(message, sender);
    }
    return this.chatOnMessage(message, sender);
  }

  async onClose(conn: Party.Connection) {
    if (isMockRoom(this.room.id)) {
      return this.mockOnClose(conn);
    }
    // Chat: no-op on close
  }

  async onRequest(req: Party.Request): Promise<Response> {
    // Only mock draft rooms use HTTP requests
    if (isMockRoom(this.room.id)) {
      return this.mockOnRequest(req);
    }
    return new Response('Not found', { status: 404 });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Chat handlers
  // ══════════════════════════════════════════════════════════════════════════

  private async chatOnConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const history = await this.getChatHistory();
    conn.send(JSON.stringify({ type: '__history', messages: history }));

    const url = new URL(ctx.request.url);
    const senderName = url.searchParams.get('name') || 'Someone';
    const senderIcon = url.searchParams.get('icon') || '';
    const senderId = url.searchParams.get('franchiseId') || conn.id;

    const joinMsg: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'system',
      senderId,
      senderName,
      senderIcon,
      text: `${senderName} joined the draft room`,
      timestamp: Date.now(),
    };

    await this.appendChatHistory(joinMsg);
    this.room.broadcast(JSON.stringify(joinMsg), [conn.id]);
  }

  private async chatOnMessage(message: string, sender: Party.Connection) {
    let msg: ChatMessage;
    try {
      msg = JSON.parse(message) as ChatMessage;
    } catch {
      return;
    }

    if (!msg.id || !msg.type || !msg.senderId) return;
    msg.timestamp = Date.now();

    if (msg.type === 'reaction') {
      await this.applyChatReaction(msg);
      this.room.broadcast(JSON.stringify(msg));
      return;
    }

    if (msg.type === 'chat' || msg.type === 'pick' || msg.type === 'system') {
      if (msg.text && msg.text.length > 1000) {
        msg.text = msg.text.slice(0, 1000);
      }
      await this.appendChatHistory(msg);
      this.room.broadcast(JSON.stringify(msg));
    }
  }

  // ── Chat storage ──

  private async getChatHistory(): Promise<ChatMessage[]> {
    const stored = await this.room.storage.get<ChatMessage[]>(CHAT_STORAGE_KEY);
    return stored ?? [];
  }

  private async appendChatHistory(msg: ChatMessage): Promise<void> {
    const history = await this.getChatHistory();
    history.push(msg);
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    await this.room.storage.put(CHAT_STORAGE_KEY, history);
  }

  private async applyChatReaction(reaction: ChatMessage): Promise<void> {
    if (!reaction.targetId || !reaction.emoji) return;
    const history = await this.getChatHistory();
    const target = history.find((m) => m.id === reaction.targetId);
    if (!target) return;

    if (!target.reactions) target.reactions = {};
    const reactors = target.reactions[reaction.emoji] ?? [];

    const idx = reactors.indexOf(reaction.senderId);
    if (idx !== -1) {
      reactors.splice(idx, 1);
    } else {
      reactors.push(reaction.senderId);
    }

    if (reactors.length === 0) {
      delete target.reactions[reaction.emoji];
    } else {
      target.reactions[reaction.emoji] = reactors;
    }

    reaction.reactions = target.reactions;
    await this.room.storage.put(CHAT_STORAGE_KEY, history);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Mock Draft handlers
  // ══════════════════════════════════════════════════════════════════════════

  private async mockOnConnect(conn: Party.Connection, _ctx: Party.ConnectionContext) {
    const session = await this.getSession();
    if (!session) {
      conn.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      return;
    }
    conn.send(JSON.stringify({ type: 'session', session }));
  }

  private async mockOnMessage(message: string, sender: Party.Connection) {
    let msg: MockClientMessage;
    try {
      msg = JSON.parse(message) as MockClientMessage;
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
    }
  }

  private async mockOnClose(conn: Party.Connection) {
    const franchiseId = conn.state?.franchiseId as string | undefined;
    if (!franchiseId) return;

    const session = await this.getSession();
    if (!session) return;

    const participant = session.participants.find((p) => p.franchiseId === franchiseId);
    if (participant) {
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

  // ── Mock message handlers ──

  private async handleJoin(msg: JoinMessage, conn: Party.Connection) {
    const session = await this.getSession();
    if (!session) {
      conn.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      return;
    }

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
      this.startTimer(session);
      return;
    }

    conn.send(JSON.stringify({ type: 'session', session }));
    this.room.broadcast(
      JSON.stringify({ type: 'participant-joined', franchiseId: msg.franchiseId }),
      [conn.id],
    );
  }

  private async handlePick(msg: PickMessage, sender: Party.Connection) {
    const session = await this.getSession();
    if (!session) return;

    if (session.status !== 'active') {
      sender.send(JSON.stringify({ type: 'error', message: 'Draft is not active' }));
      return;
    }

    // In mock drafts, allow the session creator to pick for any team on the clock
    const currentFranchise = session.draftOrder[session.currentPickIndex];
    const isCreator = msg.franchiseId === session.createdBy;
    if (currentFranchise !== msg.franchiseId && !isCreator) {
      sender.send(JSON.stringify({ type: 'error', message: 'Not your turn' }));
      return;
    }

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

    if (msg.franchiseId !== session.createdBy) {
      this.sendMockError(msg.franchiseId, 'Only the session creator can start the draft');
      return;
    }

    if (session.status !== 'lobby') {
      this.sendMockError(msg.franchiseId, 'Draft already started');
      return;
    }

    session.status = 'active';
    await this.saveSession(session);
    this.broadcastSession(session);
    this.startTimer(session);
  }

  private async handlePause(msg: PauseMessage) {
    const session = await this.getSession();
    if (!session) return;

    if (msg.franchiseId !== session.createdBy) {
      this.sendMockError(msg.franchiseId, 'Only the session creator can pause');
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
      this.sendMockError(msg.franchiseId, 'Only the session creator can resume');
      return;
    }

    if (session.status !== 'paused') return;

    session.status = 'active';
    await this.saveSession(session);
    this.broadcastSession(session);
    this.startTimer(session);
  }

  private async handleSkip(msg: SkipMessage) {
    const session = await this.getSession();
    if (!session) return;

    if (msg.franchiseId !== session.createdBy) {
      this.sendMockError(msg.franchiseId, 'Only the session creator can skip');
      return;
    }

    if (session.status !== 'active') return;
    await this.autoPick(session);
  }

  private async handleReset(msg: ResetMessage) {
    const session = await this.getSession();
    if (!session) return;

    if (msg.franchiseId !== session.createdBy) {
      this.sendMockError(msg.franchiseId, 'Only the session creator can reset');
      return;
    }

    this.stopTimer();

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
    this.startTimer(session);
  }

  // ── Pick logic ──

  private async makePick(session: MockDraftSession, playerId: string, isAutoPick: boolean): Promise<void> {
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

    const slotIndex = session.picks.findIndex((p) => p.overallPickNumber === overallPickNumber);
    if (slotIndex !== -1) {
      session.picks[slotIndex] = pick;
    } else {
      session.picks.push(pick);
    }

    session.currentPickIndex = pickIndex + 1;

    const totalPicks = session.totalRounds * session.picksPerRound;
    if (session.currentPickIndex >= totalPicks) {
      session.status = 'completed';
      this.stopTimer();
    }

    await this.saveSession(session);
    this.room.broadcast(JSON.stringify({ type: 'pick-made', pick, session }));

    if (session.status === 'active') {
      this.startTimer(session);
    }
  }

  private async autoPick(session: MockDraftSession): Promise<void> {
    const rankedPlayerIds = (await this.room.storage.get<string[]>('ranked-players')) ?? [];
    const pickedPlayerIds = new Set(session.picks.filter((p) => p.playerId).map((p) => p.playerId!));
    const nextPlayerId = rankedPlayerIds.find((id) => !pickedPlayerIds.has(id));

    if (!nextPlayerId) {
      await this.makePick(session, `auto-${Date.now()}`, true);
      return;
    }

    await this.makePick(session, nextPlayerId, true);
  }

  // ── Timer ──

  private startTimer(session: MockDraftSession): void {
    this.stopTimer();
    this.clockSeconds = session.timerSeconds;

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

  // ── Mock storage helpers ──

  private async getSession(): Promise<MockDraftSession | null> {
    return (await this.room.storage.get<MockDraftSession>(SESSION_KEY)) ?? null;
  }

  private async saveSession(session: MockDraftSession): Promise<void> {
    await this.room.storage.put(SESSION_KEY, session);
  }

  private broadcastSession(session: MockDraftSession): void {
    this.room.broadcast(JSON.stringify({ type: 'session', session }));
  }

  private sendMockError(franchiseId: string, message: string): void {
    for (const conn of this.room.getConnections()) {
      if (conn.state?.franchiseId === franchiseId) {
        conn.send(JSON.stringify({ type: 'error', message }));
      }
    }
  }

  // ── Mock HTTP handler ──

  private async mockOnRequest(req: Party.Request): Promise<Response> {
    const JSON_CT = { 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
      if (this.room.id.endsWith('-registry')) {
        const sessions = (await this.room.storage.get<Record<string, any>>('sessions')) ?? {};
        return new Response(JSON.stringify({ sessions: Object.values(sessions) }), {
          status: 200, headers: JSON_CT,
        });
      }

      const session = await this.getSession();
      if (!session) {
        return new Response(JSON.stringify({ error: 'Session not found' }), {
          status: 404, headers: JSON_CT,
        });
      }
      return new Response(JSON.stringify({ session }), { status: 200, headers: JSON_CT });
    }

    if (req.method === 'POST') {
      try {
        const body = (await req.json()) as any;

        if (this.room.id.endsWith('-registry')) {
          const sessions = (await this.room.storage.get<Record<string, any>>('sessions')) ?? {};

          if (body.action === 'register' && body.sessionId && body.summary) {
            sessions[body.sessionId] = body.summary;
            await this.room.storage.put('sessions', sessions);
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_CT });
          }
          if (body.action === 'unregister' && body.sessionId) {
            delete sessions[body.sessionId];
            await this.room.storage.put('sessions', sessions);
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_CT });
          }
          if (body.action === 'update' && body.sessionId && body.summary) {
            sessions[body.sessionId] = body.summary;
            await this.room.storage.put('sessions', sessions);
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_CT });
          }
          return new Response('Unknown registry action', { status: 400 });
        }

        // Session room: initialize
        if (body.session) {
          await this.room.storage.put(SESSION_KEY, body.session);
        }
        if (body.rankedPlayerIds) {
          await this.room.storage.put('ranked-players', body.rankedPlayerIds);
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_CT });
      } catch {
        return new Response('Invalid JSON body', { status: 400 });
      }
    }

    return new Response('Method not allowed', { status: 405 });
  }
}

export const onFetch: Party.FetchHandler = async (req) => {
  return new Response('Draft Room PartyKit server is running.', { status: 200 });
};
