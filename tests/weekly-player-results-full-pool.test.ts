/**
 * THE MODAL'S SEASON RESULTS TABLE MUST EXIST FOR A PLAYER NOBODY STARTED.
 *
 * `weekly-results-raw.json` is MFL's weeklyResults export, which lists a
 * franchise's ACTIVE LINEUP and nothing else. Three populations therefore have
 * no row in it at all — free agents, practice-squad (TAXI_SQUAD) and
 * injured-reserve players — and in TheLeague's 2026 feeds that was 44 of 45
 * taxi-squad players, 11 of 15 IR players, and the entire free-agent pool.
 * `buildWeeklyPlayerResults` keyed its output off that feed alone, so those
 * players got no payload entry, and `PlayerDetailsModal` renders a missing
 * entry by HIDING the table: the modal looked like the player had never played.
 *
 * The fix is `playerScores&W=<n>`, the per-week twin of the `W=YTD` full-pool
 * feed the Free Agents points column already reads for the identical reason.
 * These tests pin the three things that make it correct rather than merely
 * present: the fallback ADDS players, it never OVERRIDES the lineup feed where
 * that has an answer, and it never invents a roster or a starter status it
 * cannot know.
 *
 * The multi-owner block is a different bug found on the way in: the AFL rosters
 * the same NFL player in both conferences, so a single franchise per week was
 * always one of two real answers, chosen by MFL's serving order.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWeeklyPlayerResults } from '../src/utils/weekly-player-results';
import {
  reduceWeekScores,
  weekOfScores,
  parsePlayerWeekScores,
  weekMergeDecision,
} from '../src/utils/player-week-scores.mjs';

const ROOT = join(__dirname, '..');
const FETCH_SCRIPT = join(ROOT, 'scripts/fetch-mfl-feeds.mjs');
const MODAL = join(ROOT, 'src/components/theleague/PlayerDetailsModal.astro');

const PLAYERS = {
  players: {
    player: [
      { id: '100', position: 'WR', team: 'PIT' },
      { id: '200', position: 'QB', team: 'PIT' },
    ],
  },
};

const LEAGUE = {
  league: {
    franchises: {
      franchise: [
        { id: '0001', name: 'Pacific Pigskins' },
        { id: '0019', name: 'Badd Boys' },
      ],
    },
  },
};

const SCHEDULE = {
  fullNflSchedule: {
    nflSchedule: [
      { week: '1', matchup: [{ team: [{ id: 'PIT', isHome: '1' }, { id: 'ATL', isHome: '0' }] }] },
      { week: '2', matchup: [{ team: [{ id: 'PIT', isHome: '0' }, { id: 'CLV', isHome: '1' }] }] },
    ],
  },
};

/** One week of MFL's weeklyResults shape. */
const week = (w: number, franchises: Array<{ id: string; player: any[] }>) => ({
  weeklyResults: { week: String(w), matchup: [{ franchise: franchises }] },
});

const build = (weeks: unknown[], scores?: Map<string, Record<number, number>>) =>
  buildWeeklyPlayerResults(weeks as any[], SCHEDULE, {}, PLAYERS, LEAGUE, 2, scores);

