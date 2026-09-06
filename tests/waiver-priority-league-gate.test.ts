/**
 * A waiver PRIORITY ORDER may only be shown where MFL says one exists.
 *
 * TheLeague is `BBID_FCFS` — blind bidding, ties broken first come first
 * served. It has no priority order. MFL serves it a `waiverSortOrder` anyway
 * (it always does), which is the trap: the number looks authoritative, is the
 * default reverse-franchise-id list nobody set, and decides nothing. Shipping
 * it invented a queue for sixteen owners.
 *
 * These pin the three places that could put it back:
 *   1. the resolver, which must read MFL's `currentWaiverType`, not the slug
 *   2. the hub config, which must gate the row and screen on that
 *   3. the API route, which is what makes the number look official
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getWaiverSystem, leagueUsesWaiverPriority } from '../src/utils/waiver-system';
import { readBidRules } from '../src/utils/waiver-claim';
import { buildTransactionHubConfig } from '../src/utils/transaction-hub-config';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const leagueFeed = (slug: string, year: number) =>
  JSON.parse(read(`data/${slug}/mfl-feeds/${year}/league.json`)).league;

describe('waiver priority is gated on MFL settings', () => {
  it('the two leagues really do differ in MFL, which is why a slug check is not the fix', () => {
    // If either of these changes, the product decision changes with it — that
    // is the point of reading the setting rather than hardcoding a league.
    expect(leagueFeed('theleague', 2026).currentWaiverType).toBe('BBID_FCFS');
    expect(leagueFeed('afl-fantasy', 2026).currentWaiverType).toBe('WAIVERS_FCFS');
  });

  it('the resolver returns the system MFL reports, per league', () => {
    // Behavioural, not a source scan: call it and assert the value. A regex
    // over the file is satisfied by an import line and would survive the
    // function being gutted (GEMINI.md, "Test behavior, not source text").
    expect(getWaiverSystem('theleague', 2026)).toBe('bbid');
    expect(getWaiverSystem('afl-fantasy', 2026)).toBe('priority');
  });

  it('answers false for TheLeague, true for the AFL, and false when it cannot tell', () => {
    expect(leagueUsesWaiverPriority('theleague', 2026)).toBe(false);
    expect(leagueUsesWaiverPriority('afl-fantasy', 2026)).toBe(true);
    // Fails closed: an unknown league and a year with no feed both answer no.
    expect(getWaiverSystem('best-ball-1', 2026)).toBeNull();
    expect(leagueUsesWaiverPriority('best-ball-1', 2026)).toBe(false);
    expect(leagueUsesWaiverPriority('not-a-league', 2026)).toBe(false);
  });

  it('a payload with no currentWaiverType is unreadable, NOT priority', () => {
    // readBidRules looks for 'BBID' in the string, so a league object missing
    // the field stringifies to '' and reads as priority — failing OPEN into a
    // fabricated order. getWaiverSystem must not inherit that default.
    expect(readBidRules({}).system).toBe('priority');
    expect(readBidRules({ name: 'X' } as any).system).toBe('priority');
    // …so the module-level answer has to be its own check, not a pass-through.
    const src = read('src/utils/waiver-system.ts');
    expect(src).toMatch(/currentWaiverType/);
    expect(src).toMatch(/if \(!declared\) return null;/);
  });

  it('a year we hold no feed for falls back to the newest, not to "priority"', () => {
    // The dangerous default: an empty payload has no currentWaiverType, and
    // "no BBID in the string" reads as priority — which would invent an order
    // for a blind-bid league in the window between a rollover and the first
    // feed sync.
    expect(getWaiverSystem('theleague', 2099)).toBe('bbid');
    expect(leagueUsesWaiverPriority('theleague', 2099)).toBe(false);
  });

  it('the hub config carries the answer, and gates it on the league not the viewer', () => {
    const owner = { franchiseId: '0001', leagueId: '13522' };
    const tl = buildTransactionHubConfig('theleague', owner, '/theleague/players', 2026);
    expect(tl.signedIn).toBe(true);
    expect(tl.showWaiverPriority).toBe(false);

    // Signed OUT of a priority league still reports that the league has one —
    // otherwise the sign-in gate would promise a spot in a line that exists.
    const aflOut = buildTransactionHubConfig('afl-fantasy', null, '/afl-fantasy/players', 2026);
    expect(aflOut.signedIn).toBe(false);
    expect(aflOut.showWaiverPriority).toBe(true);

    // A TheLeague session browsing the AFL is not signed in THERE — both
    // leagues have a franchise 0001, so the league id is what decides.
    const crossLeague = buildTransactionHubConfig('afl-fantasy', owner, '/afl-fantasy/players', 2026);
    expect(crossLeague.signedIn).toBe(false);
    expect(crossLeague.franchiseId).toBeNull();
    expect(crossLeague.teams).toEqual([]);
  });

  it('hides the priority row AND the screen, not just the row', () => {
    const modal = read('src/components/theleague/TransactionHubModal.astro');
    // Two gates: the hub-home row, and view 5 itself. Hiding only the row
    // leaves a screen reachable by any stray showView call.
    const gates = modal.match(/\{config\.showWaiverPriority && \(/g) ?? [];
    expect(gates.length).toBe(2);
    expect(modal).toMatch(/id="thm-hub-order"/);
    expect(modal).toMatch(/id="thm-order-view"/);
  });

  it('does not spend an MFL read on an order it would never show', () => {
    const script = read('src/scripts/transaction-hub.ts');
    const load = script.slice(script.indexOf('async function thmLoadOrder'));
    const body = load.slice(0, load.indexOf('\n}'));
    // The bail must come before the fetch, not after it.
    expect(body.indexOf('showWaiverPriority')).toBeGreaterThan(-1);
    expect(body.indexOf('showWaiverPriority')).toBeLessThan(body.indexOf('fetch('));
  });

  it('decides from the build-time feed, not the payload it just fetched', () => {
    // Structural, and deliberately so: this pins WHERE the answer comes from,
    // which no response value can distinguish. The live read degrades to a
    // last-known-good order during an MFL blip, so a system inferred from a
    // failed read would flip a real priority league to "no order here" for the
    // length of the outage. The behavioural half is the route test below.
    const route = read('src/pages/api/waiver-order.ts');
    expect(route).toMatch(/leagueUsesWaiverPriority\(league\.slug, year\)/);
    expect(route).not.toMatch(/readBidRules/);
  });

  it('no longer claims priority breaks tied bids — BBID_FCFS breaks them FCFS', () => {
    const render = read('src/utils/waiver-priority-render.ts');
    expect(render).not.toMatch(/breaks ties between equal bids/);
    // And the footnote no longer takes a system it cannot act on honestly.
    // Pinned as "does not take a system", not as an exact arity — the footnote
    // legitimately grew a `cookies` argument when the stamp started honouring
    // the viewer's chosen clock (docs/claude/rules/viewer-preferences.md).
    expect(render).toMatch(/export function waiverPriorityFootnote\(asOf: string, live: boolean[,)]/);
    expect(render).not.toMatch(/export function waiverPriorityFootnote\([^)]*system/);
  });
});

/**
 * The hub's own state is module-scoped and a single module instance survives an
 * in-site navigation under the ClientRouter — so anything DERIVED from the
 * per-league config has to be re-derived with it, not just the config itself.
 *
 * The bug: a TheLeague owner with 2 filed claims navigating to an AFL page saw
 * the hub row badged "2" directly beside its own subtext, "Sign in to see your
 * claims", and the bell dot lit on a league where they hold no franchise.
 */
