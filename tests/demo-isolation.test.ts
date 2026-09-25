/**
 * The custom-site demo's isolation rails (docs/plans/custom-site-demo.md).
 *
 * The demo is a `demo`-branch deployment in the same Vercel project as the real
 * site, so it inherits production's credentials. These tests pin the rails
 * that make that safe without trusting the dashboard: the boot scrub, the
 * fetch guard, the outbound guard, and the absence of elevated roles.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'fs';
import {
  applyDemoIsolation,
  createDemoFetch,
  DemoOutboundRefusedError,
  isDemoFetch,
  isForbiddenDemoEnvName,
  scrubDemoEnvironment,
} from '../src/utils/demo-isolation';
import {
  assertOutboundAllowed,
  DEMO_BRANCH,
  isDemoDeploy,
  OutboundBlockedError,
  outboundAllowed,
  shouldBlockIndexing,
} from '../src/utils/deploy-environment';
import { isCommissionerOrAdmin } from '../src/utils/auth';
import { DEMO_BRANCH as IGNORE_BUILD_DEMO_BRANCH } from '../scripts/vercel-ignore-build.mjs';

const TOUCHED = ['DEMO_PROFILE', 'VERCEL_GIT_COMMIT_REF', 'VERCEL_ENV'] as const;
const saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function demoOff() {
  delete process.env.DEMO_PROFILE;
  delete process.env.VERCEL_GIT_COMMIT_REF;
}

describe('isDemoDeploy', () => {
  it('is on for DEMO_PROFILE, and for the demo branch even when the variable is forgotten', () => {
    demoOff();
    expect(isDemoDeploy()).toBe(false);

    process.env.DEMO_PROFILE = 'dynasty';
    expect(isDemoDeploy()).toBe(true);

    delete process.env.DEMO_PROFILE;
    process.env.VERCEL_GIT_COMMIT_REF = DEMO_BRANCH;
    expect(isDemoDeploy()).toBe(true);

    process.env.VERCEL_GIT_COMMIT_REF = 'staging';
    expect(isDemoDeploy()).toBe(false);
  });

  it('shares its branch name with the ignore-build exemption', () => {
    expect(IGNORE_BUILD_DEMO_BRANCH).toBe(DEMO_BRANCH);
  });
});

describe('outbound guard on the demo', () => {
  it('blocks even a production deployment when it is the demo', () => {
    process.env.VERCEL_ENV = 'production';
    demoOff();
    expect(outboundAllowed()).toBe(true);

    process.env.DEMO_PROFILE = 'dynasty';
    expect(outboundAllowed()).toBe(false);
    expect(() => assertOutboundAllowed('MFL write')).toThrow(OutboundBlockedError);
  });

  it('keeps the demo out of search indexes on any host', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DEMO_PROFILE = 'dynasty';
    expect(shouldBlockIndexing({ hostname: 'dynasty.demo.mfl.football' })).toBe(true);
  });

  it('grants no commissioner or admin role on the demo', () => {
    const commissioner = {
      id: 'x',
      username: 'x',
      franchiseId: '0001',
      leagueId: '1',
      role: 'commissioner' as const,
    };
    process.env.DEMO_PROFILE = 'dynasty';
    expect(isCommissionerOrAdmin(commissioner as never)).toBe(false);
    demoOff();
    expect(isCommissionerOrAdmin(commissioner as never)).toBe(true);
  });
});

describe('environment scrub', () => {
  it('removes every credential family the real site uses', () => {
    // Every credential-shaped variable src/ reads today. A new one must either
    // match a forbidden family or be added to SAFE with a reason.
    const SAFE = new Set([
      'VERCEL', 'VERCEL_ENV', 'NODE_ENV', 'TZ',
      'VAPID_PUBLIC_KEY', // public by definition
      'VAPID_SUBJECT', // a mailto:, not a secret
      'GIPHY_API_KEY', // read-only public GIF search
    ]);
    const names = new Set<string>();
    for (const file of globSync('src/**/*.{ts,mjs,js,astro}')) {
      for (const m of readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
        names.add(m[1]);
      }
    }
    expect(names.size, 'the scan found no env reads — the glob is broken').toBeGreaterThan(10);
    const unscrubbed = [...names]
      .filter((n) => !n.startsWith('DEMO_') && !n.startsWith('VERCEL_') && !SAFE.has(n))
      .filter((n) => !isForbiddenDemoEnvName(n));
    expect(
      unscrubbed,
      'these variables survive the demo scrub — add a pattern to DEMO_FORBIDDEN_ENV_PATTERNS or, if genuinely not a secret, to SAFE here',
    ).toEqual([]);
  });

  it('replaces production Redis and the session key with the demo’s own, never falling back', () => {
    const env: NodeJS.ProcessEnv = {
      UPSTASH_REDIS_REST_URL: 'https://prod.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'prod-token',
      KV_REST_API_URL: 'https://prod.kv',
      JWT_SECRET: 'prod-secret',
      MFL_USER_ID: 'cookie',
      GROUPME_BOT_ID: 'bot',
      VAPID_PRIVATE_KEY: 'k',
      VAPID_PUBLIC_KEY: 'pub',
      DEMO_REDIS_REST_URL: 'https://demo.upstash.io',
      DEMO_REDIS_REST_TOKEN: 'demo-token',
      DEMO_JWT_SECRET: 'demo-secret',
      PATH: '/usr/bin',
    };
    const removed = scrubDemoEnvironment(env);
    expect(removed).toContain('MFL_USER_ID');
    expect(env.UPSTASH_REDIS_REST_URL).toBe('https://demo.upstash.io');
    expect(env.UPSTASH_REDIS_REST_TOKEN).toBe('demo-token');
    expect(env.JWT_SECRET).toBe('demo-secret');
    expect(env.KV_REST_API_URL).toBeUndefined();
    expect(env.MFL_USER_ID).toBeUndefined();
    expect(env.GROUPME_BOT_ID).toBeUndefined();
    expect(env.VAPID_PRIVATE_KEY).toBeUndefined();
    expect(env.VAPID_PUBLIC_KEY).toBe('pub');
    expect(env.PATH).toBe('/usr/bin');

    // Without demo values, production's are gone rather than kept.
    const bare: NodeJS.ProcessEnv = { UPSTASH_REDIS_REST_URL: 'https://prod', JWT_SECRET: 'prod' };
    scrubDemoEnvironment(bare);
    expect(bare.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(bare.JWT_SECRET).toBeUndefined();
  });
});