describe('the full-pool per-week fallback', () => {
  it('gives a player who is on NO roster a table at all', () => {
    // The whole bug: '200' never appears in weeklyResults, which is what a free
    // agent, a practice-squad player and an IR player all look like.
    const lineupOnly = build([week(1, [{ id: '0001', player: [{ id: '100', score: '9.00', status: 'starter' }] }])]);
    expect(lineupOnly['200'], 'precondition: the lineup feed cannot see this player').toBeUndefined();

    const withFallback = build(
      [week(1, [{ id: '0001', player: [{ id: '100', score: '9.00', status: 'starter' }] }])],
      new Map([['200', { 1: 18.5 }]]),
    );
    expect(
      withFallback['200'],
      'a player the league scored must get a payload entry — without one the modal hides the table',
    ).toBeDefined();
    expect(withFallback['200'][0].p).toBe(18.5);
  });

  it('carries the NFL matchup context, which is not a property of a fantasy roster', () => {
    const weeks = build([], new Map([['200', { 1: 18.5 }]]))['200'];
    expect(weeks[0].opp).toBe('vs ATL');
  });

  it('claims no roster and no starter status for a week no lineup held him', () => {
    const weeks = build([], new Map([['200', { 1: 18.5 }]]))['200'];
    expect(weeks[0].fi, 'the full-pool feed carries no franchise').toBe('');
    expect(weeks[0].fn).toBe('');
    expect(weeks[0].st, 'and no starter/non-starter answer — empty, never "NS"').toBe('');
  });

  it('never overrides a score the lineup feed already has', () => {
    // MFL's two exports can disagree mid-scoring. weeklyResults wins, because
    // it is the only one that also names the roster and the status.
    const weeks = build(
      [week(1, [{ id: '0001', player: [{ id: '100', score: '9.00', status: 'starter' }] }])],
      new Map([['100', { 1: 99.9 }]]),
    )['100'];
    expect(weeks[0].p).toBe(9);
    expect(weeks[0].st).toBe('S');
    expect(weeks[0].fi).toBe('0001');
  });

  it('fills a week the lineup feed listed but has not scored yet', () => {
    // `score` absent = "in the lineup, not scored yet" (never zero). A number
    // we have beats a number we are waiting on.
    const weeks = build(
      [week(1, [{ id: '0001', player: [{ id: '100', status: 'starter' }] }])],
      new Map([['100', { 1: 12.25 }]]),
    )['100'];
    expect(weeks[0].p).toBe(12.25);
    expect(weeks[0].st, 'the roster facts still come from the lineup feed').toBe('S');
  });

  it('leaves a player with no score anywhere out of the payload', () => {
    expect(build([], new Map([['200', {}]]))['200']).toBeUndefined();
  });

  it('keeps a real score on a week it computed as a bye', () => {
    // `info.nflTeam` is the player's CURRENT team, so for anyone traded
    // mid-season the derived bye is his NEW team's — and discarding points on
    // it deletes a real week he played for the old one. The roster branch has
    // always kept points under `isBye`; the fallback must not disagree.
    // '200' is on PIT; week 2 of the fixture schedule has PIT playing, so
    // score a week where the schedule loaded and PIT is absent.
    const schedule = {
      fullNflSchedule: {
        nflSchedule: [
          { week: '1', matchup: [{ team: [{ id: 'PIT', isHome: '1' }, { id: 'ATL', isHome: '0' }] }] },
          { week: '2', matchup: [{ team: [{ id: 'CLV', isHome: '1' }, { id: 'ATL', isHome: '0' }] }] },
        ],
      },
    };
    const weeks = buildWeeklyPlayerResults(
      [], schedule, {}, PLAYERS, LEAGUE, 2, new Map([['200', { 2: 21.4 }]]),
    )['200'];

    expect(weeks[1].st, 'the row is still labelled a bye').toBe('BYE');
    expect(weeks[1].p, 'but the score MFL gave us survives it').toBe(21.4);
  });

  it('never turns a bye into a scored week', () => {
    // '200' is on PIT; week 2 of the fixture schedule has PIT playing, week 1
    // too — so use a team-less week by scoring a week outside the schedule.
    const weeks = build([], new Map([['200', { 1: 18.5 }]]))['200'];
    expect(weeks.some((w) => w.st === 'BYE' && w.p !== null)).toBe(false);
  });
});

describe('a week held by more than one roster', () => {
  const dual = () =>
    build([
      week(1, [
        { id: '0019', player: [{ id: '100', score: '4.10', status: 'starter' }] },
        { id: '0001', player: [{ id: '100', score: '4.10', status: 'nonstarter' }] },
      ]),
    ])['100'][0];

  it('lists every franchise, not whichever MFL served last', () => {
    // The AFL rosters the same NFL player in both conferences as a matter of
    // course — 326 such weeks in its 2026 feeds.
    expect(dual().o?.map((o) => o.fi)).toEqual(['0001', '0019']);
  });

  it('orders them deterministically', () => {
    // MFL serves matchups in nondeterministic order, which put the same two
    // owners in one order for week 1 and the other for week 2 of one table.
    const reversed = build([
      week(1, [
        { id: '0001', player: [{ id: '100', score: '4.10', status: 'nonstarter' }] },
        { id: '0019', player: [{ id: '100', score: '4.10', status: 'starter' }] },
      ]),
    ])['100'][0];
    expect(reversed.o?.map((o) => o.fi)).toEqual(dual().o?.map((o) => o.fi));
  });

  it('resolves each roster’s own name and status', () => {
    expect(dual().o).toEqual([
      { fi: '0001', fn: 'Pacific Pigskins', st: 'NS' },
      { fi: '0019', fn: 'Badd Boys', st: 'S' },
    ]);
  });

  it('counts the week once, at one score', () => {
    // A doubleheader lists a franchise in two matchups and the AFL plays three
    // of them a year; summing the rows doubled every total.
    expect(dual().p).toBe(4.1);
  });

  it('says started when any roster started him', () => {
    expect(dual().st).toBe('S');
  });

  it('omits the list entirely when there is only one roster', () => {
    // TheLeague never has two, and pays no payload for the field.
    const single = build([week(1, [{ id: '0001', player: [{ id: '100', score: '4.10', status: 'starter' }] }])])['100'][0];
    expect(single.o).toBeUndefined();
    expect(single.fi).toBe('0001');
  });
});

