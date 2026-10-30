/**
 * The TV home's drawer links two guides. A guide is served per league and
 * only where it is tagged, so the drawer must pick a league that CARRIES it:
 * any other copy redirects a TV owner to a guides index they did not ask for.
 */
import { describe, it, expect } from 'vitest';
import rawGuides from '../src/data/guides.json';
import type { GuideEntry } from '../src/types/guides';
import { guideAppliesToLeague } from '../src/types/guides';
import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues';
import { TV_HOME_GUIDES, guideLeagueFor, isTvApp, tvGuideLinks } from '../src/utils/broadcast-tv-home';

const guides = rawGuides as GuideEntry[];
const guide = (slug: string) => guides.find((g) => g.slug === slug)!;

describe('TV home guide links', () => {
  it('links every drawer guide, each to a league that carries it', () => {
    const links = tvGuideLinks([], 'localhost');
    expect(links.map((l) => l.slug)).toEqual([...TV_HOME_GUIDES]);
    for (const link of links) {
      const slug = link.href.split('/').filter(Boolean)[0];
      const league = getLeagueBySlug(slug);
      expect(league, link.href).not.toBeNull();
      expect(guideAppliesToLeague(guide(link.slug), league!.navSlug)).toBe(true);
      expect(link.href.endsWith(`/guides/${link.slug}`)).toBe(true);
    }
  });

  it("prefers the owner's own league when it carries the guide", () => {
    for (const slug of TV_HOME_GUIDES) {
      const carriers = ALL_LEAGUES.filter((l) => guideAppliesToLeague(guide(slug), l.navSlug));
      const last = carriers[carriers.length - 1];
      expect(guideLeagueFor(guide(slug), [last.slug])?.slug).toBe(last.slug);
    }
  });

  it("skips an owner's league that does not carry the guide", () => {
    for (const slug of TV_HOME_GUIDES) {
      const other = ALL_LEAGUES.find((l) => !guideAppliesToLeague(guide(slug), l.navSlug));
      if (!other) continue;
      const picked = guideLeagueFor(guide(slug), [other.slug]);
      expect(picked && guideAppliesToLeague(guide(slug), picked.navSlug)).toBe(true);
    }
  });

  it("knows the TV app by the suffix MainActivity adds to its user agent", () => {
    expect(isTvApp('Mozilla/5.0 (Linux; Android 12; BRAVIA) Chrome/120 Mobile Safari/537.36 MFLLiveTV/1.0.65')).toBe(true);
    expect(isTvApp('Mozilla/5.0 (Linux; Android 12) Chrome/120 Safari/537.36')).toBe(false);
    expect(isTvApp(null)).toBe(false);
  });
});
