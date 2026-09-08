/**
 * Guards on the live-scoring hero being a SHARED component rather than
 * TheLeague's component that the AFL also renders.
 *
 * Every case here is a way the AFL silently showed TheLeague's data. None of
 * them throws, and none of them fails a type check — the hero renders, it is
 * simply the wrong league's scoreboard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectSupportingMatchups } from '../src/utils/live-scoring-view';
import { buildLiveScoringHeroProps } from '../src/utils/live-scoring-hero-props';
import { getLeagueBySlug } from '../src/config/leagues';

const THELEAGUE = getLeagueBySlug('theleague')!;
const AFL = getLeagueBySlug('afl-fantasy')!;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

const M = (home: string, away: string) => ({ home, away });

describe('selectSupportingMatchups', () => {
  const all = [M('0001', '0002'), M('0003', '0004'), M('0013', '0014'), M('0002', '0013')];

  it('drops the viewer’s own games — they are featured, never supporting', () => {
    const own = new Set([all[0]]);
    expect(selectSupportingMatchups(all, own)).not.toContain(all[0]);
    expect(selectSupportingMatchups(all, own)).toHaveLength(3);
  });

  it('drops EVERY one of the viewer’s games on a doubleheader week', () => {
    // The AFL plays doubleheaders, so "the user's matchup" is a list. A filter
    // that removed only the first would leak the second into the compact grid
    // AND leave it featured — the same game twice in one hero.
    const own = new Set([all[0], all[1]]);
    const out = selectSupportingMatchups(all, own);
    expect(out).toEqual([all[2], all[3]]);
  });

  it('narrows to the scope when one is given', () => {
    const conference = ['0001', '0002', '0003', '0004'];
    const out = selectSupportingMatchups(all, new Set(), conference);
    expect(out).toEqual([all[0], all[1], all[3]]);
  });

  it('keeps a cross-scope game when EITHER side is in scope', () => {
    // 0002 is in conference, 0013 is not. An owner still has a reason to watch
    // a game their conference-mate is playing.
    const out = selectSupportingMatchups([M('0002', '0013')], new Set(), ['0002']);
    expect(out).toHaveLength(1);
  });

  it('stays league-wide when the scope is absent or empty', () => {
    // A signed-out AFL viewer has no conference. Treating "no scope" as "show
    // nothing" would empty the grid; treating it as an arbitrary half would be
    // worse. TheLeague relies on this too — it never passes a scope at all.
    expect(selectSupportingMatchups(all, new Set())).toHaveLength(4);
    expect(selectSupportingMatchups(all, new Set(), [])).toHaveLength(4);
  });
});

describe('buildLiveScoringHeroProps', () => {
  const teams = [{ franchiseId: '0001', name: 'Test', color: '#000' }];
  const origin = new URL('https://example.test/');

  const capture = () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: URL | string) => {
      urls.push(String(u));
      return { ok: true, json: async () => ({ matchups: [], scores: {}, remaining: {} }) };
    }) as unknown as typeof fetch;
    return { urls, fetchImpl };
  };

  it('sends each league’s OWN MFL id, so the poll cannot answer for the other', async () => {
    for (const league of [THELEAGUE, AFL]) {
      const { urls, fetchImpl } = capture();
      const props = await buildLiveScoringHeroProps({
        league: league.slug, week: 3, origin, teams, fetchImpl,
      });
      // The registry field is `id`. Reading `leagueId` (which only
      // getLeagueContext defines) yields undefined, fails the endpoint's
      // /^\d+$/ check, and silently serves TheLeague to everyone.
      expect(urls[0]).toContain(`L=${league.id}`);
      expect(props?.leagueId).toBe(league.id);
      expect(props?.leagueId).toMatch(/^\d+$/);
      expect(props?.leagueName).toBe(league.name);
    }
  });

  it('gives the two leagues DIFFERENT ids', () => {
    expect(getLeagueBySlug(AFL.slug)?.id).not.toBe(getLeagueBySlug(THELEAGUE.slug)?.id);
  });

  it('omits scopeFranchiseIds rather than sending an empty list', async () => {
    const { fetchImpl } = capture();
    const props = await buildLiveScoringHeroProps({
      league: AFL.slug, week: 3, origin, teams, scopeFranchiseIds: [], fetchImpl,
    });
    expect(props && 'scopeFranchiseIds' in props).toBe(false);
  });

  it('returns undefined instead of a scoreboard with no scores in it', async () => {
    const fetchImpl = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await buildLiveScoringHeroProps({
      league: AFL.slug, week: 3, origin, teams, fetchImpl,
    })).toBeUndefined();
  });
});

describe('the shared hero names no league of its own', () => {
  const hero = read('src/components/shared/LiveScoringHero.tsx');

  it('polls with a league parameter', () => {
    // Without `L`, /api/live-scoring answers for TheLeague. The AFL's hero
    // would render its own opening scores and then, 60 seconds later, replace
    // them with TheLeague's.
    expect(hero).toMatch(/\/api\/live-scoring\?[^`'"]*\bL=\$\{encodeURIComponent\(leagueId\)\}/);
  });

  it('carries no hardcoded league name or MFL id', () => {
    // "The League Championship" shipped in the championship label and read as
    // TheLeague's title game to every AFL owner.
    //
    // Comments are stripped first: prose ABOUT this rule (including the note
    // at the championship label recording the original bug) is not a
    // violation of it, and a guard that cannot tell the two apart gets
    // silenced by the next person who documents something.
    const code = hero
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).not.toMatch(/The League|AFL Fantasy|13522|19621/);
  });
});

describe('both homepages forward the built props whole', () => {
  // SeasonDailyHero re-declared the prop shape structurally and forwarded
  // field by field. `leagueId` is REQUIRED by the island, but the local copy
  // did not have it, so adding the field silently skipped this component and
  // TheLeague polled with `L=undefined`. Spreading is what keeps the two
  // leagues in step; a hand-listed forward drifts again on the next field.
  for (const [name, path] of [
    ['SeasonDailyHero', 'src/components/theleague/SeasonDailyHero.astro'],
    ['AflHero', 'src/components/afl/AflHero.astro'],
  ] as const) {
    it(`${name} spreads liveScoring rather than listing its fields`, () => {
      const src = read(path);
      const tag = src.slice(src.indexOf('<LiveScoringHero'));
      expect(tag.slice(0, tag.indexOf('/>'))).toContain('{...liveScoring}');
    });

    it(`${name} does not re-declare the props shape`, () => {
      expect(read(path)).toMatch(/liveScoring\??:\s*BuiltLiveScoringProps/);
    });
  }
});
