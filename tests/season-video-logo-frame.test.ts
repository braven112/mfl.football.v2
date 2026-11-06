/**
 * Season video — the team logo's circle (Brandon, 2026-11-06): the circle is
 * the default, and a logo already cut out can go without it. Draws the crown
 * card against a recording canvas and counts the circles drawn at the crest.
 */
import { describe, expect, it } from 'vitest';
import { drawFrame, type DrawAssets } from '../src/utils/season-video/draw';
import type { Scene } from '../src/utils/season-video/story';

function recorder() {
	const calls: { name: string; args: unknown[] }[] = [];
	const ctx = new Proxy({} as Record<string, unknown>, {
		get(target, prop: string) {
			if (prop in target) return target[prop];
			if (prop === 'measureText') return () => ({ width: 10 });
			if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} });
			return (...args: unknown[]) => void calls.push({ name: prop, args });
		},
		set(target, prop: string, value) {
			target[prop] = value;
			return true;
		},
	});
	return { ctx, calls };
}

const crown: Scene = {
	type: 'crown',
	duration: 6,
	palette: { bg: '#000', ink: '#fff', muted: '#ccc', accent: '#fc0', good: '#0f0', bad: '#f00' },
	kicker: 'Test',
	name: 'Team',
	line: 'Line',
	effect: 'none',
};
const logo = { width: 400, height: 300 } as unknown as DrawAssets['team'];

const crestArcs = (teamCircle?: boolean, r = 200) => {
	const { ctx, calls } = recorder();
	drawFrame(ctx as never, [crown], 3, { team: logo, opponents: new Map(), mark: null, wordmark: null, teamCircle }, 'Team');
	// The crest is drawn at radius 200 on the crown card, its halo at 236.
	return calls.filter((c) => c.name === 'arc' && c.args[2] === r).length;
};

describe('team logo frame', () => {
	it('draws the circle by default', () => {
		expect(crestArcs()).toBeGreaterThan(0);
	});
	it('leaves it off for a logo that is already cut out', () => {
		expect(crestArcs(false)).toBe(0);
	});
	it('draws no background behind it either: no halo without the circle', () => {
		expect(crestArcs(true, 236)).toBeGreaterThan(0);
		expect(crestArcs(false, 236)).toBe(0);
	});
});
