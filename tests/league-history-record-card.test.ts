import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRecordCardTree, isOwnLogoPath } from '../src/utils/league-history/record-card';

/**
 * The Record Book share card: it only ever fetches our own asset paths, and it draws
 * the holder plus the next four on one scale.
 */

const rows = [1, 2, 3, 4, 5, 6].map((rank) => ({
	rank,
	name: `Team ${rank}`,
	value: 200 - rank * 5,
	display: `${200 - rank * 5}.00`,
	context: '2020 · Week 3',
	owner: rank === 1 ? 'Ann' : null,
	icon: null,
}));

describe('Record card', () => {
	it('fetches only our own asset paths for the logo', () => {
		expect(isOwnLogoPath('/assets/theleague/icons/pigskins.png')).toBe(true);
		expect(isOwnLogoPath('https://example.com/x.png')).toBe(false);
		expect(isOwnLogoPath('//example.com/assets/x.png')).toBe(false);
		expect(isOwnLogoPath('/assets/../package.json')).toBe(false);
		expect(isOwnLogoPath('/assets/x.svg')).toBe(false);
	});

	it('shows the holder and the next four', () => {
		const tree = JSON.stringify(buildRecordCardTree({ leagueName: 'L', title: 'Most points', qualifier: null, unit: null, asc: false, rows }));
		for (const n of [1, 2, 3, 4, 5]) expect(tree).toContain(`Team ${n}`);
		expect(tree).not.toContain('Team 6');
		expect(tree).toContain('Ann · 2020 · Week 3');
	});

	it('never reads public/ from disk (it would bundle all of public/ into the function)', () => {
		const src = readFileSync(join(__dirname, '..', 'src/utils/league-history/record-card.ts'), 'utf8');
		expect(src).not.toMatch(/from 'node:fs'|from 'fs'/);
	});
});
