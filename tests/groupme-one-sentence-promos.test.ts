import { describe, expect, it } from 'vitest';
import { buildGroupMeAnnouncement } from '../scripts/generate-pecking-order.mjs';
import { buildGroupMePromo as gauntletPromo } from '../scripts/article-types/schedule-strength.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * The weekly columns' chat posts are ONE sentence and a link (owner's call,
 * Oct 2026). The column does the talking; the chat post names one hook and
 * points at it. The old Pecking Order post re-told the column — #1 blurb,
 * Stat of the Week, Bench Blunder — and the Gauntlet named both ends of the
 * table plus a sales line.
 */

function expectOneSentenceThenLink(text: string) {
  expect(text.includes('\n'), 'one line, no paragraphs').toBe(false);
  // Exactly one link, and it ends the message — GroupMe autolinks a trailing
  // period into the href (docs/claude/rules/league-urls.md).
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  expect(urls).toHaveLength(1);
  const url = urls[0] ?? '';
  expect(text.endsWith(url)).toBe(true);
  // One sentence before the link.
  const lead = text.slice(0, text.indexOf(url));
  expect(lead.match(/[.!?](\s|$)/g) ?? []).toHaveLength(0);
}

describe('Pecking Order chat post', () => {
  const teams = new Map([['0004', { nameMedium: 'Pigskins' }]]);
  const issue = {
    week: 6,
    rankings: [{ franchiseId: '0004', rank: 1, previousRank: 3, blurb: 'A long write-up.' }],
    awards: {
      statOfWeek: { blurb: 'Stat blurb.' },
      benchBlunder: { blurb: 'Blunder blurb.' },
    },
  };

  for (const slug of ['theleague', 'afl-fantasy'] as const) {
    it(`${slug}: one sentence with the #1 hook, then the link`, () => {
      const text = buildGroupMeAnnouncement(issue, teams, LEAGUES[slug]);
      expectOneSentenceThenLink(text);
      expect(text).toContain('Week 6 Pecking Order: Pigskins climbs to #1');
      expect(text).toMatch(/\/pecking-order$/);
      // The column's content stays on the page.
      expect(text).not.toContain('A long write-up');
      expect(text).not.toContain('Stat blurb');
      expect(text).not.toContain('Blunder blurb');
    });
  }

  it('says "holds" when #1 did not change', () => {
    const held = { ...issue, rankings: [{ ...issue.rankings[0], previousRank: 1 }] };
    expect(buildGroupMeAnnouncement(held, teams, LEAGUES.theleague)).toContain('Pigskins holds #1');
  });
});

describe('Gauntlet chat post', () => {
  for (const slug of ['theleague', 'afl-fantasy'] as const) {
    it(`${slug}: one sentence naming the hardest road, then the link`, () => {
      const text = gauntletPromo(
        { link: `/${slug}/news/sf_2026_gauntlet_w05` },
        { hardest: { name: 'Pigskins', difficulty: 88 }, easiest: { name: 'Magicians' }, week: 5 },
        { league: slug },
      ) as string;
      expectOneSentenceThenLink(text);
      expect(text).toContain('Week 5');
      expect(text).toContain('Pigskins (88/100)');
      expect(text).not.toContain('Magicians');
    });
  }
});
