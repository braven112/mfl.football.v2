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
import { componentOpeningTag } from './helpers/scan-guard';
import { resolve } from 'node:path';
import { selectSupportingMatchups } from '../src/utils/live-scoring-view';
import { buildLiveScoringHeroProps } from '../src/utils/live-scoring-hero-props';
import { getLeagueBySlug } from '../src/config/leagues';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';

const THELEAGUE = getLeagueBySlug('theleague')!;
const AFL = getLeagueBySlug('afl-fantasy')!;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

const M = (home: string, away: string) => ({ home, away });

type Slotted = { kind: string; slot?: string; isLive?: boolean };

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

  // Every way the feed can fail must return undefined, so the homepage keeps
  // its normal hero. Returning a props object renders a scoreboard with
  // nothing in it — worse than not offering one, because it looks broken.
  const failures: [string, () => typeof fetch][] = [
    ['the request throws', () => (async () => { throw new Error('network'); }) as unknown as typeof fetch],
    ['a non-2xx status', () => (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch],
    ['a non-JSON body', () => (async () => ({ ok: true, json: async () => { throw new SyntaxError('<html>'); } })) as unknown as typeof fetch],
    // 200 with ok:false is the UPSTREAM MFL failure. It is the one that looks
    // exactly like a healthy empty week unless the flag is read.
    ['200 with ok:false', () => (async () => ({ ok: true, json: async () => ({ ok: false, matchups: [], scores: {} }) })) as unknown as typeof fetch],
    ['200 with an error key', () => (async () => ({ ok: true, json: async () => ({ error: 'Failed to fetch live scoring', matchups: [] }) })) as unknown as typeof fetch],
  ];

  for (const [label, make] of failures) {
    it(`returns undefined when ${label}`, async () => {
      expect(await buildLiveScoringHeroProps({
        league: AFL.slug, week: 3, origin, teams, fetchImpl: make(),
      })).toBeUndefined();
    });
  }

  it('still builds for a HEALTHY but empty week', async () => {
    // ok:true with no matchups is the offseason/bye shape. It must NOT be
    // confused with the outage above — that merge is the trap in
    // docs/claude/rules/lineups.md.
    const fetchImpl = (async () => ({
      ok: true, json: async () => ({ ok: true, matchups: [], scores: {}, remaining: {} }),
    })) as unknown as typeof fetch;
    const props = await buildLiveScoringHeroProps({
      league: AFL.slug, week: 3, origin, teams, fetchImpl,
    });
    expect(props).toBeDefined();
    expect(props?.matchups).toEqual([]);
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
      const tag = componentOpeningTag(read(path), 'LiveScoringHero');
      expect(tag, `${name} does not render <LiveScoringHero>`).not.toBeNull();
      expect(tag!).toContain('{...liveScoring}');
    });

    it(`${name} does not re-declare the props shape`, () => {
      expect(read(path)).toMatch(/liveScoring\??:\s*BuiltLiveScoringProps/);
    });
  }
});

describe('the AFL hero reads the live WINDOW, not the live SLOT', () => {
  // The live-scoring slot outlasts the games: Sunday's slot runs to 11pm PT
  // and the last game ends at 8:30. `isLive` drives both the poll and the
  // LIVE/FINAL badge, so a hardcoded `true` polls all evening and badges
  // finished games as live.
  it('AflHero passes the resolved isLive, never a literal', () => {
    const open = componentOpeningTag(read('src/components/afl/AflHero.astro'), 'LiveScoringHero');
    expect(open, 'AflHero does not render <LiveScoringHero>').not.toBeNull();
    expect(open!).toContain('isLive={state.isLive}');
    expect(open!).not.toMatch(/isLive=\{(true|false)\}/);
  });

  it('the AFL resolver derives isLive from the clock', () => {
    const src = read('src/utils/afl-hero-resolver.ts');
    expect(src).toContain('isLive: isGameLive(now)');
  });

  it('separates the slot from the window at the same slot', () => {
    // Both of these are the live-scoring slot. Only the first has games on.
    // That pairing IS the bug: keying the badge and the poll off the slot
    // makes these two indistinguishable.
    const afternoon = new Date('2026-09-13T20:00:00Z'); // Sun 1:00pm PT
    const lateEvening = new Date('2026-09-14T04:30:00Z'); // Sun 9:30pm PT

    const live = resolveAflHeroState({ referenceDate: afternoon }) as never as Slotted;
    const after = resolveAflHeroState({ referenceDate: lateEvening }) as never as Slotted;

    expect(live.slot).toBe('live-scoring');
    expect(after.slot).toBe('live-scoring');
    expect(live.isLive).toBe(true);
    expect(after.isLive).toBe(false);
  });
});
