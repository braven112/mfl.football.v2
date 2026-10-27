/**
 * MFL league chat for the MFL Football app (package N): the parser for MFL's
 * chat file, its time labels, the unread count, and `/api/mfl-live/chat`.
 *
 * The fixture is the real file's SHAPE, read live 2026-10-27
 * (docs/claude/insights/domains/mfl-api.md): newest first, attributes in no
 * fixed order, `posted` a display string in the league's zone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireOwnerLeague = vi.fn();
const readLeagueFranchiseNames = vi.fn();
const mflFetch = vi.fn();
const markers = new Map<string, unknown>();

vi.mock('../src/utils/live/owner-league', async (orig) => ({
  ...(await orig<typeof import('../src/utils/live/owner-league')>()),
  requireOwnerLeague: (...a: unknown[]) => requireOwnerLeague(...a),
}));
vi.mock('../src/utils/broadcast-live-source', () => ({
  readLeagueFranchiseNames: (...a: unknown[]) => readLeagueFranchiseNames(...a),
}));
vi.mock('../src/utils/mfl-fetch', async (orig) => ({
  ...(await orig<typeof import('../src/utils/mfl-fetch')>()),
  mflFetch: (...a: unknown[]) => mflFetch(...a),
}));
vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => ({
    get: async (k: string) => markers.get(k) ?? null,
    set: async (k: string, v: unknown) => void markers.set(k, v),
  }),
}));

const { parseMflChatXml, parseMflChatPosted, countUnreadChat, mflChatFileUrl } = await import('../src/utils/mfl-chat');
const { GET, POST } = await import('../src/pages/api/mfl-live/chat');
const { chatReadKey } = await import('../src/utils/mfl-chat-read-state');

const FILE = `<?xml version="1.0" encoding="utf-8"?>

<messages>
  <message franchise_id="0012" id="a1b2c3d4e5f6a7b8" message="Late one &amp; &quot;loud&quot;" posted="Sat Aug 30 7:40:40 p.m. PT 2025" />
  <message id="0000000000000002" message="morning" posted="Sun Aug 24 9:42:53 a.m. PT 2025" franchise_id="0007" />
  <message franchise_id="0012" message="first" posted="Sat Aug 23 12:30:50 p.m. PT 2025" id="ffffffffffffffff" />
</messages>`;

describe('parseMflChatXml', () => {
  it('reads every message oldest first, whatever the attribute order', () => {
    const rows = parseMflChatXml(FILE);
    expect(rows.map((r) => r.id)).toEqual(['ffffffffffffffff', '0000000000000002', 'a1b2c3d4e5f6a7b8']);
    expect(rows[1]).toMatchObject({ franchiseId: '0007', text: 'morning' });
  });

  it('decodes XML entities in the text', () => {
    expect(parseMflChatXml(FILE)[2].text).toBe('Late one & "loud"');
  });

  it('an empty chat and junk both parse to nothing', () => {
    expect(parseMflChatXml('<?xml version="1.0"?>\n<messages></messages>')).toEqual([]);
    expect(parseMflChatXml('<html>Too many requests</html>')).toEqual([]);
  });

  it('keeps a private recipient if MFL ever marks one', () => {
    const [m] = parseMflChatXml('<messages><message id="x" franchise_id="0001" to_fid="3" message="psst" posted="" /></messages>');
    expect(m.toFranchiseId).toBe('0003');
  });
});

describe('parseMflChatPosted', () => {
  it('places a Pacific label in time, DST included', () => {
    // 7:40:40 p.m. PDT (UTC-7) on 2025-08-30.
    expect(parseMflChatPosted('Sat Aug 30 7:40:40 p.m. PT 2025')).toBe('2025-08-31T02:40:40.000Z');
    // Winter: PST is UTC-8.
    expect(parseMflChatPosted('Mon Jan 5 12:05:00 a.m. PT 2026')).toBe('2026-01-05T08:05:00.000Z');
    // 12 p.m. is noon.
    expect(parseMflChatPosted('Sat Aug 23 12:30:50 p.m. PT 2025')).toBe('2025-08-23T19:30:50.000Z');
  });

  it('other US zones', () => {
    expect(parseMflChatPosted('Sat Aug 30 7:40:40 p.m. ET 2025')).toBe('2025-08-30T23:40:40.000Z');
  });

  it('null for a zone or format it does not know', () => {
    expect(parseMflChatPosted('Sat Aug 30 7:40:40 p.m. XYZ 2025')).toBeNull();
    expect(parseMflChatPosted('yesterday')).toBeNull();
  });
});

describe('countUnreadChat', () => {
  const rows = parseMflChatXml(FILE);

  it("counts other teams' messages after the marker, never your own", () => {
    expect(countUnreadChat(rows, '0012', { id: 'ffffffffffffffff', at: null })).toBe(1);
    expect(countUnreadChat(rows, '0007', { id: 'ffffffffffffffff', at: null })).toBe(1);
    expect(countUnreadChat(rows, '0007', { id: 'a1b2c3d4e5f6a7b8', at: null })).toBe(0);
  });

  it('nothing is unread before the first look', () => {
    expect(countUnreadChat(rows, '0007', null)).toBe(0);
  });

  it('falls back to time when MFL has trimmed the marker out of the file', () => {
    expect(countUnreadChat(rows, '0007', { id: 'gone', at: '2025-08-24T00:00:00.000Z' })).toBe(1);
    expect(countUnreadChat(rows, '0007', { id: 'gone', at: null })).toBe(0);
  });
});

describe('mflChatFileUrl', () => {
  it("is the league's own fflnetdynamic file", () => {
    expect(mflChatFileUrl('https://www49.myfantasyleague.com', 2026, '55555')).toBe(
      'https://www49.myfantasyleague.com/fflnetdynamic2026/55555_chat.xml',
    );
  });

  it('refuses any host that is not MFL', () => {
    expect(mflChatFileUrl('https://evil.example.com', 2026, '55555')).toBeNull();
    expect(mflChatFileUrl('http://www49.myfantasyleague.com', 2026, '55555')).toBeNull();
    expect(mflChatFileUrl('https://www49.myfantasyleague.com.evil.com', 2026, '55555')).toBeNull();
  });
});

// ── The endpoint ────────────────────────────────────────────────────────────

const user = { id: 'owner-cookie', name: 'B', franchiseId: '0003', leagueId: '13522', role: 'owner' as const };
const league = {
  leagueId: '55555',
  leagueName: 'Work league',
  franchiseId: '0007',
  franchiseName: 'Desk Jockeys',
  year: 2026,
  host: 'https://www49.myfantasyleague.com',
};
const ctx = (path: string, init?: RequestInit) => {
  const url = new URL(`https://mfl.football${path}`);
  return { request: new Request(url, init), url } as any;
};

let chatFile = FILE;
beforeEach(() => {
  markers.clear();
  chatFile = FILE;
  requireOwnerLeague.mockReset().mockResolvedValue({ user, league });
  readLeagueFranchiseNames.mockReset().mockResolvedValue({ '0007': 'Desk Jockeys', '0012': 'Rivals' });
  mflFetch.mockReset().mockResolvedValue(new Response('<status>OK</status>'));
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    expect(u).toBe('https://www49.myfantasyleague.com/fflnetdynamic2026/55555_chat.xml');
    return new Response(chatFile, { status: 200 });
  }));
});

describe('GET /api/mfl-live/chat', () => {
  it('passes the gate through untouched', async () => {
    requireOwnerLeague.mockResolvedValue(new Response('{}', { status: 403 }));
    expect((await GET(ctx('/api/mfl-live/chat?league=77777'))).status).toBe(403);
  });

  it('returns the chat with names, oldest first, and marks it read', async () => {
    const res = await GET(ctx('/api/mfl-live/chat?league=55555'));
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.messages.map((m: any) => [m.franchiseName, m.mine])).toEqual([
      ['Rivals', false],
      ['Desk Jockeys', true],
      ['Rivals', false],
    ]);
    expect(markers.get(chatReadKey('55555', '0007'))).toEqual({ id: 'a1b2c3d4e5f6a7b8', at: '2025-08-31T02:40:40.000Z' });
  });

  it('count=1 starts the badge at zero on first look, then counts new messages', async () => {
    const first = await (await GET(ctx('/api/mfl-live/chat?league=55555&count=1'))).json();
    expect(first).toEqual({ ok: true, leagueId: '55555', unread: 0 });
    chatFile = FILE.replace(
      '<messages>',
      '<messages>\n  <message id="newnewnewnewnew1" franchise_id="0012" message="you up?" posted="Sun Aug 31 8:00:00 a.m. PT 2025" />',
    );
    const second = await (await GET(ctx('/api/mfl-live/chat?league=55555&count=1'))).json();
    expect(second.unread).toBe(1);
    // Counting never clears it; only opening the chat does.
    expect((await (await GET(ctx('/api/mfl-live/chat?league=55555&count=1'))).json()).unread).toBe(1);
  });

  it('the marker is per league: the same franchise id elsewhere is another key', () => {
    expect(chatReadKey('55555', '0001')).not.toBe(chatReadKey('13522', '0001'));
  });

  it('an unreadable chat is 503, never an empty one', async () => {
    chatFile = '<html>Try again later</html>';
    expect((await GET(ctx('/api/mfl-live/chat?league=55555'))).status).toBe(503);
  });

  it('a league that never chatted is an empty chat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })));
    const body = await (await GET(ctx('/api/mfl-live/chat?league=55555'))).json();
    expect(body).toMatchObject({ ok: true, messages: [], unread: 0 });
  });
});

describe('POST /api/mfl-live/chat', () => {
  const post = (text: unknown) =>
    POST(ctx('/api/mfl-live/chat?league=55555', { method: 'POST', body: JSON.stringify({ text }) }));

  it("posts with the owner's own cookie to MFL's chat_save", async () => {
    const files = [FILE, FILE.replace('<messages>', '<messages><message id="mine000000000001" franchise_id="0007" message="gg" posted="" />')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(files.shift() ?? files[0], { status: 200 })));
    const res = await post('  gg  ');
    expect(res.status).toBe(200);
    const [opts] = mflFetch.mock.calls[0];
    expect(opts).toMatchObject({ method: 'POST', mflUserCookie: 'owner-cookie' });
    expect(opts.url).toBe('https://api.myfantasyleague.com/2026/import?TYPE=chat_save&L=55555&JSON=1');
    expect(opts.body).toBe('MESSAGE=gg');
    const body = await res.json();
    expect(body.messages.at(-1)).toMatchObject({ id: 'mine000000000001', mine: true });
  });

  it('rejects empty and over-long text before calling MFL', async () => {
    expect((await post('   ')).status).toBe(400);
    expect((await post('x'.repeat(501))).status).toBe(400);
    expect(mflFetch).not.toHaveBeenCalled();
  });

  it("MFL's refusal is a refusal, with MFL's reason", async () => {
    mflFetch.mockResolvedValue(new Response('<error>API requires a logged in user</error>'));
    const res = await post('hi');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: 'refused' });
  });

  it('a silent MFL with nothing new in the chat is unconfirmed, not success', async () => {
    mflFetch.mockResolvedValue(new Response(''));
    const res = await post('hi');
    expect(await res.json()).toMatchObject({ ok: false, error: 'unconfirmed' });
  });

  it('a test build that refuses to write says so', async () => {
    const { OutboundBlockedError } = await import('../src/utils/deploy-environment');
    mflFetch.mockRejectedValue(new OutboundBlockedError('MFL write'));
    const res = await post('hi');
    expect(await res.json()).toMatchObject({ ok: false, error: 'blocked' });
  });
});
