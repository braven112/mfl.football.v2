import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARCHETYPES } from '../src/config/league-archetypes.mjs';
import {
  UPDATE_BRANCH_RE,
  cleanSpec,
  cleanUpdateSpec,
  specErrors,
  updateBranch,
  updateSpecErrors,
} from '../src/config/launch-spec.mjs';
import { DEFAULT_LEAGUE_ID, LEAGUES } from '../src/config/leagues-data.mjs';
import { setRegistryFeatures } from '../scripts/new-league.mjs';
import { planUpdate } from '../scripts/update-league-features.mjs';
import { readFileSync } from 'node:fs';
import { createSessionToken } from '../src/utils/session';

const SPEC = {
  mflId: '70707',
  slug: 'smith',
  name: 'Smith Family League',
  mflHost: 'www40.myfantasyleague.com',
  archetype: 'standard-redraft',
  features: { ...ARCHETYPES['standard-redraft'].features },
};

describe('launch spec (shared by the page and the generator)', () => {
  it('accepts a complete spec and strips anything else', () => {
    expect(specErrors(SPEC)).toEqual([]);
    const clean = cleanSpec({ ...SPEC, shortName: ' Smith ', evil: 'rm -rf', features: { ...SPEC.features } });
    expect(clean).not.toHaveProperty('evil');
    expect((clean as { shortName?: string }).shortName).toBe('Smith');
  });

  it('refuses a spec the generator would refuse', () => {
    expect(specErrors({ ...SPEC, slug: 'Smith' }).join()).toMatch(/slug/);
    expect(specErrors({ ...SPEC, mflHost: null }).join()).toMatch(/mflHost/);
    expect(specErrors({ ...SPEC, features: { contracts: true } }).join()).toMatch(/features must set exactly/);
    expect(specErrors({ ...SPEC, name: 'x'.repeat(81) }).join()).toMatch(/name/);
  });
});

function ctx(request: Request) {
  return { request, url: new URL(request.url), params: {}, props: {}, cookies: {} as any, locals: {} as any } as any;
}

function cookieFor(username: string) {
  const token = createSessionToken({
    userId: 'MFL_COOKIE_VALUE_secret123',
    username,
    franchiseId: '0003',
    leagueId: DEFAULT_LEAGUE_ID,
    role: 'commissioner',
  });
  return `session_token=${token}`;
}

const post = (path: string, body: unknown, cookie?: string) =>
  new Request(`http://test.invalid${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

describe('update spec (Change features)', () => {
  const archies = { slug: 'archies', features: { ...LEAGUES.archies.features } };

  it('accepts a real change to a package league, and strips anything else', () => {
    const spec = { ...archies, features: { ...archies.features, liveScoring: false }, evil: 1 };
    expect(updateSpecErrors(spec)).toEqual([]);
    expect(cleanUpdateSpec(spec)).not.toHaveProperty('evil');
  });

  it('refuses a hand-built league, a no-op and a broken dependency', () => {
    expect(updateSpecErrors({ slug: 'theleague', features: { ...LEAGUES.theleague.features } }).join()).toMatch(/hand-built/);
    expect(updateSpecErrors(archies).join()).toMatch(/nothing to change/);
    expect(updateSpecErrors({ ...archies, features: { ...archies.features, liveScoring: false, liveScoringSample: true } }).join())
      .toMatch(/liveScoring/i);
  });

  it('names a fresh branch per request', () => {
    const b = updateBranch('archies', new Date('2026-10-04T01:02:00Z'));
    expect(b).toBe('features/archies-202610040102');
    expect(UPDATE_BRANCH_RE.test(b)).toBe(true);
  });

  it('changes only the ticked values in the registry, keeping comments', () => {
    const src = readFileSync('src/config/leagues-data.mjs', 'utf8');
    const out = setRegistryFeatures(src, 'archies', { ...archies.features, liveScoring: false });
    const before = src.split('\n');
    const diff = out.split('\n').filter((line: string, i: number) => line !== before[i]);
    expect(diff).toEqual(['      liveScoring: false,']);
    expect(setRegistryFeatures(src, 'archies', archies.features)).toBe(src);
  });

  it('plans the registry edit plus the page sync', () => {
    const plan = planUpdate({ ...archies, features: { ...archies.features, liveScoring: false } });
    expect(plan.map((c) => `${c.content === null ? '-' : '+'}${c.path}`)).toEqual([
      '+src/config/leagues-data.mjs',
      '-src/pages/archies/live-scoring.astro',
      '-src/pages/archies/broadcast.astro',
      '+src/data/page-directory.json',
      '+src/config/nav-config.json',
    ]);
  });
});

describe('launcher endpoints are platform-admin only', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a signed-out caller and a mere commissioner', async () => {
    const { POST: analyze } = await import('../src/pages/api/admin/league-launcher/analyze');
    const { POST: launch } = await import('../src/pages/api/admin/league-launcher/launch');
    const { POST: update } = await import('../src/pages/api/admin/league-launcher/update');
    for (const handler of [analyze, launch, update]) {
      expect((await handler(ctx(post('/x', { mflId: '70707' })))).status).toBe(403);
      expect((await handler(ctx(post('/x', { spec: SPEC }, cookieFor('Some Commish'))))).status).toBe(403);
    }
  });

  it('validates the spec before dispatching anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { POST: launch } = await import('../src/pages/api/admin/league-launcher/launch');
    const res = await launch(ctx(post('/x', { spec: { ...SPEC, slug: 'bad slug' } }, cookieFor('braven112'))));
    expect(res.status).toBe(400);
    const { POST: update } = await import('../src/pages/api/admin/league-launcher/update');
    const res2 = await update(ctx(post('/x', { spec: { slug: 'theleague', features: {} } }, cookieFor('braven112'))));
    expect(res2.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
