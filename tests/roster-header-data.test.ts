import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildTeamGroups,
  buildSeasonRail,
  bestValuePlayer,
  bestPlayerByPositionRank,
  positionalRanks,
  compactSalary,
  resolveHeaderSchedule,
} from '../src/utils/roster-header-data';
import { franchiseSchedule, parseWeeklySchedule } from '../src/utils/schedule-data.mjs';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import tlConfig from '../src/data/theleague.config.json';

/**
 * The roster header's team switcher. The two leagues nest differently, and the
 * difference is load-bearing: the AFL's two conferences use DISJOINT division
 * names (American runs North/South, National runs East/West), so a flat
 * division grouping would merge clubs under labels that do not mean the same
 * thing in both halves of the league.
 */
describe('buildTeamGroups', () => {
  it('gives a single-table league one group with no conference rail', () => {
    const groups = buildTeamGroups({
      teams: tlConfig.teams,
      conferences: null,
      divisions: tlConfig.divisions,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].conferenceId).toBeNull();
    expect(groups[0].conferenceName).toBeNull();
    expect(groups[0].divisions.map((d) => d.name)).toEqual(tlConfig.divisions);
  });

  it('carries a short code for the vertical rail', () => {
    const groups = buildTeamGroups({
      teams: aflConfig.teams,
      conferences: aflConfig.conferences,
      viewerConference: '00',
    });
    // "American League" set vertically is taller than the crest row, so the
    // rail shows the code and keeps the full name as its accessible label.
    expect(groups.map((g) => g.conferenceShort)).toEqual(['AL', 'NL']);
  });

  it('has no conference rail in a single-table league', () => {
    const groups = buildTeamGroups({
      teams: tlConfig.teams,
      conferences: null,
      divisions: tlConfig.divisions,
    });
    expect(groups[0].conferenceShort).toBeNull();
  });

  it('nests division inside conference for the AFL', () => {
    const groups = buildTeamGroups({
      teams: aflConfig.teams,
      conferences: aflConfig.conferences,
      viewerConference: '00',
    });
    expect(groups.map((g) => g.conferenceName)).toEqual(['American League', 'National League']);
    expect(groups[0].divisions.map((d) => d.name)).toEqual(['North', 'South']);
    expect(groups[1].divisions.map((d) => d.name)).toEqual(['East', 'West']);
  });

  it('leads with the viewer’s own conference', () => {
    const nl = buildTeamGroups({
      teams: aflConfig.teams,
      conferences: aflConfig.conferences,
      viewerConference: '01',
    });
    expect(nl.map((g) => g.conferenceName)).toEqual(['National League', 'American League']);
  });

  it('keeps the historical order for a viewer with no conference', () => {
    for (const viewer of [null, undefined]) {
      const groups = buildTeamGroups({
        teams: aflConfig.teams,
        conferences: aflConfig.conferences,
        viewerConference: viewer,
      });
      expect(groups.map((g) => g.conferenceId)).toEqual(['00', '01']);
    }
  });

  /**
   * A club missing from the switcher is unreachable, which is a worse failure
   * than one under an unexpected heading. Whatever the ordering, every club
   * must appear exactly once.
   */
  it('never drops or duplicates a club, in either league or any order', () => {
    const cases = [
      { teams: tlConfig.teams, conferences: null, divisions: tlConfig.divisions },
      { teams: aflConfig.teams, conferences: aflConfig.conferences, viewerConference: '00' },
      { teams: aflConfig.teams, conferences: aflConfig.conferences, viewerConference: '01' },
      { teams: aflConfig.teams, conferences: aflConfig.conferences, viewerConference: null },
    ];
    for (const input of cases) {
      const ids = buildTeamGroups(input as any)
        .flatMap((g) => g.divisions)
        .flatMap((d) => d.teams.map((t) => t.franchiseId));
      expect(ids).toHaveLength(input.teams.length);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('surfaces a division the config forgot rather than dropping its clubs', () => {
    const groups = buildTeamGroups({
      teams: [
        { franchiseId: '0001', name: 'A', division: 'Known' },
        { franchiseId: '0002', name: 'B', division: 'Undeclared' },
      ],
      conferences: null,
      divisions: ['Known'],
    });
    expect(groups[0].divisions.map((d) => d.name)).toEqual(['Known', 'Undeclared']);
  });
});

describe('buildSeasonRail', () => {
  const feed = {
    schedule: {
      weeklySchedule: [
        {
          week: '1',
          matchup: [
            {
              franchise: [
                { id: '0001', isHome: '1', result: 'W', score: '120.5' },
                { id: '0002', isHome: '0', result: 'L', score: '99.0' },
              ],
            },
          ],
        },
        {
          // 0001 is on bye — the week exists but it plays nobody.
          week: '2',
          matchup: [
            {
              franchise: [
                { id: '0003', isHome: '1', result: 'W', score: '110.0' },
                { id: '0002', isHome: '0', result: 'L', score: '90.0' },
              ],
            },
          ],
        },
        {
          week: '3',
          matchup: [
            {
              franchise: [
                { id: '0001', isHome: '0', result: 'T' },
                { id: '0003', isHome: '1', result: 'T' },
              ],
            },
          ],
        },
      ],
    },
  };
  const weeks = parseWeeklySchedule(feed);
  const rail = buildSeasonRail(
    franchiseSchedule(weeks, '0001'),
    weeks.map((w) => w.week),
    3,
  );

  it('keeps one slot per scheduled week so every club’s rail is the same width', () => {
    expect(rail.map((r) => r.week)).toEqual([1, 2, 3]);
  });

  it('marks a bye week as holding no games at all', () => {
    expect(rail[1]).toMatchObject({ week: 2, games: [] });
  });

  it('does not treat an unplayed game as a result', () => {
    expect(rail[2]).toMatchObject({ week: 3, isCurrent: true });
    expect(rail[2].games).toEqual([{ played: false, outcome: null, opponentId: '0003' }]);
  });

  it('carries the outcome of a played week', () => {
    expect(rail[0].games).toEqual([{ played: true, outcome: 'W', opponentId: '0002' }]);
  });

  /**
   * The bug the user reported, in the smallest form that reproduces it.
   *
   * TheLeague opened 2026 with three DOUBLEHEADER weeks. The rail kept
   * `games[games.length - 1]` per week and dropped the rest, so a club that
   * split week 1 drew one green mark and read as 1-0 beside a nameplate
   * saying 1-1: "Pigskins has 2 green but is one and one."
   */
  it('keeps BOTH games of a doubleheader, so the marks count the record', () => {
    const doubleheader = parseWeeklySchedule({
      schedule: {
        weeklySchedule: [
          {
            week: '1',
            matchup: [
              {
                franchise: [
                  { id: '0001', isHome: '1', result: 'L', score: '99.11' },
                  { id: '0002', isHome: '0', result: 'W', score: '120.54' },
                ],
              },
              {
                franchise: [
                  { id: '0001', isHome: '1', result: 'W', score: '99.11' },
                  { id: '0008', isHome: '0', result: 'L', score: '91.74' },
                ],
              },
            ],
          },
        ],
      },
    });
    const split = buildSeasonRail(
      franchiseSchedule(doubleheader, '0001'),
      [1],
      1,
    );
    expect(split[0].games).toHaveLength(2);
    expect(split[0].games.map((g) => g.outcome)).toEqual(['L', 'W']);
    // What the reader counts: one green, one red, for a 1-1 week.
    const wins = split.flatMap((w) => w.games).filter((g) => g.outcome === 'W');
    const losses = split.flatMap((w) => w.games).filter((g) => g.outcome === 'L');
    expect([wins.length, losses.length]).toEqual([1, 1]);
  });
});

/**
 * The header's featured player. Which player it is depends on what the league
 * HAS: a cap league shows the biggest contract, a league with no salaries at
 * all (the AFL) shows who ranks best at his own position.
 */
describe('the featured player', () => {
  const roster = [
    { id: '1', name: 'Saquon Barkley', position: 'RB', salary: 7200000, headshot: '/a.png' },
    { id: '2', name: 'Jake Ferguson', position: 'TE', salary: 4207142.5 },
    { id: '3', name: 'Bo Nix', position: 'QB', salary: 968000 },
    { id: '4', name: 'A Kicker', position: 'PK', salary: 9000000 },
  ];

  describe('in a salary league', () => {
    // Barkley is the biggest contract but poor value; Nix is the cheap pick
    // that actually won the club something. The old "top salary" metric
    // picked Barkley — or worse, the kicker.
    const valueRoster = [
      { id: '1', name: 'Saquon Barkley', position: 'RB', salary: 7200000, points: 300, headshot: '/a.png' },
      { id: '3', name: 'Bo Nix', position: 'QB', salary: 968000, points: 252.58 },
      { id: '4', name: 'A Kicker', position: 'PK', salary: 9000000, points: 120 },
    ];

    it('is the most points per dollar, not the biggest contract', () => {
      // Nix 261 pts/$M vs Barkley 42 — value, not spend.
      expect(bestValuePlayer(valueRoster)).toMatchObject({
        name: 'Bo Nix',
        statValue: '261 pts/$M',
        statLabel: 'Best value',
      });
    });

    it('never features a kicker or defence, however good the ratio', () => {
      // They cost the league minimum and score steadily, so on points-per-
      // dollar they are nearly unbeatable — unfiltered they took 5 of
      // TheLeague's 16 cards. The kicker above is $9M so he loses anyway;
      // this pins a CHEAP one, which is the case that actually bites.
      const cheapKicker = [
        { id: '4', name: 'Nick Folk', position: 'PK', salary: 420000, points: 109.8 },
        { id: '3', name: 'Bo Nix', position: 'QB', salary: 968000, points: 252.58 },
      ];
      expect(bestValuePlayer(cheapKicker)!.name).toBe('Bo Nix');
      const def = [{ id: '5', name: 'Los Angeles Rams', position: 'DEF', salary: 600000, points: 140.8 }];
      expect(bestValuePlayer(def)).toBeNull();
    });

    it('never lets a free slot divide to infinity and win on a technicality', () => {
      const withFreebie = [...valueRoster, { id: '9', name: 'Free Agent', position: 'WR', salary: 0, points: 40 }];
      expect(bestValuePlayer(withFreebie)!.name).toBe('Bo Nix');
      expect(bestValuePlayer([{ id: '9', name: 'X', position: 'WR', salary: 0, points: 40 }])).toBeNull();
    });

    it('is null before anyone has scored, rather than whoever the sort reached first', () => {
      // Every ratio is zero in week zero; picking one would be arbitrary.
      const preseason = valueRoster.map((p) => ({ ...p, points: 0 }));
      expect(bestValuePlayer(preseason)).toBeNull();
    });

    it('carries the headshot when there is one, and null when there is not', () => {
      expect(bestValuePlayer([valueRoster[0]])!.headshot).toBe('/a.png');
      expect(bestValuePlayer([valueRoster[1]])!.headshot).toBeNull();
    });

    it('is null when nobody has a salary — which is every non-cap league', () => {
      expect(bestValuePlayer([{ id: '1', name: 'X', position: 'RB', points: 200 }])).toBeNull();
      expect(bestValuePlayer([])).toBeNull();
    });
  });

  describe('in a league with no salaries', () => {
    // Nix is QB8, Barkley RB2, Ferguson TE1 -> Ferguson wins on positional rank.
    const rankOf = (id: string) => ({ '1': 2, '2': 1, '3': 8, '4': 1 }[id] ?? null);

    it('is whoever ranks best at his own position', () => {
      expect(bestPlayerByPositionRank(roster, rankOf)).toMatchObject({
        name: 'Jake Ferguson',
        statValue: 'TE1',
        statLabel: 'Best at position',
      });
    });

    it('never picks a kicker or defence, however well they rank', () => {
      // The kicker is also rank 1 and listed after Ferguson; skipping the
      // position entirely is what keeps him out, not tie-break luck.
      const kickerOnly = [{ id: '4', name: 'A Kicker', position: 'PK' }];
      expect(bestPlayerByPositionRank(kickerOnly, () => 1)).toBeNull();
      const withDef = [{ id: '5', name: 'A Defence', position: 'DEF' }];
      expect(bestPlayerByPositionRank(withDef, () => 1)).toBeNull();
    });

    it('skips a player the ranking does not know rather than calling him best', () => {
      // An unranked player is unknown, not rank 0.
      expect(bestPlayerByPositionRank([roster[0]], () => null)).toBeNull();
    });

    it('is null on an empty roster', () => {
      expect(bestPlayerByPositionRank([], () => 1)).toBeNull();
    });
  });

  describe('positionalRanks', () => {
    const pool = [
      { id: 'a', position: 'WR', score: 200 },
      { id: 'b', position: 'WR', score: 300 },
      { id: 'c', position: 'QB', score: 400 },
      { id: 'd', position: 'PK', score: 999 },
    ];

    it('ranks within a position, best first', () => {
      const r = positionalRanks(pool);
      expect(r.get('b')).toBe(1);
      expect(r.get('a')).toBe(2);
      expect(r.get('c')).toBe(1);
    });

    it('leaves out positions the header never features', () => {
      expect(positionalRanks(pool).has('d')).toBe(false);
    });

    it('ignores a player with no usable score', () => {
      expect(positionalRanks([{ id: 'x', position: 'WR', score: NaN }]).has('x')).toBe(false);
    });
  });

  describe('compactSalary', () => {
    it('reads at a glance at every magnitude', () => {
      expect(compactSalary(7200000)).toBe('$7.2M');
      expect(compactSalary(968000)).toBe('$968K');
      expect(compactSalary(450)).toBe('$450');
      expect(compactSalary(-2400000)).toBe('-$2.4M');
      expect(compactSalary(Number.NaN)).toBe('—');
    });
  });
});

/**
 * The roster page rewrites `p.points` in place with LAST season's totals
 * whenever the current season reads all-zero — every year between the league
 * rollover and kickoff — so the extension and franchise-tag filters keep
 * working. That mutation runs BEFORE the header is built, so a header that
 * reads `points` prices a full prior season against this year's salary:
 * Drake Maye's 304.58 points from 2025 against his 2026 cap hit, two weeks
 * into 2026.
 *
 * The page maps `totalSeason` into `points` before calling `bestValuePlayer`.
 * This pins that the mapping is still there and still wins.
 */
describe('the value metric reads THIS season, not last', () => {
  const PAGE = fs.readFileSync(
    path.join(process.cwd(), 'src/pages/theleague/rosters.astro'),
    'utf-8',
  );

  it('maps totalSeason into points before picking the featured player', () => {
    const call = PAGE.slice(
      PAGE.indexOf('featuredPlayer: bestValuePlayer('),
      PAGE.indexOf('lastResult: findLastResult('),
    );
    expect(call, 'the header must not read the page’s mutated `points`').toMatch(
      /points:\s*player\??\.?\[?'?totalSeason/,
    );
  });

  it('prefers the cheap in-season producer over last season’s star', () => {
    // Exactly the shape the bug produced: `points` is last season, so reading
    // it crowns Maye; `totalSeason` is this season, where Nix is the value.
    const roster = [
      { id: '1', name: 'Drake Maye', position: 'QB', salary: 640000, points: 304.58, totalSeason: 19.8 },
      { id: '2', name: 'Bo Nix', position: 'QB', salary: 968000, points: 12.0, totalSeason: 60.0 },
    ];
    const thisSeason = roster.map((p) => ({ ...p, points: p.totalSeason }));
    expect(bestValuePlayer(thisSeason)!.name).toBe('Bo Nix');
    // ...and the un-mapped call is what used to be wrong.
    expect(bestValuePlayer(roster)!.name).toBe('Drake Maye');
  });

  it('skips a player whose season total is the feed’s "-" placeholder', () => {
    const roster = [{ id: '1', name: 'X', position: 'QB', salary: 500000, points: '-' }];
    expect(bestValuePlayer(roster)).toBeNull();
  });

  it('skips a negative season total rather than ranking it', () => {
    // Real: a WR can sit at -0.6 after a fumble-heavy opener.
    const roster = [{ id: '1', name: 'X', position: 'WR', salary: 500000, points: -0.6 }];
    expect(bestValuePlayer(roster)).toBeNull();
  });
});

/**
 * The season rail's four states have to be told apart by someone glancing at
 * a phone, and the first version could not be.
 *
 * `--color-accent` is `#2e8743` in TheLeague and `#4ade80` in dark mode —
 * green, the same family as `--color-success`. The current week was painted
 * with it, so a 1-1 club drew a green win, a red loss and a green current
 * week, and read as 2-1. (Reported exactly that way: "Pigskins has 2 green
 * but is one and one.")
 *
 * The fix is structural rather than a new hue: a week that was PLAYED is a
 * filled mark and is the only thing that carries colour; a week that was not
 * is an outline. That survives greyscale and every form of colour blindness,
 * and it cannot be undone by a token whose value changes.
 */
describe('the season rail distinguishes a result from the current week', () => {
  const BAR = fs.readFileSync(
    path.join(process.cwd(), 'src/components/shared/roster-header/GamedayBar.astro'),
    'utf-8',
  );

  /** The declarations inside one `.rhdr-rail__dot.<state> .rhdr-rail__mark` rule. */
  const markRule = (state: string) => {
    const head = `.rhdr-rail__dot.${state} .rhdr-rail__mark`;
    const at = BAR.indexOf(head);
    expect(at, `${head} must exist`).toBeGreaterThan(-1);
    const open = BAR.indexOf('{', at);
    return BAR.slice(open + 1, BAR.indexOf('}', open));
  };

  it('paints the played weeks, and only the played weeks', () => {
    expect(markRule('is-win')).toMatch(/background:\s*var\(--color-success/);
    expect(markRule('is-loss')).toMatch(/background:\s*var\(--color-error/);
    for (const unplayed of ['is-now', 'is-future']) {
      expect(markRule(unplayed), `an unplayed week must not be filled (${unplayed})`)
        .toMatch(/background:\s*transparent/);
    }
  });

  it('never marks the current week with the accent, which is green here', () => {
    expect(
      markRule('is-now'),
      '--color-accent is green in TheLeague; an accent mark reads as a win',
    ).not.toContain('--color-accent');
  });

  it('separates the current week from a future one by weight, not hue', () => {
    expect(markRule('is-now'), 'the current week is a solid ring').toMatch(/border:[^;]*solid/);
    expect(markRule('is-future'), 'a future week stays faint').toMatch(/border:[^;]*dashed/);
  });

  it('keeps the bordered marks inside their column', () => {
    // This repo has no global `border-box`, so a bordered mark would otherwise
    // grow past `width: 100%` and shift every dot after it.
    const at = BAR.indexOf('.rhdr-rail__mark {');
    const base = BAR.slice(at, BAR.indexOf('}', at));
    expect(base).toMatch(/box-sizing:\s*border-box/);
  });

  it('only calls a week current when it has NOT been played', () => {
    // A played current week must show its result, not the "you are here" ring.
    expect(BAR).toMatch(/'is-now':\s*!game\?\.played && entry\.isCurrent/);
  });
});

/**
 * The crest row's three presentation rules, all reported from a phone.
 *
 * "I don't like the faded team icons or the bright green active color. on
 * mobile it's to tight between icons as well" — and, a minute later, "don't
 * crop the corners of the icons either."
 *
 * Each has a reason it must not come back:
 *
 *  - A dimmed crest dims the ONE thing identifying the link. The row was
 *    faded to 0.56 at rest to rank it below the scoreboard; it read as
 *    sixteen switched-off clubs. Rank a row down with size and surface.
 *  - `--color-accent` is #2e8743 in TheLeague, the same green the rail above
 *    uses for a win, so the row marked "you are here" and "you won" alike.
 *    The viewed club is ringed in its OWN colour now.
 *  - A 50% radius is a circle mask, and these marks are not all circles.
 */
describe('the crest row shows the clubs at full strength, in their own colour', () => {
  const ROW = fs.readFileSync(
    path.join(process.cwd(), 'src/components/shared/roster-header/TeamDivisionRow.astro'),
    'utf-8',
  );
  const STYLE = ROW.slice(ROW.indexOf('<style>'));
  /** The stylesheet with its comments removed — they quote the rules they replaced. */
  const CSS = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');

  it('never fades a crest', () => {
    // The hover LABEL still fades in; the artwork never does.
    const crestRules = CSS.split('}').filter((rule) => /\.rhdr-teams__(crest|fallback)\b/.test(rule));
    for (const rule of crestRules) {
      expect(rule, 'a dimmed crest hides the only thing identifying the link')
        .not.toMatch(/opacity:\s*0?\.\d/);
    }
  });

  it('never circle-crops a mark', () => {
    // The box that HOLDS the artwork, not the "your team" dot below it, which
    // is a circle on purpose. `::after` rules are excluded by name.
    const boxRules = CSS.split('}')
      .filter((rule) => /\.rhdr-teams__(crest|fallback)\b/.test(rule) && !rule.includes('::after'));
    for (const rule of boxRules) {
      expect(rule, 'a 50% radius eats the corners of every non-circular mark')
        .not.toMatch(/border-radius:\s*50%/);
    }
    expect(STYLE, 'the mark is shown whole inside its box').toMatch(/object-fit:\s*contain/);
  });

  it('rings the viewed club in its own colour, never the accent', () => {
    const active = CSS.slice(CSS.indexOf("[aria-current='page'] img"));
    const rules = active.slice(0, active.indexOf('.rhdr-teams__crest[data-mine'));
    expect(rules).toMatch(/--rhdr-ring/);
    expect(rules, '--color-accent is green here, same as a win on the rail above')
      .not.toContain('--color-accent');
  });

  it('carries no accent green anywhere in the row', () => {
    expect(CSS, 'the only colour in this row is a club colour')
      .not.toContain('var(--color-accent)');
  });

  it('gives a phone MORE room between crests, not less', () => {
    const base = CSS.match(/\.rhdr-teams__crests\s*\{[^}]*gap:\s*([\d.]+)rem/);
    const phone = CSS.match(/@media \(max-width: 640px\)\s*\{[^}]*\.rhdr-teams__crests\s*\{\s*gap:\s*([\d.]+)rem/);
    expect(base, 'the crest row must set a gap').not.toBeNull();
    expect(phone, 'a phone scrolls this row with a thumb and needs the room').not.toBeNull();
    expect(Number(phone![1])).toBeGreaterThan(Number(base![1]));
  });

  it('asks the DOM which division is active, not a render-time class', () => {
    // TheLeague's switcher moves `aria-current` without re-rendering, so a
    // class computed in the component is stale after the first click.
    // The shape, not the bare name: the component carries a comment saying
    // why the class is gone, and that comment names it.
    expect(ROW, 'has-active goes stale on the first in-place switch')
      .not.toMatch(/'has-active'|"has-active"|class=[^>]*has-active/);
    expect(CSS).toMatch(/:has\(\.rhdr-teams__crest\[aria-current='page'\]\)/);
  });
});

/**
 * The ring colour itself. Two values per club because no single one works:
 * seven of TheLeague's sixteen are #181818 (invisible on the dark row) and
 * Midwestside's #ffcd00 is invisible on the light one.
 */
describe('every club gets a ring that is visible on the row it sits on', () => {
  const LIGHT = '#eeeeee';
  const DARK = '#122132';

  const luminance = (hex: string) => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const [label, config] of [['TheLeague', tlConfig], ['the AFL', aflConfig]] as const) {
    it(`clears 3:1 in both themes for every club in ${label}`, () => {
      const groups = buildTeamGroups({
        teams: (config as any).teams,
        conferences: (config as any).conferences ?? null,
        divisions: (config as any).divisions ?? null,
      });
      const teams = groups.flatMap((g) => g.divisions.flatMap((d) => d.teams));
      expect(teams.length).toBeGreaterThan(10);
      for (const team of teams) {
        expect(team.ringLight, `${team.name} light ring`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(team.ringDark, `${team.name} dark ring`).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ratio(team.ringLight, LIGHT), `${team.name} on the light row`).toBeGreaterThanOrEqual(3);
        expect(ratio(team.ringDark, DARK), `${team.name} on the dark row`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('leaves a brand colour that already clears the floor untouched', () => {
    // `ensureContrastOn` only shifts a colour that misses — most clubs keep
    // their exact brand value, which is the point of doing this per club.
    const groups = buildTeamGroups({
      teams: (tlConfig as any).teams,
      conferences: null,
      divisions: (tlConfig as any).divisions,
    });
    const pigskins = groups[0].divisions
      .flatMap((d) => d.teams)
      .find((t) => t.franchiseId === '0001')!;
    expect(pigskins.ringLight.toLowerCase()).toBe('#bd1f2b');   // its own primary
    expect(pigskins.ringDark.toLowerCase()).toBe('#e23b46');    // its own colorPrimaryDark
  });
});

/**
 * The club name is a label for assistive tech, not a tooltip.
 *
 * It revealed on `:hover` and `:focus-visible`, which on a touch screen means
 * it revealed on TAP: the name flashed over the row on the way to switching
 * team, and the leftmost crest's label ran off the edge of the phone. "Get rid
 * of the text tooltip, we know the names."
 *
 * It cannot simply be deleted: it is the anchor's accessible name, and the
 * only other content is an `alt=""` image, so removing it leaves 16 or 24
 * unlabelled links. Visually hidden, not `display: none`.
 */
describe('the crest row labels its links without showing a tooltip', () => {
  const ROW = fs.readFileSync(
    path.join(process.cwd(), 'src/components/shared/roster-header/TeamDivisionRow.astro'),
    'utf-8',
  );
  const CSS = ROW.slice(ROW.indexOf('<style>')).replace(/\/\*[\s\S]*?\*\//g, '');

  it('still carries the name, so no crest is an unlabelled link', () => {
    expect(ROW).toMatch(/<span class="rhdr-teams__name">\s*\{team\.name\}/);
    expect(ROW, 'the viewer’s own club says so in its accessible name')
      .toContain("' (your team)'");
    // A `title` does not surface on touch and reads late on a screen reader.
    expect(ROW).not.toMatch(/title=\{team\./);
  });

  it('never reveals it on hover, focus or tap', () => {
    expect(CSS, 'hover is tap on a phone')
      .not.toMatch(/\.rhdr-teams__crest:(hover|focus-visible)\s+\.rhdr-teams__name/);
  });

  it('hides it visually without hiding it from assistive tech', () => {
    const rule = CSS.slice(CSS.indexOf('.rhdr-teams__name {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body, 'display:none / visibility:hidden drop it from the a11y tree')
      .not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
  });
});

/**
 * A season that is not being played has NO current week.
 *
 * The AFL's rosters page has a year picker, so this header renders 2019 and
 * 2023 as readily as the live season. It was handed today's NFL week either
 * way, and `findLastPlayedWeek` BOUNDS its search — so a 2023 that finished in
 * January 2024 reported "Week 2 · Final · 0-2" as the club's last result,
 * ringed week 2 as current, and printed "Wk 2" on the scale. 2019 showed a
 * week still waiting to be played.
 *
 * `resolveHeaderSchedule` is the one home for the rule, because three call
 * sites need it — TheLeague's default club, its fifteen swap templates, and
 * the AFL's page.
 */
describe('resolveHeaderSchedule', () => {
  const season = parseWeeklySchedule({
    schedule: {
      weeklySchedule: [
        {
          week: '1',
          matchup: [{ franchise: [
            { id: '0001', isHome: '1', result: 'W', score: '120.5' },
            { id: '0002', isHome: '0', result: 'L', score: '99.0' },
          ] }],
        },
        {
          week: '2',
          matchup: [{ franchise: [
            { id: '0001', isHome: '0', result: 'L', score: '88.0' },
            { id: '0003', isHome: '1', result: 'W', score: '101.0' },
          ] }],
        },
        {
          // Never played — MFL stamps `result: "T"` with no score.
          week: '3',
          matchup: [{ franchise: [
            { id: '0001', isHome: '1', result: 'T' },
            { id: '0004', isHome: '0', result: 'T' },
          ] }],
        },
      ],
    },
  });
  const own = franchiseSchedule(season, '0001');
  const weeks = season.map((w) => w.week);

  it('bounds the search at the live week when a season IS being played', () => {
    const live = resolveHeaderSchedule(own, weeks, 1);
    // Bounded: week 2 was played but is in the future relative to "now".
    expect(live.lastPlayed!.week).toBe(1);
    // The first UNPLAYED week at or after now — 1 and 2 both have scores.
    expect(live.upNext!.week).toBe(3);
    expect(live.rail.find((w) => w.isCurrent)!.week).toBe(1);
  });

  it('reports the club’s REAL last week when no season is live', () => {
    const past = resolveHeaderSchedule(own, weeks, null);
    // Week 2, not the bound — this is the bug, in one assertion.
    expect(past.lastPlayed!.week).toBe(2);
    expect(past.lastPlayed!.games[0]).toMatchObject({ outcome: 'L', opponentId: '0003' });
  });

  it('marks no week current when no season is live', () => {
    const past = resolveHeaderSchedule(own, weeks, null);
    expect(past.rail.some((w) => w.isCurrent)).toBe(false);
    expect(past.rail).toHaveLength(3);
  });

  it('searches from week 1 for "up next", so a complete season reports none', () => {
    const past = resolveHeaderSchedule(own, weeks, null);
    expect(past.upNext!.week).toBe(3);

    const complete = franchiseSchedule(
      parseWeeklySchedule({
        schedule: {
          weeklySchedule: [{
            week: '1',
            matchup: [{ franchise: [
              { id: '0001', isHome: '1', result: 'W', score: '120.5' },
              { id: '0002', isHome: '0', result: 'L', score: '99.0' },
            ] }],
          }],
        },
      }),
      '0001',
    );
    expect(resolveHeaderSchedule(complete, [1], null).upNext).toBeNull();
  });

  it('hides the scale’s "you are here" and the "This week" kicker for a dead season', () => {
    const BAR = fs.readFileSync(
      path.join(process.cwd(), 'src/components/shared/roster-header/GamedayBar.astro'),
      'utf-8',
    );
    expect(BAR).toMatch(/\{currentWeek != null && <span class="rhdr-rail__now">/);
    expect(BAR, 'a null now can never say "This week"')
      .not.toMatch(/\{upNext\.week === currentWeek \? 'This week'/);
  });

  it('is what both roster pages call, with a null for a season off the live clock', () => {
    for (const page of ['src/pages/theleague/rosters.astro', 'src/pages/afl-fantasy/rosters.astro']) {
      const src = fs.readFileSync(path.join(process.cwd(), page), 'utf-8');
      expect(src, `${page} must go through resolveHeaderSchedule`).toContain('resolveHeaderSchedule(');
      expect(src, `${page} must null the week off a live season`)
        .toMatch(/=== getCurrentSeasonYear\(\) \? getCurrentWeek\(\) : null|=== currentSeasonYearStr \? currentWeekNum : null/);
    }
  });
});
