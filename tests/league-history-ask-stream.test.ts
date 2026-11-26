/**
 * The live chat's wire (Brandon, 2026-11-26): POST /api/league-history/ask
 * with `stream: true` answers as newline-delimited JSON — each lookup, the
 * answer so far, then one `done` carrying the same body the plain call
 * returns — while a refusal before the work starts stays a plain JSON error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { user: { franchiseId: '0001', name: 'Owner', leagueId: 'x' } as any, allowed: true, fail: false };

vi.mock('../src/utils/auth', () => ({
  getAuthUser: () => state.user,
  franchiseIdForLeague: () => '0001',
}));
vi.mock('../src/utils/league-history/access', () => ({ canAskLeagueHistory: () => true }));
vi.mock('../src/utils/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: state.allowed }) }));
vi.mock('../src/utils/league-history/datasets', () => ({
  hasLeagueHistoryProduct: () => true,
  loadLeagueHistoryDataset: async () => ({ history: { seasons: [] } }),
  loadLeagueCompetitions: async () => null,
  loadLeagueSalaries: async () => null,
}));
vi.mock('../src/utils/owner-link-live', () => ({ loadLiveLeagueHistory: async (_: string, h: unknown) => h }));
vi.mock('../src/utils/ai-usage', () => ({ recordAiUsage: async () => {} }));
vi.mock('../src/utils/league-history/ask-store', () => ({
  readAnswer: async () => null,
  turnsAfter: () => [],
  saveAnswer: async (a: any) => ({ ...a, id: 'abcdefghij', createdAt: '2026-11-26T00:00:00Z' }),
  recordAsk: async () => {},
}));
vi.mock('../src/utils/league-history/ask', () => ({
  askHistory: async (_slug: string, _ds: unknown, _q: string, opts: any) => {
    if (state.fail) throw new Error('model down');
    opts.onEvent?.({ type: 'step', text: 'Seasons, sorted by points' });
    opts.onEvent?.({ type: 'answer', text: 'Yes,' });
    opts.onEvent?.({ type: 'answer', text: 'Yes, twice.' });
    return { answer: 'Yes, twice.', headline: null, followUps: ['And in the playoffs?'], table: null, steps: ['Seasons, sorted by points'], asOf: '', records: [] };
  },
}));

const { POST } = await import('../src/pages/api/league-history/ask');

const post = (body: Record<string, unknown>) =>
  POST({ request: new Request('https://theleague.us/api/league-history/ask', { method: 'POST', body: JSON.stringify(body) }) } as any) as Promise<Response>;

const lines = async (res: Response) =>
  (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

beforeEach(() => {
  state.allowed = true;
  state.fail = false;
});

describe('POST /api/league-history/ask, stream: true', () => {
  it('streams each lookup, the answer so far, then the finished answer with its link', async () => {
    const res = await post({ league: 'theleague', question: 'Most points ever?', stream: true });
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = await lines(res);
    expect(events.map((e) => e.type)).toEqual(['step', 'answer', 'answer', 'done']);
    expect(events.at(-1)).toMatchObject({ type: 'done', id: 'abcdefghij', question: 'Most points ever?', answer: 'Yes, twice.', followUps: ['And in the playoffs?'] });
  });

  it('still answers one JSON body without stream', async () => {
    const res = await post({ league: 'theleague', question: 'Most points ever?' });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ id: 'abcdefghij', answer: 'Yes, twice.' });
  });

  it('refuses before the work starts as plain JSON with its status', async () => {
    state.allowed = false;
    const res = await post({ league: 'theleague', question: 'Most points ever?', stream: true });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/a lot of questions/);
  });

  it('ends the stream with an error event when the model fails', async () => {
    state.fail = true;
    const events = await lines(await post({ league: 'theleague', question: 'Most points ever?', stream: true }));
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(events.at(-1).error).toMatch(/Could not work that one out/);
  });
});
