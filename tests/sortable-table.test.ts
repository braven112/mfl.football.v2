/**
 * Click-to-sort for the analytics tables (`src/utils/sortable-table.ts`).
 * The pure halves: what a tap does, and how cell values compare.
 */
import { describe, it, expect } from 'vitest';
import { compareSortValues, nextSortDir, sortNumber } from '../src/utils/sortable-table';

describe('nextSortDir', () => {
	it('numbers open high to low, text A to Z, and a second tap reverses', () => {
		expect(nextSortDir('num', null)).toBe('descending');
		expect(nextSortDir('text', null)).toBe('ascending');
		expect(nextSortDir('num', 'descending')).toBe('ascending');
		expect(nextSortDir('text', 'ascending')).toBe('descending');
	});
});

describe('compareSortValues', () => {
	it('reads formatted numbers and sinks blanks and dashes', () => {
		expect(sortNumber('1,204')).toBe(1204);
		expect(sortNumber('38%')).toBe(38);
		expect(sortNumber('—')).toBe(Number.NEGATIVE_INFINITY);
		const vals = ['12', '—', '1,204', '3'];
		expect([...vals].sort((a, b) => compareSortValues(a, b, 'num', 'descending'))).toEqual(['1,204', '12', '3', '—']);
	});
	it('sorts text case-insensitively with natural numbers', () => {
		const vals = ['week 10', 'Week 2', 'alpha'];
		expect([...vals].sort((a, b) => compareSortValues(a, b, 'text', 'ascending'))).toEqual(['alpha', 'Week 2', 'week 10']);
	});
});