describe('reading MFL’s playerScores payload', () => {
  it('keeps a real zero and drops the blank placeholder row', () => {
    // MFL answers a season with no games yet with `{ id: '', score: '' }`. A
    // row count alone accepts that, which is how an all-blank feed got
    // committed over both leagues in the offseason.
    const out = reduceWeekScores({
      playerScores: { week: '1', playerScore: [{ id: '', score: '' }, { id: '100', score: '0.00' }, { id: '200', score: '-4.40' }] },
    });
    expect(out).toEqual({ '100': 0, '200': -4.4 });
  });

  it('handles MFL serving a lone row unwrapped', () => {
    expect(reduceWeekScores({ playerScores: { playerScore: { id: '100', score: '7' } } })).toEqual({ '100': 7 });
  });

  it('reads the week off the payload and refuses a non-week', () => {
    // A W-less request is a request for MFL to name its own current week; see
    // docs/claude/rules/schedule-optimization.md on not deriving week
    // boundaries from the calendar.
    expect(weekOfScores({ playerScores: { week: '3' } })).toBe(3);
    expect(weekOfScores({ playerScores: { week: 'YTD' } })).toBeNull();
    expect(weekOfScores({ playerScores: { week: '99' } })).toBeNull();
  });

  it('round-trips through the committed file shape', () => {
    const map = parsePlayerWeekScores({ weeks: { '1': { '100': 4.1 }, '2': { '100': 9 } } });
    expect(map.get('100')).toEqual({ 1: 4.1, 2: 9 });
  });

  it('reads an absent file as no data rather than throwing', () => {
    expect(parsePlayerWeekScores(null).size).toBe(0);
    expect(parsePlayerWeekScores({}).size).toBe(0);
  });
});

