/**
 * The AI reply answers in the SESSION league's voice: its persona, its name,
 * its own feed for context. It used to load TheLeague's feed and sign every
 * reply "Claude Schefter … a league called TheLeague", whichever league the
 * owner was in. TheLeague's default-persona prompt must stay byte-identical.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { getLeagueBySlug } from '../src/config/leagues';

const create = vi.fn();
const saved: unknown[] = [];

beforeEach(() => {
  vi.resetModules();
  create.mockReset();
  saved.length = 0;
  create.mockResolvedValue({ content: [{ type: 'text', text: 'Boom.' }] });
  vi.doMock('@anthropic-ai/sdk', () => ({ default: class { messages = { create }; } }));
  vi.doMock('../src/utils/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
  vi.doMock('../src/utils/redis-client', () => ({ getRedis: async () => null }));
  vi.doMock('../src/utils/schefter-replies-storage', () => ({
    getReplyById: async (postId: string, id: string) => ({ id, postId, body: 'Hot take', author: { name: 'Owner' } }),
    saveReply: async (r: unknown) => (saved.push(r), true),
    generateReplyId: () => 'r2',
  }));
});

async function reply(slug: string, postId: string) {
  const { POST } = await import('../src/pages/api/schefter-replies/[postId]/ai-reply');
  const { createSessionToken } = await import('../src/utils/session');
  const token = createSessionToken({ userId: 'u', username: 'owner', franchiseId: '0001', leagueId: getLeagueBySlug(slug)!.id, role: 'owner' });
  const res = await POST({
    params: { postId },
    request: new Request(`https://x.test/api/schefter-replies/${postId}/ai-reply`, {
      method: 'POST',
      headers: { cookie: `session_token=${token}` },
      body: JSON.stringify({ userReplyId: 'r1' }),
    }),
  } as never);
  return { status: res.status, system: create.mock.calls[0]?.[0]?.system as string, user: create.mock.calls[0]?.[0]?.messages?.[0]?.content as string };
}

describe('AI reply — league scope', () => {
  it("an Archie's owner is answered for Archie's, never TheLeague", async () => {
    const { status, system } = await reply('archies', 'sf_nonexistent');
    expect(status).toBe(201);
    expect(system).toContain("a fantasy football league called Archie's");
    expect(system).not.toContain('TheLeague');
    expect(system).not.toContain('dynasty');
  });

  it("TheLeague keeps its original prompt, and its own feed supplies the post", async () => {
    const src = readFileSync('src/pages/api/schefter-replies/[postId]/ai-reply.ts', 'utf8');
    const original = src.match(/const CLAUDE_SYSTEM = `([\s\S]*?)`;/)![1];
    const feed = JSON.parse(readFileSync('src/data/theleague/schefter-feed.json', 'utf8'));
    const post = feed.posts.find((p: { headline?: string }) => p.headline);
    const { status, system, user } = await reply('theleague', post.id);
    expect(status).toBe(201);
    expect(system).toBe(original);
    expect(user).toContain(post.headline);
  });
});
