/**
 * Draft-room chat on Redis (src/utils/draft-chat-store.ts), which replaced
 * PartyKit's chat rooms. A poll that already has the latest version must get
 * nothing back, reactions toggle per franchise, history is capped, and only
 * room ids that name their league are accepted.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { __setMockDraftKvForTests, memoryMockDraftKv } from '../src/utils/mock-draft-store';
import {
  chatRoomLeague,
  MAX_HISTORY,
  postChatMessage,
  readChat,
  toggleChatReaction,
} from '../src/utils/draft-chat-store';
import type { ChatMessage } from '../src/types/draft-room';

const ROOM = 'league-13522-draft-2026';
const msg = (id: string, text = 'hi'): ChatMessage => ({
  id,
  type: 'chat',
  senderId: '0001',
  senderName: 'Pigskins',
  senderIcon: '',
  text,
  timestamp: 0,
});

beforeEach(() => __setMockDraftKvForTests(memoryMockDraftKv()));
afterEach(() => __setMockDraftKvForTests(null));

describe('draft chat store', () => {
  it('returns history, then nothing until something changes', async () => {
    expect(await readChat(ROOM)).toEqual({ version: 0, messages: [] });
    const v = await postChatMessage(ROOM, msg('a'));
    const first = await readChat(ROOM);
    expect(first.version).toBe(v);
    expect(first.messages?.map((m) => m.id)).toEqual(['a']);
    expect(await readChat(ROOM, v!)).toEqual({ version: v });
  });

  it('ignores a resent message id', async () => {
    await postChatMessage(ROOM, msg('a'));
    await postChatMessage(ROOM, msg('a', 'again'));
    expect((await readChat(ROOM)).messages).toHaveLength(1);
  });

  it('toggles a reaction per franchise', async () => {
    await postChatMessage(ROOM, msg('a'));
    await toggleChatReaction(ROOM, 'a', '🔥', '0002');
    await toggleChatReaction(ROOM, 'a', '🔥', '0003');
    expect((await readChat(ROOM)).messages?.[0].reactions).toEqual({ '🔥': ['0002', '0003'] });
    await toggleChatReaction(ROOM, 'a', '🔥', '0002');
    await toggleChatReaction(ROOM, 'a', '🔥', '0003');
    expect((await readChat(ROOM)).messages?.[0].reactions).toEqual({});
  });

  it(`keeps the last ${MAX_HISTORY} messages`, async () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) await postChatMessage(ROOM, msg(`m${i}`));
    const { messages } = await readChat(ROOM);
    expect(messages).toHaveLength(MAX_HISTORY);
    expect(messages?.[0].id).toBe('m5');
  });

  it('reads the league off every room id DraftRoom builds, and nothing else', () => {
    expect(chatRoomLeague(ROOM)).toBe('13522');
    expect(chatRoomLeague('league-19621-draft-2026-conference01')).toBe('19621');
    expect(chatRoomLeague('league-19621-mockchat-abc123')).toBe('19621');
    expect(chatRoomLeague('mock-abc')).toBeNull();
    expect(chatRoomLeague('league-13522-draft-2026/../x')).toBeNull();
  });
});
