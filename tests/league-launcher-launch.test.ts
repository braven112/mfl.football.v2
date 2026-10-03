import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARCHETYPES } from '../src/config/league-archetypes.mjs';
import { cleanSpec, specErrors } from '../src/config/launch-spec.mjs';
import { DEFAULT_LEAGUE_ID } from '../src/config/leagues-data.mjs';
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

describe('launcher endpoints are platform-admin only', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses a signed-out caller and a mere commissioner', async () => {
    const { POST: analyze } = await import('../src/pages/api/admin/league-launcher/analyze');
    const { POST: launch } = await import('../src/pages/api/admin/league-launcher/launch');
    for (const handler of [analyze, launch]) {
      expect((await handler(ctx(post('/x', { mflId: '70707' })))).status).toBe(403);
      expect((await handler(ctx(post('/x', { spec: SPEC }, cookieFor('Some Commish'))))).status).toBe(403);
    }
  });

  it('validates the spec before dispatching anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { POST: launch } = await import('../src/pages/api/admin/league-launcher/launch');
    const res = await launch(ctx(post('/x', { spec: { ...SPEC, slug: 'bad slug' } }, cookieFor('braven112'))));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
