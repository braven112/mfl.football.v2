/**
 * Guard: POST /api/groupme/sync requires an authorized caller.
 *
 * It used to require nothing at all — the handler was `export const POST:
 * APIRoute = async () => {` and never received the request, so it could not
 * have checked anything. Any anonymous caller could make us poll the GroupMe
 * API and write to Redis, exhausting the service token's rate limit, and the
 * route's error path reports UPSTASH/KV URL prefixes for debugging, so a
 * forced failure leaked infrastructure detail too.
 *
 * The sibling cron route (/api/cron/push-fanout) already had the right shape:
 * a CRON_SECRET bearer that fails CLOSED when the secret is unset, so a
 * forgotten env var can never make `Bearer undefined` a valid credential.
 * This route accepts that OR a signed-in commissioner, because unlike
 * push-fanout its docstring promises a manual admin trigger.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAuthorizedSyncCaller } from '../src/pages/api/groupme/sync';
import { createSessionToken } from '../src/utils/session';
import { getLeagueBySlug } from '../src/config/leagues';

const THELEAGUE = getLeagueBySlug('theleague')!;
const AFL = getLeagueBySlug('afl-fantasy')!;

/** A request carrying a real signed session cookie for `role`. */
const signedInAs = (
  role: 'owner' | 'commissioner' | 'admin',
  leagueId: string = THELEAGUE.id,
) => {
  const token = createSessionToken({
    userId: 'u1',
    username: 'tester',
    franchiseId: '0002', // not an admin-fallback franchise
    leagueId,
    role,
  });
  return new Request('https://www.theleague.us/api/groupme/sync', {
    method: 'POST',
    headers: { cookie: `session_token=${token}` },
  });
};

const withHeaders = (headers: Record<string, string> = {}) =>
  new Request('https://www.theleague.us/api/groupme/sync', { method: 'POST', headers });

const ORIGINAL_SECRET = process.env.CRON_SECRET;
beforeEach(() => { process.env.CRON_SECRET = 'test-secret'; });
afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('isAuthorizedSyncCaller', () => {
  it('rejects an anonymous caller — the hole this closes', () => {
    expect(isAuthorizedSyncCaller(withHeaders())).toBe(false);
  });

  it('accepts the CRON_SECRET bearer', () => {
    expect(isAuthorizedSyncCaller(withHeaders({ authorization: 'Bearer test-secret' }))).toBe(true);
  });

  it('rejects a wrong or malformed bearer', () => {
    for (const authorization of [
      'Bearer wrong',
      'test-secret',
      'Basic test-secret',
      'Bearer ',
      'Bearer test-secret extra',
    ]) {
      expect(isAuthorizedSyncCaller(withHeaders({ authorization })), authorization).toBe(false);
    }
  });

  it('authorizes NOBODY by bearer when CRON_SECRET is unset', () => {
    // The push-fanout lesson: without this, an environment that simply forgot
    // the variable accepts `Bearer undefined` from anyone.
    delete process.env.CRON_SECRET;
    expect(isAuthorizedSyncCaller(withHeaders({ authorization: 'Bearer undefined' }))).toBe(false);
    expect(isAuthorizedSyncCaller(withHeaders({ authorization: 'Bearer ' }))).toBe(false);
    expect(isAuthorizedSyncCaller(withHeaders())).toBe(false);
  });

  it('accepts a signed-in commissioner, and an admin', () => {
    expect(isAuthorizedSyncCaller(signedInAs('commissioner'))).toBe(true);
    expect(isAuthorizedSyncCaller(signedInAs('admin'))).toBe(true);
  });

  it('rejects a signed-in ordinary owner', () => {
    expect(isAuthorizedSyncCaller(signedInAs('owner'))).toBe(false);
  });

  it('still lets a commissioner in when CRON_SECRET is unset', () => {
    // Session is checked first precisely so the manual trigger survives an
    // environment with no cron secret configured.
    delete process.env.CRON_SECRET;
    expect(isAuthorizedSyncCaller(signedInAs('commissioner'))).toBe(true);
  });

  it("rejects another league's commissioner", () => {
    // GROUPME_GROUP_ID names ONE group, TheLeague's. An AFL commissioner has
    // no business driving that sync, or reading the Upstash/KV prefixes the
    // route's error path reports. CLAUDE.md's cross-league admin rule.
    expect(isAuthorizedSyncCaller(signedInAs('commissioner', AFL.id))).toBe(false);
    expect(isAuthorizedSyncCaller(signedInAs('admin', AFL.id))).toBe(false);
  });

  it('rejects a forged / unsigned session cookie', () => {
    const forged = new Request('https://www.theleague.us/api/groupme/sync', {
      method: 'POST',
      headers: { cookie: 'session_token=not.a.real.token' },
    });
    expect(isAuthorizedSyncCaller(forged)).toBe(false);
  });
});

describe('the sync route wires the gate in', () => {
  it('checks authorization before doing any work', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync(new URL('../src/pages/api/groupme/sync.ts', import.meta.url), 'utf8'),
    );
    const gateAt = src.indexOf('isAuthorizedSyncCaller(request)');
    const workAt = src.indexOf('checkServiceTokenHealth()');
    expect(gateAt).toBeGreaterThan(-1);
    expect(workAt).toBeGreaterThan(-1);
    expect(gateAt, 'the gate must run before the route touches GroupMe').toBeLessThan(workAt);
    // The handler must actually receive the request; `async ()` was the bug.
    expect(src).toMatch(/export const POST: APIRoute = async \(\{ request \}\)/);
  });
});
