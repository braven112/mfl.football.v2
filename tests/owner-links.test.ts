import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Owner links — an owner (or the commissioner) links a former team's seasons
 * to an owner's career, live from Redis, without a git change.
 *
 * Pinned here:
 *  - the overlay goes through buildOwnerTenures (the one boundary), and with no
 *    approved link it hands back the committed file itself, so a pending or
 *    rejected link changes NOTHING;
 *  - rebuilding with no link reproduces the committed file byte for byte in
 *    both leagues, which is what makes serving a rebuild safe;
 *  - an approved link moves exactly its seasons, keeps conservation, keeps the
 *    slot's current owner current, and forwards the absorbed owner's slug;
 *  - the store's three states and their transitions;
 *  - every endpoint takes its league from the SESSION, and only a commissioner
 *    of that league approves.
 */

vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => null }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'owner-links-test-secret';

const ROOT = process.cwd();
const { LEAGUES: LEAGUES_TYPED } = await import('../src/config/leagues-data.mjs');
const LEAGUES = LEAGUES_TYPED as Record<string, any>;
const { buildOwnerTenures } = await import('../src/utils/owner-tenures.mjs');
const { loadLeagueInputs } = await import('../scripts/lib/owner-tenure-inputs.mjs');
const overlay = await import('../src/utils/owner-link-overlay.mjs');
const store = await import('../src/utils/owner-link-store');
const live = await import('../src/utils/owner-link-live');
const { createSessionToken } = await import('../src/utils/session');
const linksApi = await import('../src/pages/api/owner-links/index');
const decideApi = await import('../src/pages/api/owner-links/decide');

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/owners-registry.json'), 'utf8'));
const readDerived = (slug: string, file: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, LEAGUES[slug].dataPath, 'derived', file), 'utf8'));

const FULL_LEAGUES = ['theleague', 'afl-fantasy'] as const;

/** A former owner with one tenure, and a current owner on another slot. */
function pickPair(committed: any) {
  const former = committed.owners.find((o: any) => !o.isCurrent && o.tenures.length === 1 && !o.isShared);
  const current = committed.owners.find(
    (o: any) => o.isCurrent && !o.isShared && o.currentFranchiseId !== former.tenures[0].franchiseId,
  );
  return { former, current };
}

const approvedLink = (slug: string, target: any, tenure: any, extra: Record<string, unknown> = {}) => ({
  id: `t-${tenure.franchiseId}-${tenure.yearStart}`,
  league: slug,
  status: 'approved',
  targetOwnerId: target.ownerId,
  franchiseId: tenure.franchiseId,
  yearStart: tenure.yearStart,
  yearEnd: tenure.yearEnd,
  proposedAt: '2026-11-17T00:00:00.000Z',
  decidedAt: '2026-11-17T00:00:00.000Z',
  ...extra,
});