describe('fetch guard', () => {
  const passthrough = () => {
    const calls: string[] = [];
    const real = (async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response('real');
    }) as typeof fetch;
    return { calls, real };
  };

  it('never lets an MFL read or write reach the network', async () => {
    const { calls, real } = passthrough();
    const demoFetch = createDemoFetch(real);

    const read = await demoFetch('https://api.myfantasyleague.com/2026/export?TYPE=rosters&L=1&JSON=1');
    expect(read.status).toBe(200);
    expect((await read.json()).error).toBeDefined();

    const write = await demoFetch('https://www49.myfantasyleague.com/2026/import?TYPE=lineup', {
      method: 'POST',
      body: 'x=1',
    });
    expect(write.headers.get('X-Demo-Mfl')).toBe('write');
    expect(await write.text()).toContain('<error>');

    await demoFetch(new Request('https://WWW49.MyFantasyLeague.com/2026/add_drop?DELETE=1'));
    expect(calls).toEqual([]);
  });

  it('refuses chat, GitHub, LLM and push hosts, and passes everything else through', async () => {
    const { calls, real } = passthrough();
    const demoFetch = createDemoFetch(real);
    for (const url of [
      'https://api.groupme.com/v3/bots/post',
      'https://api.github.com/repos/x/y/issues',
      'https://api.anthropic.com/v1/messages',
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://web.push.apple.com/abc',
    ]) {
      await expect(demoFetch(url)).rejects.toBeInstanceOf(DemoOutboundRefusedError);
    }
    await demoFetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    // A lookalike host is not MFL.
    await demoFetch('https://myfantasyleague.com.example.org/');
    expect(calls).toHaveLength(2);
  });

  it('applies idempotently', () => {
    const target = { fetch: passthrough().real };
    applyDemoIsolation({}, target);
    const once = target.fetch;
    expect(isDemoFetch(once)).toBe(true);
    applyDemoIsolation({}, target);
    expect(target.fetch).toBe(once);
  });
});

describe('boot order', () => {
  // Side-effect imports run in source order. The isolation must run before any
  // module can read a credential, so it sits directly under the timezone pin.
  for (const file of ['src/middleware.ts', 'astro.config.ts']) {
    it(`${file} imports ensure-demo-isolation right after ensure-pt-timezone`, () => {
      const imports = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^import\s/.test(line));
      expect(imports[0]).toMatch(/ensure-pt-timezone/);
      expect(imports[1]).toMatch(/ensure-demo-isolation/);
    });
  }
});