describe('per-league state does not survive a league hop', () => {
  const script = read('src/scripts/transaction-hub.ts');

  it('reads the claim count through the signed-in-here helper, not the raw store', () => {
    // Both display sites — the hub row and the bell dot — must go through it.
    const rawReads = [...script.matchAll(/thmClaims\?\.length/g)].length;
    const scopedReads = [...script.matchAll(/thmVisibleClaims\(\)\?\.length/g)].length;
    expect(scopedReads).toBeGreaterThanOrEqual(2);
    expect(rawReads, 'a raw thmClaims?.length read is the cross-league leak').toBe(0);
  });

  it('the helper gates on the CURRENT page config, re-read per call', () => {
    const fn = script.slice(script.indexOf('function thmVisibleClaims'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/thmConfig\(\)\?\.signedIn/);
  });
});

/**
 * A live read must settle or fail. WaiverPriorityModal learned this in #974 —
 * "a dialog parked on Reading… is the bug" — and the hub makes the same two
 * reads, so it carries the same time-box.
 */
describe('the hub time-boxes its live reads', () => {
  const script = read('src/scripts/transaction-hub.ts');

  it('both fetches abort rather than hanging forever', () => {
    expect(script).toMatch(/THM_LIVE_READ_TIMEOUT_MS/);
    // One AbortController per live read (claims + order), each cleared.
    expect([...script.matchAll(/new AbortController\(\)/g)].length).toBe(2);
    expect([...script.matchAll(/clearTimeout\(timer\)/g)].length).toBe(2);
    for (const m of script.matchAll(/fetch\('\/api\/waiver-(order|claims)'[^)]*\)/g)) {
      expect(m[0], `${m[0]} must pass an abort signal`).toMatch(/signal/);
    }
  });
});


