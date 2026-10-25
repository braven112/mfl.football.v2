/**
 * Draft-room chat, stored in Redis and polled (replaced PartyKit, Oct 2026).
 *
 * One JSON document per room holds the last MAX_HISTORY messages, and a tiny
 * version counter beside it lets a poll answer "nothing new" by reading a
 * number rather than the whole history. Writes take a short lock so two
 * owners posting at once cannot drop each other's message.
 *
 * Room ids are the ones DraftRoom has always used — `league-{id}-draft-{year}`
 * (plus `-conference0N` for the AFL) and `league-{id}-mockchat-{session}` — so
 * the league a room belongs to is readable off its id, and the API checks it
 * against the signed-in owner's league.
 */

import type { ChatMessage } from '../types/draft-room';
import { getMockDraftKv, MockDraftStoreError, type MockDraftKv } from './mock-draft-store';

export const MAX_HISTORY = 200;
const MAX_TEXT = 1000;
/** A season's draft chat outlives the draft by a few months, then goes. */
const TTL_SECONDS = 120 * 24 * 60 * 60;
const LOCK_SECONDS = 5;

const ROOM_RE = /^league-(\d+)-(?:draft-\d{4}(?:-[a-z0-9]+)?|mockchat-[a-z0-9-]+)$/;

/** The league a chat room belongs to, or null for an id that is not a draft room. */
export function chatRoomLeague(room: unknown): string | null {
  if (typeof room !== 'string' || room.length > 120) return null;
  return ROOM_RE.exec(room)?.[1] ?? null;
}

const historyKey = (room: string) => `draft-chat:${room}`;
const versionKey = (room: string) => `draft-chat:${room}:v`;
const lockKey = (room: string) => `draft-chat:${room}:lock`;

interface ChatDoc {
  version: number;
  messages: ChatMessage[];
}

async function requireKv(): Promise<MockDraftKv> {
  const kv = await getMockDraftKv();
  if (!kv) throw new MockDraftStoreError('Chat storage is not configured.', 503);
  return kv;
}

/** Messages since `knownVersion`, or `unchanged` when there are none. */
export async function readChat(
  room: string,
  knownVersion?: number,
): Promise<{ version: number; messages?: ChatMessage[] }> {
  const kv = await requireKv();
  const version = Number(await kv.get<number>(versionKey(room))) || 0;
  if (knownVersion === version) return { version };
  const doc = await kv.get<ChatDoc>(historyKey(room));
  return { version: doc?.version ?? version, messages: doc?.messages ?? [] };
}

async function mutate(room: string, fn: (messages: ChatMessage[]) => boolean): Promise<number | null> {
  const kv = await requireKv();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await kv.set(lockKey(room), token, { nx: true, ex: LOCK_SECONDS })) {
      try {
        const doc = (await kv.get<ChatDoc>(historyKey(room))) ?? { version: 0, messages: [] };
        if (!fn(doc.messages)) return doc.version;
        if (doc.messages.length > MAX_HISTORY) doc.messages.splice(0, doc.messages.length - MAX_HISTORY);
        doc.version += 1;
        await kv.set(historyKey(room), doc, { ex: TTL_SECONDS });
        await kv.set(versionKey(room), doc.version, { ex: TTL_SECONDS });
        return doc.version;
      } finally {
        if ((await kv.get<string>(lockKey(room))) === token) await kv.del(lockKey(room));
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Append a chat, pick or system message. Returns the new version, or null if the room stayed locked. */
export async function postChatMessage(room: string, message: ChatMessage): Promise<number | null> {
  const clean: ChatMessage = {
    ...message,
    text: typeof message.text === 'string' ? message.text.slice(0, MAX_TEXT) : '',
    timestamp: Date.now(),
  };
  delete clean.reactions;
  return mutate(room, (messages) => {
    if (messages.some((m) => m.id === clean.id)) return false;
    messages.push(clean);
    return true;
  });
}

/** Toggle `senderId`'s `emoji` on a message. */
export async function toggleChatReaction(
  room: string,
  targetId: string,
  emoji: string,
  senderId: string,
): Promise<number | null> {
  return mutate(room, (messages) => {
    const target = messages.find((m) => m.id === targetId);
    if (!target) return false;
    const reactions = (target.reactions ??= {});
    const reactors = reactions[emoji] ?? [];
    const at = reactors.indexOf(senderId);
    if (at === -1) reactors.push(senderId);
    else reactors.splice(at, 1);
    if (reactors.length) reactions[emoji] = reactors;
    else delete reactions[emoji];
    return true;
  });
}
