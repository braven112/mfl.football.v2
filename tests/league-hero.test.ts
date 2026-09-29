/**
 * The shared homepage hero (src/utils/league-hero/): one resolver, one router,
 * every league a PROFILE. The AFL's behaviour is pinned by its own suites
 * (tests/afl-hero-*.test.ts, through tests/helpers/afl-hero.ts); these pin what
 * makes the system shared:
 *
 *   - a league's capabilities decide which rungs it reaches — a league with no
 *     live scoring never gets a scoreboard slot, a power-rankings league gets
 *     its Tuesday card, a league with a weekly column gets its Wednesday one;
 *   - a BUILT calendar (a package league's MFL export) drives the same ladder
 *     an authored one does, through `heroRole`;
 *   - a league with no bracket hero keeps its slot rotation through the
 *     playoffs;
 *   - nothing in the shared code branches on a league slug.
 *
 * Pinned against Archie's real 2026 feeds.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import brackets from '../data/archies/mfl-feeds/2026/playoff-brackets.json';
import { getLeagueBySlug, leagueHasFeature } from '../src/config/leagues';
import { buildPackageLeagueEvents } from '../src/utils/package-league-events';
import { resolveLeagueHeroState } from '../src/utils/league-hero/resolver';
import { getLeagueHeroProfile } from '../src/utils/league-hero/profiles';
import type { LeagueHeroResolverInput, LeagueHeroState } from '../src/utils/league-hero/types';
import type { SchefterPost } from '../src/types/schefter';

const archies = getLeagueBySlug('archies')!;

/** Archie's calendar as its homepage builds it: MFL's export + derived season dates. */
function archiesEvents(now: Date, calendar: Array<Record<string, string>> = []) {
  return buildPackageLeagueEvents({
    league: archies,
    seasons: [
      { seasonYear: 2026, calendar, playoffBrackets: brackets },
      { seasonYear: 2027, calendar: null, playoffBrackets: brackets },
    ],
    referenceDate: now,
  });
}

function archiesHero(iso: string, extra: Partial<LeagueHeroResolverInput> = {}, calendar?: Array<Record<string, string>>): LeagueHeroState {
  const now = new Date(iso);
  return resolveLeagueHeroState({
    league: 'archies',
    referenceDate: now,
    events: archiesEvents(now, calendar),
    whatsNewEntries: [],
    ...extra,
  });
}

const slotOf = (s: LeagueHeroState) => ('slot' in s ? s.slot : undefined);
const viewOf = (s: LeagueHeroState) => ('view' in s ? s.view : undefined);

const post = (over: Partial<SchefterPost> = {}): { post: SchefterPost; byline: { name: string; avatar: string } } => ({
  post: {
    id: 'gauntlet-2026-w4',
    type: 'article',
    headline: 'The Gauntlet: Week 4',
    body: 'Who has the hardest road left.',
    timestamp: '2026-09-30T17:00:00.000Z',
    link: '/archies/news/gauntlet-2026-w4',
    authorId: 'claude',
    ...over,
  } as SchefterPost,
  byline: { name: 'Claude Schefter', avatar: '/x.webp' },
});

