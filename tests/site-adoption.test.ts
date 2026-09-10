import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NotificationLeague } from '../src/config/notification-categories';

/**
 * Install + notification adoption on the Owner Activity page.
 *
 * Two things here are load-bearing rather than cosmetic:
 *
 *   - a franchise with NO push subscription is not counted in any category's
 *     opt-in number. It cannot receive anything, so counting its stored
 *     preference would report an audience that does not exist; and
 *   - the device count comes from HLEN, not from reading the subscription
 *     hashes. The values are full push endpoints, and the page only ever
 *     wanted the number.
 */

const LEAGUE: NotificationLeague = {
	features: {} as NotificationLeague['features'],
	ownersPoll: { enabled: false },
};

class FakeRedis {
	commands: string[] = [];
	strings = new Map<string, unknown>();
	hashLengths = new Map<string, number>();

	async mget<T>(...keys: string[]): Promise<(T | null)[]> {
		this.commands.push('MGET');
		return keys.map((k) => (this.strings.get(k) ?? null) as T | null);
	}
	async hlen(key: string): Promise<number> {
		this.commands.push('HLEN');
		return this.hashLengths.get(key) ?? 0;
	}
	async hgetall(): Promise<null> {
		this.commands.push('HGETALL');
		return null;
	}
}

async function loadWithRedis(redis: FakeRedis) {
	process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
	process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
	vi.doMock('@upstash/redis', () => ({
		Redis: class {
			constructor() {
				return redis as unknown as object;
			}
		},
	}));
	return import('../src/utils/site-adoption');
}

const FRANCHISES = ['0001', '0002', '0003', '0004'];

describe('getAdoptionSection', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('counts installs by how we learned about them', async () => {
		const redis = new FakeRedis();
		redis.strings.set(
			'app:install:13522:0001',
			JSON.stringify({ installedAt: '2026-08-01T00:00:00.000Z', source: 'standalone' }),
		);
		redis.strings.set('app:install:13522:0002', {
			installedAt: '2026-08-02T00:00:00.000Z',
			source: 'declared',
		});
		const mod = await loadWithRedis(redis);
		const { install } = await mod.getAdoptionSection('13522', FRANCHISES, LEAGUE);

		expect(install).toMatchObject({ installed: 2, total: 4, share: 50 });
		expect(install.sources.map((s) => s.source)).toEqual(['standalone', 'declared']);
	});

	it('only counts owners a notification could actually reach', async () => {
		const redis = new FakeRedis();
		redis.hashLengths.set('push:subs:13522:0001', 2);
		redis.hashLengths.set('push:subs:13522:0002', 1);
		// 0003 has a stored preference but no device — it must not be counted.
		redis.strings.set('push:prefs:13522:0003', JSON.stringify({ 'trade-offer': true }));

		const mod = await loadWithRedis(redis);
		const { push } = await mod.getAdoptionSection('13522', FRANCHISES, LEAGUE);

		expect(push).toMatchObject({ reachable: 2, total: 4, share: 50, devices: 3 });
		expect(push.categories.every((c) => c.on <= push.reachable)).toBe(true);
	});

	it('reads device counts with HLEN rather than pulling every endpoint', async () => {
		const redis = new FakeRedis();
		const mod = await loadWithRedis(redis);
		await mod.getAdoptionSection('13522', FRANCHISES, LEAGUE);

		expect(redis.commands.filter((c) => c === 'HGETALL')).toHaveLength(0);
		expect(redis.commands.filter((c) => c === 'HLEN')).toHaveLength(FRANCHISES.length);
		// Two MGETs (install + prefs) and one HLEN per franchise. Nothing else.
		expect(redis.commands).toHaveLength(2 + FRANCHISES.length);
	});

	it('survives one unparseable preferences record without hiding the section', async () => {
		const redis = new FakeRedis();
		redis.hashLengths.set('push:subs:13522:0001', 1);
		redis.hashLengths.set('push:subs:13522:0002', 1);
		redis.strings.set('push:prefs:13522:0001', '{not json');
		redis.strings.set(
			'app:install:13522:0001',
			JSON.stringify({ installedAt: '2026-08-01T00:00:00.000Z', source: 'standalone' }),
		);

		const mod = await loadWithRedis(redis);
		const out = await mod.getAdoptionSection('13522', FRANCHISES, LEAGUE);

		// The bad row falls back to category defaults; everything else survives.
		expect(out.push.reachable).toBe(2);
		expect(out.install.installed).toBe(1);
	});

	it('degrades to zeroes rather than throwing when storage is down', async () => {
		const redis = new FakeRedis();
		redis.mget = async () => {
			throw new Error('upstash down');
		};
		const mod = await loadWithRedis(redis);
		const out = await mod.getAdoptionSection('13522', FRANCHISES, LEAGUE);

		expect(out.install).toMatchObject({ installed: 0, total: 4, share: 0 });
		expect(out.push).toMatchObject({ reachable: 0, total: 4, devices: 0 });
	});
});
