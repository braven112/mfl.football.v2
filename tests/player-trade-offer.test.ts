/**
 * The trade offer — the rostered player's counterpart to the claim offer.
 *
 * PlayerDetailsModal offers free agents a Claim/Bid button. A rostered player
 * had nothing, so the modal's one actionable affordance simply vanished for
 * ~85% of the league's players. He now gets "Trade for him", linking into the
 * league's Trade Builder with the holding franchise and the player already
 * selected (Sep 2026).
 *
 * Four ways to ship that wrong, each pinned below.
 *
 * 1. OFFERING A TRADE FOR YOUR OWN PLAYER. Nobody trades with themselves, and
 *    the AFL builder in particular resolves `from` to the signed-in owner, so
 *    a link naming their own club puts one team on both sides of the form. The
 *    server leaves the viewer's own roster out of `tradeTargets` for this.
 *
 * 2. CROSSING THE CONFERENCE LINE. The AFL rosters the same player once per
 *    conference and its builder only accepts a same-conference `to` — it
 *    silently substitutes a DIFFERENT team for an out-of-conference id, so the
 *    owner lands on a roster that has nothing to do with the player they
 *    clicked. `tradeTargets` is therefore built under the SAME scoping as
 *    `rosteredIds`, in the same pass, rather than from a second roster read.
 *
 * 3. THE TWO BUILDERS SPEAK DIFFERENT DIALECTS. TheLeague takes `?b=&bp=`, the
 *    AFL `?to=&target=`, and neither URL announces which it is. One module owns
 *    the mapping; a hand-built link in the modal is how half the league gets a
 *    builder that ignores its query string entirely.
 *
 * 4. AUCTION SEASON TAKING THE BUTTON DOWN WITH IT. The claim context's
 *    `canClaim` goes false for the whole auction, and the client used to
 *    DISCARD the context when it did. Trades run all offseason, so the context
 *    is now retained on `signedIn` and each affordance gates itself — which
 *    means the claim side must gate EXPLICITLY, or a degraded MFL read (empty
 *    rostered set) reads as "the whole league is a free agent".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTradeBuilderPath, leagueHasTradeBuilder } from '../src/utils/trade-builder-link';
import { pathHasLeaguePrefix, resolveLeaguePath } from '../src/utils/nav-utils';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const MODAL = 'src/components/theleague/PlayerDetailsModal.astro';
const CLIENT = 'src/utils/player-claim-client.ts';
const SERVER = 'src/utils/claim-context.ts';

// ---------------------------------------------------------------------------
// 3. The two builders' dialects
// ---------------------------------------------------------------------------
describe('the trade-builder link speaks each league its own dialect', () => {
  it("uses TheLeague's ?b= / ?bp=", () => {
    const path = buildTradeBuilderPath({
      scope: 'theleague',
      franchiseId: '0007',
      playerId: '13145',
    });
    const url = new URL(path!, 'https://theleague.us');
    expect(url.pathname).toBe('/theleague/trade-builder');
    expect(url.searchParams.get('b')).toBe('0007');
    expect(url.searchParams.get('bp')).toBe('13145');
  });

  it("uses the AFL's ?to= / ?target=", () => {
    const path = buildTradeBuilderPath({
      scope: 'afl',
      franchiseId: '0007',
      playerId: '13145',
    });
    const url = new URL(path!, 'https://afl-fantasy.com');
    expect(url.pathname).toBe('/afl-fantasy/trade-builder');
    expect(url.searchParams.get('to')).toBe('0007');
    expect(url.searchParams.get('target')).toBe('13145');
  });

  it('names ONLY the counterparty — never the viewer, on either dialect', () => {
    // Both builders derive the viewer's own side (TheLeague seats them on the
    // empty side, the AFL defaults `from` to the session). A second franchise
    // in the link is how the same club lands on both sides of the trade.
    for (const scope of ['theleague', 'afl'] as const) {
      const path = buildTradeBuilderPath({ scope, franchiseId: '0007', playerId: '13145' });
      const params = new URL(path!, 'https://x.test').searchParams;
      expect([...params.values()].filter((v) => v === '0007')).toHaveLength(1);
      expect(params.has('a')).toBe(false);
      expect(params.has('from')).toBe(false);
    }
  });

  it('offers nothing for a league with no builder', () => {
    // Best Ball is draft-only. A guessed path is a 404, which is worse than
    // no button at all.
    expect(leagueHasTradeBuilder('bb1')).toBe(false);
    expect(
      buildTradeBuilderPath({ scope: 'bb1', franchiseId: '0007', playerId: '13145' })
    ).toBeNull();
  });

  it('offers nothing on incomplete input', () => {
    expect(buildTradeBuilderPath({ scope: 'afl', franchiseId: '', playerId: '1' })).toBeNull();
    expect(buildTradeBuilderPath({ scope: 'afl', franchiseId: '1', playerId: '' })).toBeNull();
  });

  it('the modal builds its href through this module, not by hand', () => {
    const src = read(MODAL);
    expect(src).toContain('buildTradeBuilderPath');
    // A literal builder path in the modal is a second copy of the dialect
    // table that stops learning when either builder's params change.
    expect(src).not.toMatch(/['"`]\/(theleague|afl-fantasy)\/trade-builder/);
  });
});

describe('the href survives an apex host', () => {
  it('strips the league prefix only when the page has none', () => {
    // theleague.us serves /trade-builder; theleague.us/theleague/... 404s.
    expect(pathHasLeaguePrefix('/theleague/players')).toBe(true);
    expect(pathHasLeaguePrefix('/afl-fantasy/rosters')).toBe(true);
    expect(pathHasLeaguePrefix('/players')).toBe(false);
    expect(pathHasLeaguePrefix('/')).toBe(false);
    // Not a prefix match on a same-named sibling path.
    expect(pathHasLeaguePrefix('/theleague-extra/x')).toBe(false);

    const path = buildTradeBuilderPath({
      scope: 'theleague',
      franchiseId: '0007',
      playerId: '13145',
    })!;
    expect(resolveLeaguePath(path, true)).toBe(path.replace('/theleague', ''));
    expect(resolveLeaguePath(path, true).startsWith('/trade-builder?')).toBe(true);
    expect(resolveLeaguePath(path, false)).toBe(path);
  });

  it('the card never contradicts its own "Rostered by" strip', () => {
    // The strip is painted from the PAGE's payload franchiseId; the button from
    // the server's conference-scoped tradeTargets. In the AFL those legitimately
    // disagree (one holder per conference), so the copy must name the
    // relationship rather than assert an ownership the card just denied.
    const src = read(MODAL);
    expect(src).toContain('holds him in your conference');
    expect(src).toMatch(/String\(shown\) !== String\(target\.franchiseId\)/);
  });

  it('the modal derives the host from the path, not a server flag', () => {
    // `hideLeaguePrefix` is an Astro local — it reaches the layout and never
    // the browser, so a client script has only the path it stands on.
    const src = read(MODAL);
    expect(src).toContain('pathHasLeaguePrefix(window.location.pathname)');
    // And it goes through the shared helper rather than spelling slugs out,
    // which would stop learning about new leagues (league literal guard).
    expect(src).not.toMatch(/afl-fantasy\|best-ball/);
  });
});

// ---------------------------------------------------------------------------
// 1 + 2. What the server puts in the map
// ---------------------------------------------------------------------------
describe('the server decides who a trade may target', () => {
  const src = read(SERVER);

  it("excludes the viewer's own franchise", () => {
    expect(src).toMatch(/String\(fid\) !== String\(user\.franchiseId\)/);
  });

  it('scopes tradeTargets with the SAME check as rosteredIds, in one pass', () => {
    // Two passes drift: the AFL's conference rule lives in `countsAgainstMe`,
    // and a trade map built from an unscoped roster read would offer the other
    // conference's holder — whom the AFL builder then silently swaps out.
    const loop = src.slice(
      src.indexOf('const rosteredIds = new Set<string>()'),
      src.indexOf('const ownIds =')
    );
    expect(loop).toContain('countsAgainstMe(fid)');
    expect(loop).toContain('rosteredIds.add(id)');
    expect(loop).toContain('tradeTargets[id]');
    // One iteration over one roster set.
    expect(loop.match(/for \(const \[fid, list\] of Object\.entries\(rosters\)\)/g))
      .toHaveLength(1);
  });

  it('fails CLOSED when the viewer cannot be placed in a conference', () => {
    // conferenceOfFranchise returns null on three separate degradations, and
    // countsAgainstMe then compares null to null and admits all 24 clubs.
    // That is merely conservative for rosteredIds (more players read as taken)
    // and actively wrong for trades (it would name a rival-CONFERENCE holder,
    // which the AFL builder silently swaps for a different team). The two
    // consumers must therefore NOT share that fallback.
    expect(src).toContain('const canPlaceViewer = leagueWide || myConference !== null');
    expect(src).toMatch(/const theirs = canPlaceViewer && String\(fid\) !== String\(user\.franchiseId\)/);
    // …and the claim set keeps the behaviour it shipped with: rosteredIds is
    // still gated on countsAgainstMe alone, never on canPlaceViewer.
    const loop = src.slice(
      src.indexOf('const rosteredIds = new Set<string>()'),
      src.indexOf('const ownIds =')
    );
    expect(loop).toContain('rosteredIds.add(id)');
    expect(loop.slice(0, loop.indexOf('rosteredIds.add(id)'))).not.toContain(
      'canPlaceViewer ? ',
    );
  });

  it('ships franchise names only for the clubs it actually named', () => {
    // Otherwise a conference-scoped league leaks the other conference's teams.
    expect(src).toContain('const named = new Set(Object.values(tradeTargets))');
    expect(src).toContain('named.has(fid)');
  });

  it('every degraded early return offers nobody', () => {
    // `base` is returned on each failed MFL read. An absent tradeTargets would
    // make the client read `undefined[id]` — an empty one offers nothing,
    // which is the correct quiet outcome.
    const base = src.slice(src.indexOf('const base: ClaimContext'), src.indexOf('// Every early return'));
    expect(base).toContain('tradeTargets: {}');
    expect(base).toContain('franchiseNames: {}');
  });
});

// ---------------------------------------------------------------------------
// 4. The client's gating, with a real context
// ---------------------------------------------------------------------------
describe('the client offers each affordance on its own precondition', () => {
  const dataset: Record<string, string | undefined> = { league: 'theleague' };
  let client: typeof import('../src/utils/player-claim-client');

  const context = (over: Record<string, unknown> = {}) => ({
    signedIn: true,
    canClaim: true,
    verb: 'Bid',
    system: 'bbid',
    franchiseId: '0001',
    rules: {},
    roster: [{ id: '1', name: 'Mine' }],
    year: 2026,
    windowMode: 'open',
    windowLabel: '',
    // 100 is mine, 200 is a rival's, 300 is unrostered.
    rosteredIds: ['100', '200'],
    tradeTargets: { '200': '0007' },
    franchiseNames: { '0007': 'Pacific Pigskins' },
    ...over,
  });

  const load = async (over: Record<string, unknown> = {}) => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => context(over),
    });
    await client.loadClaimContext();
  };

  beforeEach(async () => {
    vi.resetModules();
    (globalThis as any).document = { documentElement: { dataset } };
    (globalThis as any).window = {};
    dataset.league = 'theleague';
    client = await import('../src/utils/player-claim-client');
  });

  afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
    delete (globalThis as any).fetch;
  });

  it("names the rival's franchise and team for a player they hold", async () => {
    await load();
    expect(client.tradeTargetFor('200')).toEqual({
      franchiseId: '0007',
      teamName: 'Pacific Pigskins',
      playerId: '200',
    });
  });

  it("offers no trade for a player on the viewer's OWN roster", async () => {
    await load();
    expect(client.tradeTargetFor('100')).toBeNull();
    // …and no claim either: he is already theirs.
    expect(client.offerFor('100')).toBeNull();
  });

  it('offers a free agent the claim, not a trade', async () => {
    await load();
    expect(client.tradeTargetFor('300')).toBeNull();
    expect(client.offerFor('300')).not.toBeNull();
  });

  it('keeps offering trades once claims shut off for the auction', async () => {
    // The regression this pins: the context used to be discarded whole when
    // canClaim went false, which is the entire auction season.
    await load({ canClaim: false });
    expect(client.tradeTargetFor('200')).not.toBeNull();
    expect(client.offerFor('300')).toBeNull();
  });

  it('offers NOTHING on a degraded read, rather than the whole league', async () => {
    // canClaim false with an empty rostered set: every player would read as a
    // free agent if offerFor leaned on the set alone.
    await load({ canClaim: false, rosteredIds: [], tradeTargets: {} });
    expect(client.offerFor('300')).toBeNull();
    expect(client.offerFor('100')).toBeNull();
    expect(client.tradeTargetFor('200')).toBeNull();
  });

  it('offers nothing at all when nobody is signed in', async () => {
    await load({ signedIn: false, canClaim: false });
    expect(client.tradeTargetFor('200')).toBeNull();
    expect(client.offerFor('300')).toBeNull();
  });

  it('never hands a claim form a context that cannot claim', async () => {
    // Asserted both ways round, or the negative passes for the wrong reason:
    // the context is now RETAINED when canClaim is false (for the trade
    // button), so "not published" has to be a decision rather than an absence.
    await load();
    expect((globalThis as any).window.__playerClaimContext).toBeDefined();

    vi.resetModules();
    (globalThis as any).window = {};
    client = await import('../src/utils/player-claim-client');
    await load({ canClaim: false });
    expect(client.peekClaimContext()).not.toBeNull();
    expect((globalThis as any).window.__playerClaimContext).toBeUndefined();
  });
});