describe("a built calendar drives the ladder (Archie's)", () => {
  it('tags every derived event with what it means to the hero', () => {
    const events = archiesEvents(new Date('2026-09-29T20:00:00Z'), [
      { type: 'TRADE', start_time: String(Date.UTC(2026, 10, 20) / 1000), id: 't' },
      { type: 'DRAFT_START', start_time: String(Date.UTC(2026, 7, 22) / 1000), id: 'd' },
      { type: 'DRAFT_START_DIVISION03', start_time: String(Date.UTC(2026, 7, 23) / 1000), id: 'd3' },
    ]);
    const roles = (id: string) => events.find((e) => e.definition.id.includes(id))!.definition;
    expect(roles('kickoff-2026').heroRole).toBe('season-start');
    expect(roles('playoffs-2026').heroRole).toBe('playoffs');
    expect(roles('playoffs-2026').heroWeek).toBe(15);
    expect(roles('championship-2026').heroRole).toBe('championship');
    expect(roles('new-league-year').heroRole).toBe('new-league-year');
    expect(roles('mfl-t-').heroRole).toBe('trade-deadline');
    expect(roles('mfl-d-').heroRole).toBe('draft');
    expect(roles('mfl-d3-').heroRole).toBe('pool-draft');
    expect(roles('mfl-d3-').heroPool).toBe('03');
  });

  it('runs the regular-season rotation between kickoff and the playoffs', () => {
    const s = archiesHero('2026-09-29T20:00:00Z'); // Tue 1pm PT
    expect(s.kind).toBe('regular-season');
    expect(slotOf(s)).toBe('recap');
  });

  it('keeps the slot rotation through the playoffs — Archie\'s has no bracket hero', () => {
    const s = archiesHero('2026-12-22T20:00:00Z'); // Tue of week 16
    expect(s.kind).toBe('playoffs');
    expect(viewOf(s)?.composite).toBeTruthy();
  });

  it('leads with a league-wide draft on draft day, linking MFL\'s draft room', () => {
    const s = archiesHero('2027-08-22T15:00:00Z', {}, undefined);
    // No calendar export → no draft event; the ladder falls through honestly.
    expect(s.kind === 'calendar-event' && s.role === 'draft').toBe(false);
    const drafting = resolveLeagueHeroState({
      league: 'archies',
      referenceDate: new Date('2026-08-22T19:00:00Z'),
      events: archiesEvents(new Date('2026-08-22T19:00:00Z'), [
        { type: 'DRAFT_START', start_time: String(Date.UTC(2026, 7, 22, 18) / 1000), end_time: String(Date.UTC(2026, 7, 23, 6) / 1000), id: 'd' },
      ]),
    });
    expect(drafting.kind).toBe('calendar-event');
    if (drafting.kind !== 'calendar-event') return;
    expect(drafting.role).toBe('draft');
    expect(drafting.view.isExternal).toBe(true);
    expect(drafting.view.link).toMatch(new RegExp(`${archies.id}`));
  });
});

describe('capabilities decide the daily slots', () => {
  it("reads Archie's capabilities from the registry", () => {
    const c = getLeagueHeroProfile('archies').capabilities;
    expect(c.liveScoring).toBe(leagueHasFeature('archies', 'liveScoring'));
    expect(c.peckingOrderSlot).toBe(leagueHasFeature('archies', 'powerRankings'));
  });

  it('a league with no live scoring keeps the live window, on a card that promises no scoreboard', () => {
    // Sunday 1pm PT: games on. Sunday 9pm PT: the slot runs on, the games are final.
    const on = archiesHero('2026-10-04T20:00:00Z');
    expect(slotOf(on)).toBe('live-scoring');
    expect(`${viewOf(on)?.headline} ${viewOf(on)?.accentWord}`).toBe('GAMES ARE ON.');
    expect(viewOf(on)?.linkLabel).not.toMatch(/LIVE SCORES/);
    const after = archiesHero('2026-10-05T04:00:00Z');
    expect(slotOf(after)).toBe('live-scoring');
    expect(`${viewOf(after)?.headline} ${viewOf(after)?.accentWord}`).toBe('THE SCORES ARE IN.');
    // A league WITH live scoring keeps its scoreboard card.
    const afl = resolveLeagueHeroState({ league: 'afl-fantasy', referenceDate: new Date('2026-10-04T20:00:00Z') });
    expect(viewOf(afl)?.linkLabel).toBe('VIEW LIVE SCORES');
  });

  it("Tuesday afternoon is the Pecking Order — when THIS week's issue is out", () => {
    const at = '2026-09-29T23:00:00Z'; // Tue 4pm PT
    expect(slotOf(archiesHero(at))).toBe('waiver-wire');
    const s = archiesHero(at, {
      peckingOrder: { week: 3, leader: { franchiseId: '0001', name: 'Rhinos' }, href: '/archies/pecking-order/2026/3' },
    });
    expect(slotOf(s)).toBe('pecking-order');
    expect(viewOf(s)?.link).toBe('/archies/pecking-order/2026/3');
    expect(viewOf(s)?.headline).toContain('RHINOS');
  });

  it('Wednesday night is the weekly column, and the card links THAT column', () => {
    const at = '2026-10-01T04:00:00Z'; // Wed 9pm PT
    expect(slotOf(archiesHero(at))).toBe('article');
    const s = archiesHero(at, { column: post() });
    expect(slotOf(s)).toBe('column');
    expect(viewOf(s)?.link).toBe('/archies/news/gauntlet-2026-w4');
    expect(viewOf(s)?.pill).toContain('THE GAUNTLET');
  });

  it('a league without those capabilities never takes those slots (the AFL)', () => {
    const s = resolveLeagueHeroState({
      league: 'afl-fantasy',
      referenceDate: new Date('2026-09-29T23:00:00Z'),
      peckingOrder: { week: 3, href: '/x' },
      column: post(),
    });
    expect(slotOf(s)).toBe('waiver-wire');
  });
});

