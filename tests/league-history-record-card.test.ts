import { describe, it, expect } from 'vitest';
import { buildRecordCardTree, localLogo } from '../src/utils/league-history/record-card';

/**
 * The Record Book share card: it only ever embeds our own files, and it draws
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
	it('embeds only local logo files, never a remote or escaping path', () => {
		expect(localLogo('https://example.com/x.png')).toBeNull();
		expect(localLogo('//example.com/x.png')).toBeNull();
		expect(localLogo('/../package.json')).toBeNull();
		expect(localLogo('/assets/nope-not-here.png')).toBeNull();
	});

	it('shows the holder and the next four', () => {
		const tree = JSON.stringify(buildRecordCardTree({ leagueName: 'L', title: 'Most points', qualifier: null, unit: null, asc: false, rows }));
		for (const n of [1, 2, 3, 4, 5]) expect(tree).toContain(`Team ${n}`);
		expect(tree).not.toContain('Team 6');
		expect(tree).toContain('Ann · 2020 · Week 3');
	});
});
