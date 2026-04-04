/**
 * PartyKit WebSocket server for the Draft Room chat.
 * Each draft room session is a "room" keyed by `{leagueId}-{year}`.
 *
 * Message types relayed:
 *   chat      — user text message (with optional @mentions, gifUrl, replyTo)
 *   pick      — auto-posted pick announcement (emitted by client on POLL_SUCCESS diff)
 *   system    — user joined, user left, timer warnings
 *   reaction  — emoji reaction on a message
 *
 * Message history is stored in room durable storage (session-scoped, not permanent).
 * Max history kept: 200 messages.
 */

import type * as Party from 'partykit/server';

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
  /** reaction type: for type='reaction', the emoji code */
  emoji?: string;
  /** messageId being reacted to: for type='reaction' */
  targetId?: string;
  /** Map of emoji → senderIds that have reacted (populated by server, sent to new joiners) */
  reactions?: Record<string, string[]>;
}

const MAX_HISTORY = 200;
const STORAGE_KEY = 'chat-history';

export default class DraftRoomServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Send message history to newly connected client
    const history = await this.getHistory();
    conn.send(JSON.stringify({ type: '__history', messages: history }));

    // Broadcast join notice
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

    await this.appendHistory(joinMsg);
    this.room.broadcast(JSON.stringify(joinMsg), [conn.id]);
  }

  async onMessage(message: string, sender: Party.Connection) {
    let msg: ChatMessage;
    try {
      msg = JSON.parse(message) as ChatMessage;
    } catch {
      return;
    }

    // Validate required fields
    if (!msg.id || !msg.type || !msg.senderId) return;

    // Force server-side timestamp to prevent clock skew
    msg.timestamp = Date.now();

    if (msg.type === 'reaction') {
      // Apply reaction to existing message in history
      await this.applyReaction(msg);
      this.room.broadcast(JSON.stringify(msg));
      return;
    }

    // Store and broadcast chat / pick / system messages
    if (msg.type === 'chat' || msg.type === 'pick' || msg.type === 'system') {
      // Sanitize text length
      if (msg.text && msg.text.length > 1000) {
        msg.text = msg.text.slice(0, 1000);
      }

      await this.appendHistory(msg);
      this.room.broadcast(JSON.stringify(msg));
    }
  }

  async onClose(conn: Party.Connection) {
    // No explicit leave message — keep it clean for async/tab-close scenarios
  }

  // ── Storage helpers ──────────────────────────────────────────────────

  private async getHistory(): Promise<ChatMessage[]> {
    const stored = await this.room.storage.get<ChatMessage[]>(STORAGE_KEY);
    return stored ?? [];
  }

  private async appendHistory(msg: ChatMessage): Promise<void> {
    const history = await this.getHistory();
    history.push(msg);
    // Trim to max
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    await this.room.storage.put(STORAGE_KEY, history);
  }

  private async applyReaction(reaction: ChatMessage): Promise<void> {
    if (!reaction.targetId || !reaction.emoji) return;
    const history = await this.getHistory();
    const target = history.find((m) => m.id === reaction.targetId);
    if (!target) return;

    if (!target.reactions) target.reactions = {};
    const reactors = target.reactions[reaction.emoji] ?? [];

    // Toggle: if already reacted, remove; otherwise add
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

    // Augment the reaction message with updated counts for broadcast
    reaction.reactions = target.reactions;

    await this.room.storage.put(STORAGE_KEY, history);
  }
}

export const onFetch: Party.FetchHandler = async (req, lobby) => {
  return new Response('Draft Room PartyKit server is running.', { status: 200 });
};