describe("Archie's copy is Archie's", () => {
  it('never names the AFL, its conferences or its pages', () => {
    const dates = [
      '2026-09-28T20:00:00Z', '2026-09-29T20:00:00Z', '2026-09-29T23:00:00Z', '2026-10-01T04:00:00Z',
      '2026-10-02T20:00:00Z', '2026-10-03T20:00:00Z', '2026-10-04T20:00:00Z', '2026-12-22T20:00:00Z',
      '2027-03-01T20:00:00Z', '2027-06-15T20:00:00Z',
    ];
    for (const iso of dates) {
      const s = archiesHero(iso);
      const text = JSON.stringify(s);
      expect(text, iso).not.toMatch(/\bAFL\b|\bAL\b|\bNL\b|conference|afl-fantasy/i);
    }
  });
});

describe('the shared hero never branches on a league', () => {
  const FILES = [
    'src/utils/league-hero/resolver.ts',
    'src/utils/league-hero/views.ts',
    'src/utils/league-hero/capability-views.ts',
    'src/utils/league-hero/casting.ts',
    'src/utils/league-hero/page.ts',
    'src/components/shared/league-hero/LeagueHero.astro',
  ];
  it.each(FILES)('%s names no league slug', (file) => {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/['"](theleague|afl-fantasy|archies|afl)['"]/);
  });
});

describe('TheLeague climbs the same ladder', () => {
  it('its profile lists the contract-league rungs, in its constitution order', () => {
    expect(getLeagueHeroProfile('theleague').ladder).toEqual([
      'trade-deadline',
      'championship',
      'champion-crowned',
      'auction',
      'rookie-draft',
      'breaking-story',
      'regular-season',
      'playoffs',
      'schedule-release',
      'roster-deadlines',
      'offseason-ambient',
      'whats-new-fallback',
    ]);
  });

  it('has no state machine of its own any more — resolveHeroState is the shared resolver, mapped', () => {
    const tl = readFileSync('src/utils/hero-resolver.ts', 'utf8');
    expect(tl).not.toMatch(/export function resolveHeroState\(/);
    expect(tl).not.toMatch(/function buildState\(/);
    const adapter = readFileSync('src/utils/league-hero/season-state.ts', 'utf8');
    expect(adapter).toMatch(/resolveLeagueHeroState\(\{\s*league: 'theleague'/);
  });

  it('every capability state also carries a shared card, so any league can render it', () => {
    // Mid-March: TheLeague's auction window.
    const auction = resolveLeagueHeroState({ league: 'theleague', referenceDate: new Date('2026-03-17T20:00:00Z'), events: [] });
    expect(auction.kind).toBe('auction');
    expect(viewOf(auction)?.headline).toBe('FREE AGENT AUCTION');
    // Late January: the tag window, a dated league phase.
    const tags = resolveLeagueHeroState({ league: 'theleague', referenceDate: new Date('2026-01-20T20:00:00Z'), events: [] });
    expect(tags.kind).toBe('league-phase');
    expect(viewOf(tags)?.link).toBe('/theleague/rosters');
  });

  it('keeps the bracket phases view-less where a league HAS a bracket hero (the AFL)', () => {
    const s = resolveLeagueHeroState({ league: 'afl-fantasy', referenceDate: new Date('2026-12-22T20:00:00Z') });
    expect(s.kind).toBe('playoffs');
    expect(viewOf(s)).toBeUndefined();
  });
});