describe('the per-league points-allowed sync', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/weekly-stats-sync.yml'), 'utf8');
  const fpa = readFileSync(join(ROOT, 'scripts/fetch-fantasy-points-allowed.mjs'), 'utf8');

  it('names no MFL league id in the workflow', () => {
    // The script resolves the id through the registry, so the YAML needs no
    // literal and therefore no league-literal-guard exemption.
    expect(wf).toMatch(/--league="\$SLUG"/);
    expect(wf).not.toMatch(/\b(13522|19621)\b/);
  });

  it('lets one league fail without discarding the other league\u2019s file', () => {
    // The script exits 1 on a fetch error or a short team count. Under
    // `bash -e` that kills the step, and `Commit and push updates` has no
    // `if:` — so the league that already wrote its file loses that write
    // because the other league had a bad day.
    expect(wf).toMatch(/if node \.\/scripts\/fetch-fantasy-points-allowed\.mjs/);
    expect(wf).toMatch(/\$\{#OK\[@\]\} -eq 0/);
  });

  it('lets an explicit --league beat an ambient MFL_LEAGUE_ID', () => {
    // Otherwise the per-league loop answers both iterations with the env's
    // league: one file written twice, the other never created, exit 0.
    expect(fpa).toMatch(/league\?\.id \|\| getNonEmpty\(process\.env\.MFL_LEAGUE_ID\)/);
  });
});

describe('the feed that supplies it', () => {
  const src = readFileSync(FETCH_SCRIPT, 'utf8');

  it('is fetched per week, not just W=YTD', () => {
    // W=YTD is a season TOTAL with no week breakdown and no games-played field,
    // so it can seed a Pts column but never this table.
    expect(
      /TYPE=playerScores&L=\$\{leagueId\}&W=\$\{weekNum\}/.test(src),
      'scripts/fetch-mfl-feeds.mjs must fetch playerScores for each week',
    ).toBe(true);
    expect(src).toContain("writeOut('playerScores-by-week'");
  });

  it('merges weeks instead of replacing the file', () => {
    // A finished week's scores are immutable and MFL answers an unplayed week
    // with a blank placeholder, so each daily pass must accumulate.
    expect(src).toMatch(/const mergeWeek = \(weekNum, scores\)/);
    expect(
      /weekMergeDecision\(weeks\[String\(weekNum\)\], scores\)/.test(src),
      'the merge policy must come from weekMergeDecision, not be re-inlined here',
    ).toBe(true);
  });

  it('refuses a truncated response for a week it already holds', () => {
    // MFL serves degraded bodies at HTTP 200, and playerScores-by-week.json is
    // the ONLY record of a finished week — a partial reply that replaced it
    // would delete those players' rows from the modal with nothing to
    // re-derive them from. A finished week's pool does not shrink.
    const committed = Object.fromEntries(
      Array.from({ length: 484 }, (_, i) => [String(i), i * 0.1]),
    );

    expect(weekMergeDecision(committed, { '1': 1.5 }).accept).toBe(false);
    expect(weekMergeDecision(committed, { '1': 1.5 }).reason).toBe('shrank');

    // …but a handful of voided rows is a real MFL correction, not a bad
    // response, and refusing those would strand the week on stale data.
    const nudged = { ...committed };
    delete nudged['0'];
    delete nudged['1'];
    expect(weekMergeDecision(committed, nudged).accept).toBe(true);
  });

  it('keeps a committed week when MFL answers it empty, and fills an unseen one', () => {
    // The blank placeholder row reduces to {} — that is "not played yet",
    // never "everyone scored nothing".
    expect(weekMergeDecision({ '1': 12.3 }, {}).reason).toBe('empty');
    expect(weekMergeDecision({ '1': 12.3 }, {}).accept).toBe(false);
    // Nothing committed yet: any non-empty answer is strictly better than none,
    // which is what lets the week-1-only hand seed grow into weeks 1-18.
    expect(weekMergeDecision(undefined, { '1': 12.3 }).accept).toBe(true);
    expect(weekMergeDecision({}, { '1': 12.3 }).accept).toBe(true);
  });

  it('does not spend a second request on the live week', () => {
    // The endpoints loop already fetches W-less playerScores every run —
    // 288 runs a day per league, so re-requesting it is pure waste.
    expect(src).toContain("readFileSync(path.join(outDir, 'playerScores.json')");
  });
});

describe('the modal that renders it', () => {
  const src = readFileSync(MODAL, 'utf8');

  it('never caches the payload on `window`', () => {
    // `window` is one of the two nodes the ClientRouter does not replace, so a
    // value parked there outlives a navigation. This was harmless only while
    // ONE league emitted #weekly-player-results; both do now, and both have a
    // franchise 0001, so the first page loaded would win for the session and
    // show one league's points and franchise names under the other league's
    // crests — with nothing on screen looking wrong. Same trap as
    // rankings-scope.ts's "re-read per call, never capture at module load".
    // It also stales `?year=` and the players -> rosters hop, which key
    // different seasons between Labor Day and kickoff.
    expect(src).not.toMatch(/window\._weeklyPlayerData/);
    expect(
      /getElementById\('weekly-player-results'\)/.test(src),
      'the island must be read inside the open handler',
    ).toBe(true);
  });

  it('reads the brand map once per open, not once per badge', () => {
    // 18 weeks x 2 AFL owners is up to 36 JSON.parse of the same island.
    expect(src).toMatch(/var weeklyBrands = readFranchiseBandBrands\(\)/);
  });

  it('builds a franchise crest from the page’s brand map, not a league path', () => {
    // The badge used to hardcode `/assets/theleague/icons/<franchiseId>.png`.
    // That is correct for exactly one league: the AFL's crests are named by
    // slug, so every badge on its rows would have 404'd. The brand map is
    // league-scoped AND re-read per open, so it survives a ClientRouter
    // navigation between the two leagues as well.
    expect(src).not.toContain('/assets/theleague/icons/');
    // However the map is read (it is hoisted once per open, see below), the
    // crest must come OUT of it and never out of a constructed path.
    expect(src).toMatch(/weeklyBrands\.teams\[owner\.fi\]/);
    expect(src).toMatch(/ownerBrand && \(ownerBrand\.crestLight \|\| ownerBrand\.crest\)/);
  });

  it('escapes the franchise name it puts in innerHTML', () => {
    // Franchise names come straight from MFL.
    expect(src).toMatch(/escapeHtml\(owner\.fn/);
  });

  it('renders every roster that held the player, not just the first', () => {
    expect(src).toMatch(/w\.o && w\.o\.length/);
  });

  it('keeps its client script bundled, because it is TypeScript', () => {
    // The handler carries type annotations (`function (owner: { fi: string ...`)
    // and bare module specifiers. Astro runs a plain <script> through Vite, so
    // esbuild strips the types and resolves the imports at build — both are
    // fine. Marking it `is:inline` ships the source verbatim instead, and the
    // browser throws on the first annotation, taking the whole modal with it.
    // An external reviewer read the annotations as already-broken on PR #1150;
    // they are not, and this is what keeps that true.
    expect(src).toMatch(/import \{[^}]*escapeHtml[^}]*\} from '\.\.\/\.\.\/utils\/player-cell-html'/);
    expect(src).not.toMatch(/<script[^>]*\bis:inline\b/);
  });

  it('drops the opponent-strength columns when the league has no data for them', () => {
    // fantasyPointsAllowed.json is scored with a league's OWN rules, so it is
    // per league — and the AFL had none, leaving two permanently blank columns.
    expect(src).toContain('wr-no-opp-stats');
  });
});
