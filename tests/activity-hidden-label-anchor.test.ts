import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Owner Activity page side-scrolled on a phone, and only that page.
 *
 * Its Last Seen table hides the status TEXT below 640px with the standard
 * visually-hidden box — `position: absolute` + a 1px size + `clip`. But `clip`
 * hides what is PAINTED, not what is laid out, and with no `left`/`top` an
 * absolutely positioned box sits at its STATIC position: in this table, the
 * last column of a grid wider than the phone. Its containing block was the
 * page rather than the `.table-wrapper` that scrolls, so sixteen 1px boxes
 * landed ~58px past the right edge and gave the whole DOCUMENT a horizontal
 * scrollbar — the table scrolled the page instead of scrolling itself.
 *
 * Anchoring the cell puts the label back inside the scroll container. This is
 * one CSS declaration with no visible effect, which is exactly the kind a
 * later cleanup deletes as dead weight.
 */

/**
 * Source with CSS comments stripped, so a `{` inside a comment cannot throw
 * off the brace walk below. (This file's comments are prose about braces.)
 */
const SOURCE = readFileSync(
	path.join(process.cwd(), 'src/components/theleague/OwnerActivityReport.astro'),
	'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The mobile media query that holds the status-label rules.
 *
 * Found by CONTENT, not by position: keyed on the block that mentions
 * `.activity-label` rather than on the first `@media` that happens to match a
 * string. A guard that fails when someone adds an earlier breakpoint, or
 * writes `max-width:639px` without the space, is a guard that gets deleted
 * with the bug still in place.
 */
function mobileBlock(): string {
	const query = /@media[^{]*max-width:\s*639px[^{]*\{/g;
	for (let m = query.exec(SOURCE); m !== null; m = query.exec(SOURCE)) {
		const open = m.index + m[0].length - 1;
		let depth = 0;
		for (let i = open; i < SOURCE.length; i++) {
			if (SOURCE[i] === '{') depth += 1;
			else if (SOURCE[i] === '}') {
				depth -= 1;
				if (depth === 0) {
					const block = SOURCE.slice(open, i + 1);
					if (block.includes('.activity-label')) return block;
					break;
				}
			}
		}
	}
	throw new Error(
		'No `@media (max-width: 639px)` block containing `.activity-label` — if the ' +
			'status label stopped being hidden on mobile, delete this suite; if it just ' +
			'moved, point this helper at its new home.',
	);
}

describe('Owner Activity — the visually-hidden status label', () => {
	const block = mobileBlock();

	it('is still hidden by absolute positioning (the setup for the trap)', () => {
		expect(block).toMatch(/\.activity-label\s*\{[^}]*position:\s*absolute/);
	});

	it('has an anchored containing block, so it cannot scroll the whole page', () => {
		expect(
			/\.activity-table__td--status\s*\{[^}]*position:\s*relative/.test(block),
			'`.activity-table__td--status` must be `position: relative` inside the ' +
				'mobile query. Without it the 1px hidden label sits at its static ' +
				'position — off the right edge of a table wider than the phone — and ' +
				'the PAGE gains a horizontal scrollbar. Verified by measuring ' +
				'document.scrollWidth at 320/390/430/639px.',
		).toBe(true);
	});

	it('keeps the label in the DOM rather than display:none, for screen readers', () => {
		// The dot beside it is aria-hidden, so this text is the only thing that
		// names the status. Hiding it with `display: none` would remove it.
		expect(block).not.toMatch(/\.activity-label\s*\{[^}]*display:\s*none/);
	});
});