describe.each(FULL_LEAGUES)('owner-link overlay — %s', (slug) => {
  const league = LEAGUES[slug];
  const inputs = loadLeagueInputs(ROOT, league)!;
  const committed = readDerived(slug, 'owner-tenures.json');
  const history = readDerived(slug, 'league-history.json');
  const { former, current } = pickPair(committed);
  const tenure = former.tenures[0];

  it('a rebuild with no links is the committed file, byte for byte', () => {
    const rebuilt = buildOwnerTenures({
      league,
      teams: inputs.teams,
      ledgerRows: inputs.ledgerRows,
      yearSummaries: inputs.yearSummaries,
      awardRows: inputs.awardRows as any,
      registry,
      generatedAt: committed.generatedAt,
    });
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(committed));
  });

  it('re-crediting the committed dataset to the committed tenures changes nothing', () => {
    expect(JSON.stringify(overlay.overlayHistoryDataset(history, committed))).toBe(JSON.stringify(history));
  });

  it.each(['pending', 'rejected'])('a %s link changes nothing — the committed object comes back', (status) => {
    const links = [approvedLink(slug, current, tenure, { status })];
    const result = overlay.overlayOwnerTenures({ league, committed, registry, inputs, links });
    expect(result.data).toBe(committed);
    expect(result.applied).toEqual([]);
  });

  it('an approved link moves exactly its seasons and keeps conservation', () => {
    const links = [approvedLink(slug, current, tenure)];
    const result = overlay.overlayOwnerTenures({ league, committed, registry, inputs, links });
    expect(result.error).toBeUndefined();
    expect(result.applied).toEqual([links[0].id]);
    const data = result.data;
    expect(data.counts.seasons).toBe(committed.counts.seasons);
    expect(data.counts.total).toBe(committed.counts.total - 1);

    const merged = data.owners.find((o: any) => o.ownerId === current.ownerId);
    expect(merged.isCurrent).toBe(true);
    expect(merged.currentFranchiseId).toBe(current.currentFranchiseId);
    expect(merged.totals.seasons).toBe(current.totals.seasons + former.totals.seasons);
    expect(merged.totals.wins).toBe(current.totals.wins + former.totals.wins);
    expect(merged.tenures.some((t: any) => t.franchiseId === tenure.franchiseId && t.yearStart === tenure.yearStart)).toBe(true);
    // The absorbed owner's page forwards to the merged career.
    expect(data.owners.some((o: any) => o.ownerId === former.ownerId)).toBe(false);
    expect(merged.previousSlugs).toContain(former.slug);
    // Every other owner is untouched.
    const others = (d: any) =>
      d.owners
        .filter((o: any) => o.ownerId !== current.ownerId && o.ownerId !== former.ownerId)
        .map((o: any) => `${o.ownerId}:${o.totals.seasons}:${o.totals.wins}`)
        .sort();
    expect(others(data)).toEqual(others(committed));
  });

  it('carving part of a tenure leaves the rest with its holder', () => {
    const multi = committed.owners.find(
      (o: any) => !o.isCurrent && o.tenures.length === 1 && o.tenures[0].seasons.length >= 3 && o.ownerId !== current.ownerId,
    );
    if (!multi) return;
    const t = multi.tenures[0];
    const links = [approvedLink(slug, current, { ...t, yearEnd: t.yearStart })];
    const data = overlay.overlayOwnerTenures({ league, committed, registry, inputs, links }).data;
    const rest = data.owners.find((o: any) => o.ownerId === multi.ownerId);
    expect(rest.totals.seasons).toBe(multi.totals.seasons - 1);
    expect(data.counts.seasons).toBe(committed.counts.seasons);
  });

  it('never takes the newest season, so the slot keeps its current owner', () => {
    const latest = overlay.latestLedgerYear(inputs.ledgerRows);
    const victim = committed.owners.find((o: any) => o.isCurrent && o.ownerId !== current.ownerId && !o.isShared);
    const links = [
      approvedLink(slug, current, { franchiseId: victim.currentFranchiseId, yearStart: latest - 1, yearEnd: latest }),
    ];
    const result = overlay.overlayOwnerTenures({ league, committed, registry, inputs, links });
    expect(result.data).toBe(committed);
    expect(result.skipped).toEqual([{ id: links[0].id, reason: 'current-season' }]);
  });

  it('Ask the History credits the linked seasons to the target owner', () => {
    const data = overlay.overlayOwnerTenures({
      league,
      committed,
      registry,
      inputs,
      links: [approvedLink(slug, current, tenure)],
    }).data;
    const ds = overlay.overlayHistoryDataset(history, data);
    const season = ds.seasons.find((s: any) => s.y === tenure.seasons[0].year);
    const team = season?.teams?.[tenure.franchiseId];
    if (!team) return; // a season the dataset leaves out (never played)
    expect(team.h.split('+')).toContain(current.ownerId);
    expect(ds.owners[former.ownerId]).toBeUndefined();
  });

  it('validates a request against the live tenures', () => {
    const latest = overlay.latestLedgerYear(inputs.ledgerRows);
    const ok = { targetOwnerId: current.ownerId, franchiseId: tenure.franchiseId, yearStart: tenure.yearStart, yearEnd: tenure.yearEnd };
    expect(overlay.validateLinkRequest(committed, latest, ok, [])).toBeNull();
    expect(overlay.validateLinkRequest(committed, latest, { ...ok, yearEnd: latest }, [])).toMatch(/current owner/);
    expect(overlay.validateLinkRequest(committed, latest, { ...ok, franchiseId: 'x' }, [])).toMatch(/franchise/);
    const own = current.tenures[0];
    expect(
      overlay.validateLinkRequest(committed, latest, { ...ok, franchiseId: own.franchiseId, yearStart: own.yearStart, yearEnd: own.yearStart }, []),
    ).toMatch(/already on this owner/);
    expect(overlay.validateLinkRequest(committed, latest, ok, [{ ...ok, status: 'pending' }])).toMatch(/already waiting/);
  });
});

