/**
 * Season video — the opt-in email box. Pins that nothing reaches Kit without
 * consent and a real-looking address, and that a subscriber gets the
 * "Season video" tag plus their platform's, with tags created by name.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { KIT_TAG, normalizeEmail, platformOf, subscribeToKit, type KitFetch } from '../src/utils/season-video/kit-optin';

describe('normalizeEmail', () => {
	it('keeps real addresses and refuses the rest', () => {
		expect(normalizeEmail('  Brandon@Example.com ')).toBe('brandon@example.com');
		expect(normalizeEmail('nope')).toBeNull();
		expect(normalizeEmail('a@b')).toBeNull();
		expect(normalizeEmail('x <y@z.com>')).toBeNull();
		expect(normalizeEmail(42)).toBeNull();
	});
	it('reads only the platforms we pull from', () => {
		expect(platformOf('espn')).toBe('espn');
		expect(platformOf('manual')).toBeNull();
	});
});

describe('subscribeToKit', () => {
	it('adds the subscriber, then tags them Season video and their platform', async () => {
		const calls: string[] = [];
		const kit: KitFetch = async (path, init) => {
			calls.push(`${init.method} ${path}`);
			if (path === '/tags') return { status: 201, json: { tag: { id: (init.body as { name: string }).name === KIT_TAG ? 1 : 2 } } };
			return { status: 201, json: {} };
		};
		expect(await subscribeToKit(kit, 'a@b.co', 'sleeper')).toBe(true);
		expect(calls).toEqual(['POST /subscribers', 'POST /tags', 'POST /tags/1/subscribers', 'POST /tags', 'POST /tags/2/subscribers']);
	});
	it('stops when Kit refuses the address', async () => {
		const kit: KitFetch = async () => ({ status: 422, json: {} });
		expect(await subscribeToKit(kit, 'a@b.co', null)).toBe(false);
	});
});

describe('the endpoint', () => {
	const src = readFileSync('src/pages/api/season-video-email.ts', 'utf8');
	it('refuses without the consent tick, and checks the caps before Kit', () => {
		expect(src).toMatch(/body\.consent !== true/);
		expect(src.indexOf('allowEmailOptIn()')).toBeLessThan(src.indexOf('subscribeToKit('));
		expect(src.indexOf('body.consent !== true')).toBeLessThan(src.indexOf('subscribeToKit('));
		// Staging and previews never add a real person to the real list.
		expect(src.indexOf('outboundAllowed()')).toBeLessThan(src.indexOf('subscribeToKit('));
	});
});