/**
 * The route's actual Response — not its source text.
 *
 * A regex over the file is satisfied by an import line and would survive the
 * guard being deleted (GEMINI.md, "Test behavior, not source text"). This
 * repo has shipped green suites over flipped status codes before, so the
 * refusal is asserted by calling GET and reading the Response.
 */
vi.mock('../src/utils/auth', () => ({
  getAuthUser: () => mockUser,
}));

let mockUser: { id: string; franchiseId: string; leagueId: string } | null = null;

describe('/api/waiver-order refuses a league with no priority order', () => {
  const call = async () => {
    const { GET } = await import('../src/pages/api/waiver-order');
    return (GET as any)({ request: new Request('https://theleague.us/api/waiver-order') });
  };

  it('404s for TheLeague, and says why in a field a client can branch on', async () => {
    mockUser = { id: 'u1', franchiseId: '0001', leagueId: '13522' };
    const res = await call();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.usesPriority).toBe(false);
    // And it must never leak an order alongside the refusal.
    expect(body.order).toBeUndefined();
  });

  it('401s a signed-out caller before it ever considers the league', async () => {
    mockUser = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).needsLogin).toBe(true);
  });

  it('does not refuse the AFL, which really does run priority', async () => {
    mockUser = { id: 'u1', franchiseId: '0001', leagueId: '19621' };
    const res = await call();
    // It may still fail upstream in a test environment with no MFL — what it
    // must NOT do is answer the "this league has no order" refusal.
    if (res.status === 404) {
      expect((await res.json()).usesPriority).not.toBe(false);
    }
  });
});


/**
 * The live order is rolling — MFL renumbers it every time a claim is awarded —
 * so a cache that outlives the page view hands an owner a stale queue position
 * for as long as they keep browsing. `thmOrder` sits at module scope and the
 * module survives a ClientRouter navigation, so the reset has to be explicit.
 */
describe('the hub does not cache the waiver order across navigations', () => {
  const script = read('src/scripts/transaction-hub.ts');

  it('drops the cached order on every astro:page-load', () => {
    const poll = script.slice(script.indexOf('async function thmPoll'));
    const body = poll.slice(0, poll.indexOf('\n}'));
    expect(body).toMatch(/thmOrder = null/);
    expect(body).toMatch(/thmOrderError = null/);
    // Before the 60s debounce can return early, or the reset never runs.
    expect(body.indexOf('thmOrder = null')).toBeLessThan(body.indexOf('THM_DEBOUNCE_MS'));
  });

  it('and thmPoll is what astro:page-load calls', () => {
    expect(script).toMatch(/addEventListener\('astro:page-load', thmPoll\)/);
  });
});