describe('owner-link store states', () => {
  beforeEach(() => store._resetOwnerLinkMemory());
  const actor = { userId: 'u1', name: 'Owner', franchiseId: '0003', role: 'owner' as const };
  const commish = { userId: 'c1', name: 'Commish', franchiseId: '0001', role: 'commissioner' as const };
  const input = {
    league: 'theleague',
    targetOwnerId: 'own-0001',
    targetSlug: 'x',
    targetTitle: 'X',
    franchiseId: '0007',
    yearStart: 2007,
    yearEnd: 2009,
    names: [],
    fromOwnerId: null,
    fromTitle: null,
    note: null,
    proposedBy: actor,
  };

  it('an owner proposal is pending; approve, then take back', async () => {
    const link = await store.proposeOwnerLink(input);
    expect(link.status).toBe('pending');
    expect(link.decidedBy).toBeNull();
    const approved = await store.decideOwnerLink('theleague', link.id, 'approved', commish);
    expect(approved).toMatchObject({ ok: true, link: { status: 'approved', decidedBy: commish } });
    expect(await store.decideOwnerLink('theleague', link.id, 'approved', commish)).toEqual({ ok: false, reason: 'unchanged' });
    const back = await store.decideOwnerLink('theleague', link.id, 'rejected', commish, 'not you');
    expect(back).toMatchObject({ ok: true, link: { status: 'rejected', decisionNote: 'not you' } });
    // A declined request is closed.
    expect(await store.decideOwnerLink('theleague', link.id, 'approved', commish)).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it("a commissioner's own link is approved on creation", async () => {
    const link = await store.createApprovedOwnerLink({ ...input, proposedBy: commish });
    expect(link.status).toBe('approved');
    expect(link.decidedBy).toEqual(commish);
  });

  it('keys are per league — one league never reads the other', async () => {
    const link = await store.proposeOwnerLink(input);
    expect(store.ownerLinksKey('theleague')).toBe('owner-links:theleague');
    expect(await store.listOwnerLinks('afl-fantasy')).toEqual([]);
    expect(await store.getOwnerLink('afl-fantasy', link.id)).toBeNull();
    expect((await store.listOwnerLinks('theleague')).map((l) => l.id)).toEqual([link.id]);
  });
});

describe('owner-link endpoints — session-scoped auth', () => {
  beforeEach(() => {
    store._resetOwnerLinkMemory();
    live.invalidateOwnerLinks('theleague');
    live.invalidateOwnerLinks('afl-fantasy');
  });

  const cookie = (leagueSlug: string, franchiseId: string, role: 'owner' | 'commissioner') =>
    `session_token=${createSessionToken({
      userId: `u-${leagueSlug}-${franchiseId}-${role}`,
      username: role === 'owner' ? 'An Owner' : 'The Commish',
      franchiseId,
      leagueId: LEAGUES[leagueSlug].id,
      role,
    })}`;
  const req = (url: string, init: { cookie?: string; body?: unknown } = {}) =>
    new Request(`http://localhost${url}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  const call = (handler: any, request: Request) => handler({ request, url: new URL(request.url) } as any) as Promise<Response>;

  const committed = readDerived('theleague', 'owner-tenures.json');
  const { former, current } = pickPair(committed);
  const tenure = former.tenures[0];
  const body = { franchiseId: tenure.franchiseId, yearStart: tenure.yearStart, yearEnd: tenure.yearEnd };

  it('refuses a signed-out caller', async () => {
    expect((await call(linksApi.GET, req('/api/owner-links'))).status).toBe(401);
    expect((await call(linksApi.POST, req('/api/owner-links', { body }))).status).toBe(401);
    expect((await call(decideApi.POST, req('/api/owner-links/decide', { body: { id: 'x', decision: 'approved' } }))).status).toBe(401);
  });

  it('an owner files a PENDING link for their own owner page, and it changes nothing live', async () => {
    const owner = cookie('theleague', current.currentFranchiseId, 'owner');
    const res = await call(linksApi.POST, req('/api/owner-links', { cookie: owner, body }));
    expect(res.status).toBe(201);
    const { link } = await res.json();
    expect(link).toMatchObject({ status: 'pending', league: 'theleague', targetOwnerId: current.ownerId });
    live.invalidateOwnerLinks('theleague');
    const liveData = await live.loadLiveOwnerTenures('theleague');
    expect(liveData!.owners.find((o: any) => o.ownerId === former.ownerId)).toBeTruthy();
    expect(liveData!.counts.total).toBe(committed.counts.total);
  });

  it("an owner cannot file for someone else's owner page, or decide anything", async () => {
    const owner = cookie('theleague', current.currentFranchiseId, 'owner');
    const someoneElse = committed.owners.find((o: any) => o.ownerId !== current.ownerId);
    const res = await call(linksApi.POST, req('/api/owner-links', { cookie: owner, body: { ...body, targetOwnerId: someoneElse.ownerId } }));
    expect(res.status).toBe(403);
    const filed = await (await call(linksApi.POST, req('/api/owner-links', { cookie: owner, body }))).json();
    const decide = await call(decideApi.POST, req('/api/owner-links/decide', { cookie: owner, body: { id: filed.link.id, decision: 'approved' } }));
    expect(decide.status).toBe(403);
  });

  it('the commissioner approves and the link is live on the next read', async () => {
    const owner = cookie('theleague', current.currentFranchiseId, 'owner');
    const filed = await (await call(linksApi.POST, req('/api/owner-links', { cookie: owner, body }))).json();
    const commish = cookie('theleague', '0001', 'commissioner');
    const res = await call(decideApi.POST, req('/api/owner-links/decide', { cookie: commish, body: { id: filed.link.id, decision: 'approved' } }));
    expect(res.status).toBe(200);
    const liveData = await live.loadLiveOwnerTenures('theleague');
    expect(liveData!.owners.find((o: any) => o.ownerId === former.ownerId)).toBeUndefined();
    const merged = liveData!.owners.find((o: any) => o.ownerId === current.ownerId)!;
    expect(merged.totals.seasons).toBe(current.totals.seasons + former.totals.seasons);
  });

  it("another league's commissioner cannot reach this league's link", async () => {
    const owner = cookie('theleague', current.currentFranchiseId, 'owner');
    const filed = await (await call(linksApi.POST, req('/api/owner-links', { cookie: owner, body }))).json();
    const aflCommish = cookie('afl-fantasy', '0001', 'commissioner');
    const res = await call(decideApi.POST, req('/api/owner-links/decide', { cookie: aflCommish, body: { id: filed.link.id, decision: 'approved' } }));
    expect(res.status).toBe(404);
    expect((await store.getOwnerLink('theleague', filed.link.id))!.status).toBe('pending');
  });

  it("a commissioner's direct link is approved and live at once", async () => {
    const commish = cookie('theleague', '0001', 'commissioner');
    const res = await call(linksApi.POST, req('/api/owner-links', { cookie: commish, body: { ...body, targetOwnerId: current.ownerId } }));
    expect(res.status).toBe(201);
    expect((await res.json()).link.status).toBe('approved');
    const liveData = await live.loadLiveOwnerTenures('theleague');
    expect(liveData!.owners.find((o: any) => o.ownerId === former.ownerId)).toBeUndefined();
  });

  it('GET shows an owner only their own requests', async () => {
    const owner = cookie('theleague', current.currentFranchiseId, 'owner');
    await call(linksApi.POST, req('/api/owner-links', { cookie: owner, body }));
    const otherOwner = committed.owners.find((o: any) => o.isCurrent && o.currentFranchiseId !== current.currentFranchiseId);
    const mine = await (await call(linksApi.GET, req('/api/owner-links', { cookie: owner }))).json();
    const theirs = await (await call(linksApi.GET, req('/api/owner-links', { cookie: cookie('theleague', otherOwner.currentFranchiseId, 'owner') }))).json();
    expect(mine.links).toHaveLength(1);
    expect(theirs.links).toHaveLength(0);
    expect(theirs.canReview).toBe(false);
  });
});
