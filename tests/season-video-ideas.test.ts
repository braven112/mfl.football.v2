/**
 * Season video — the "Got an idea for the next video?" box. Pins what an idea
 * keeps (the words and the video's context, nothing else), that the CSV export
 * cannot smuggle a spreadsheet formula, and that the endpoint and admin page
 * check their limits and gate before anything is stored or shown.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanIdea, ideasCsv, MAX_IDEA_CHARS } from '../src/utils/season-video/ideas';

const now = new Date('2026-11-05T20:00:00Z');

describe('cleanIdea', () => {
	it('keeps the words and the video they came from', () => {
		expect(cleanIdea({ text: '  Roast the guy who lost by 0.1  ', email: 'a@b.co', kind: 'mid', look: 'poop', platform: 'sleeper' }, now)).toEqual({
			text: 'Roast the guy who lost by 0.1',
			email: 'a@b.co',
			kind: 'mid',
			look: 'poop',
			platform: 'sleeper',
			at: '2026-11-05T20:00:00.000Z',
		});
	});
	it('refuses an empty or non-text idea', () => {
		expect(cleanIdea({ text: '  ' }, now)).toBeNull();
		expect(cleanIdea({ text: 'ok' }, now)).toBeNull();
		expect(cleanIdea({ text: 42 }, now)).toBeNull();
	});
	it('caps the length, strips control characters and drops junk tags', () => {
		const i = cleanIdea({ text: `a\u0007b${'x'.repeat(2000)}`, kind: '<script>', look: 'TROPHY', platform: 12 }, now)!;
		expect(i.text.length).toBe(MAX_IDEA_CHARS);
		expect(i.text.startsWith('ab')).toBe(true);
		expect([i.kind, i.look, i.platform, i.email]).toEqual([null, null, null, null]);
	});
});

describe('ideasCsv', () => {
	it('quotes every cell and defuses spreadsheet formulas', () => {
		const csv = ideasCsv([{ text: '=HYPERLINK("evil")', email: null, kind: 'champion', look: null, platform: 'mfl', at: '2026-11-05T20:00:00.000Z' }]);
		const [head, row] = csv.trim().split('\r\n');
		expect(head).toBe('When,Idea,Email,Story,Look,Platform');
		expect(row).toBe('"2026-11-05T20:00:00.000Z","\'=HYPERLINK(""evil"")","","champion","","mfl"');
	});
});

describe('wiring', () => {
	it('the endpoint checks the honeypot and both limits before it saves', () => {
		const src = readFileSync('src/pages/api/season-video-idea.ts', 'utf8');
		const save = src.indexOf('saveIdea(idea)');
		expect(src.indexOf("allowSeasonVideoCall(request, 'season-video-idea')")).toBeLessThan(save);
		expect(src.indexOf('body.website')).toBeLessThan(save);
		expect(src.indexOf('allowIdea()')).toBeLessThan(save);
	});
	it('the admin list is the one-viewer site-insights gate, and stays out of search', () => {
		const page = readFileSync('src/pages/live/video-ideas.astro', 'utf8');
		expect(page).toContain('canViewSiteInsights(authUser)');
		expect(page.indexOf('canViewSiteInsights(authUser)')).toBeLessThan(page.indexOf('listIdeas()'));
		expect(page).not.toContain('getMflLiveUser');
		expect(readFileSync('src/data/page-directory.json', 'utf8')).not.toContain('/live/video-ideas');
	});
});
