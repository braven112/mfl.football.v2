/**
 * The schedule's constraints, IN PRIORITY ORDER — one list, three readers.
 *
 * WHY THIS FILE EXISTS
 *
 * The rules were written down in four places (the two constitutions, the admin
 * panel's bullet list, this module's callers) and every copy said something
 * slightly different about what outranks what. That matters because the most
 * common question about a schedule is not "what are the rules" but "why did
 * you break one" — and the answer is almost always "because a higher one won".
 * A reader who cannot see the order cannot see the answer, so the reveal page
 * showed a bye-week division game with no way to tell a forced one from a
 * mistake.
 *
 * The order below is the order the CODE applies, not an aspiration:
 *
 *   format      the round set itself. Nothing trades against it.
 *   hard        `validateSeason` (or a guard test) rejects a season that
 *               breaks it — the CLI exits non-zero and the admin page
 *               disables its copy button.
 *   maximise    optimised as far as the format allows, and reported against
 *               that allowance rather than against a perfect score.
 *   preference  real, stated, and the first thing to yield.
 *   exact       settled by a post-pass once everything above is fixed.
 *
 * ONE GOAL LIST FOR EVERY LEAGUE
 *
 * The leagues share these goals exactly; what differs is how well each can hit
 * them in a given year, because the formats differ and the NFL's bye calendar
 * moves. So nothing here branches on the league. An earlier version wrote goal
 * 2 two ways — naming the AFL's Week 1 cross-conference round in one and not
 * the other — which quietly turned a shared goal into two different goals and
 * made the two leagues' scorecards incomparable. Format specifics belong in the
 * VERDICT (`schedule-goals.mjs`), which is per-league and per-season by nature.
 *
 * RULES ARRIVE OVER TIME, AND OLD SEASONS MUST NOT INHERIT THEM
 *
 * A reveal page is a record of a season that was already drawn. Rendering
 * today's rule list against it silently backdates every rule the league has
 * added since — the light-bye-week rule shipped in Aug 2026 and appeared
 * immediately under the 2026 reveal's heading "The rules this draw had to
 * satisfy", next to a draw made before the rule existed that does not satisfy
 * it. The schedule was right and the page was wrong.
 *
 * So a rule may carry `since: <season>`, and callers displaying a SPECIFIC
 * season pass it: `scheduleConstraints({ season })` returns only what was in
 * force then, renumbered, and `upcomingConstraints({ season })` returns the
 * ones that arrive later so the page can say so instead of pretending. Omit
 * `season` — as the planner UI does, since it draws the next one — and
 * everything is in force.
 *
 * ADDING A RULE IS THEREFORE ONE ENTRY plus a `since` year. Do not renumber
 * anything: rank is positional and derived.
 *
 * `since` gates DOCUMENTATION, never the planner. `buildWeekPlan` applies every
 * adopted rule whichever season it is pointed at, because it draws schedules
 * and a draw should be as good as we currently know how to make it. The archive
 * is the record of what was in force when a season was locked; the planner is
 * always current. Keeping the version logic out of the algorithm is the whole
 * point — a scheduler carrying five years of rule vintages is unmaintainable.
 *
 * Keep this in step with `SCHEDULE_POLICY` (schedule-plan.mjs), `buildWeekPlan`
 * and `scoreSeason` (schedule-builder.mjs), and `validateSeason`
 * (schedule-plan.mjs). `tests/schedule-constraints.test.ts` pins the tiers, the
 * ordering, and the fact that every hard rule names the thing that enforces it.
 *
 * NO CLIENT-SIDE WEIGHT. ScheduleRelease.tsx is `client:load`, so this module
 * must stay data-only: importing the planner here would drag the annealer into
 * every owner's browser.
 */

/** Tiers, strongest first. Index is the precedence. */
export const CONSTRAINT_TIERS = ['format', 'hard', 'maximise', 'preference', 'exact'];

/** @type {Record<string, string>} — indexed by `constraint.tier`, which is a plain string. */
export const TIER_LABEL = {
  format: 'The format',
  hard: 'Hard rule',
  maximise: 'Maximised',
  preference: 'Preference',
  exact: 'Settled exactly',
};

/**
 * Every rule the league has ever adopted, in force order — including ones not
 * yet effective. Callers want `scheduleConstraints` or `upcomingConstraints`.
 */
const allConstraints = () => {
  const list = [
    {
      key: 'one-game-per-week',
      tier: 'format',
      rule: 'One game per franchise per week — two in a doubleheader — and every franchise plays the same number of games.',
      why: 'A season is a set of whole rounds. Move a single game and the invariant breaks on the first move.',
      enforcedBy: 'validateSeason',
    },
    {
      key: 'opponent-counts',
      tier: 'format',
      rule: 'Every franchise plays the opponent set its constitution defines — division rivals twice — and any round the constitution pins to a fixed week is played in that week.',
      why: 'The opponent counts, and the AFL\u2019s Week 1 cross-conference round, are constitutional. They are not the scheduler\u2019s to trade, which is why they sit above every goal that is.',
      enforcedBy: 'validateSeason',
    },
    {
      key: 'doubleheaders-off-byes',
      tier: 'hard',
      rule: 'No doubleheader falls on an NFL bye week.',
      why:
        'THE TOP GOAL. A doubleheader pays the bye penalty twice, so a bye week is the one week it must not land on. ' +
        'It has an escape hatch nothing else has: in a year when no league-wide week works, the commissioner has ' +
        'staggered doubleheaders franchise by franchise so each team plays its two games in a week its own roster is ' +
        'whole. That is a last resort — it breaks the round structure everything else here relies on and has to be ' +
        'built by hand — and it is still better than putting a doubleheader on a bye.',
      enforcedBy: 'validateSeason',
    },
    {
      key: 'rematch-gap',
      tier: 'hard',
      rule: 'Division rivals never meet twice inside three weeks.',
      why: 'A rematch seven days later is the same game again — same rosters, no new information — and it settles the division race before the season has one.',
      enforcedBy: 'tests/schedule-optimization.test.ts',
    },
    {
      key: 'doubleheader-split',
      tier: 'hard',
      rule: 'Doubleheaders split between the start and the end of the season.',
      why: 'Both ends carry extra games, so neither half of the season decides more than its share. It yields to the goal above it: in a year with too few bye-free weeks at one end, staying off the byes wins.',
      enforcedBy: 'chooseDoubleheaderWeeks + tests/schedule-optimization.test.ts',
    },
    {
      key: 'division-bye-free-ceiling',
      tier: 'maximise',
      rule: 'Division games take every bye-free slot the format leaves them.',
      why: 'A ceiling, not a target of zero. A franchise has only so many bye-free game slots, and a format needing more division games than it has clean slots must put some on a bye however the season is drawn — the AFL cannot reach zero at all, The League can only by giving up its rivalry finish. Always reported against the slots the format actually leaves.',
      enforcedBy: 'divisionGameCeiling',
    },
    {
      key: 'light-bye-weeks',
      tier: 'maximise',
      rule: 'The division games that cannot dodge a bye week take the LIGHTEST bye weeks — ideally ones with only two NFL teams out.',
      why: 'Which division games land on a bye week is settled by the rule above; WHICH bye week is still a free choice, and a two-team week costs a couple of rosters a starter where a six-team week guts half the league. The second leg\u2019s window is widened backwards until the light weeks are reachable, and stops exactly where the three-week rematch rule says it must.',
      enforcedBy: 'buildWeekPlan + tests/schedule-week-plan.test.ts',
      // Adopted Aug 2026, after the 2026 schedules were drawn, locked and
      // pasted into MFL. 2026 is not re-drawn for it.
      since: 2027,
    },
    {
      key: 'bye-luck',
      tier: 'maximise',
      rule: 'Bye-week luck is levelled — first the gap between the two teams in a game, then each franchise’s season-long net.',
      why: 'The heaviest term in the objective. Facing a team missing four starters while you are whole is the largest unearned edge a schedule can hand out.',
      enforcedBy: 'scoreSeason',
    },
    {
      key: 'opponent-strength',
      tier: 'maximise',
      rule: 'Doubleheader opponents, then late-season opponents, are balanced in strength.',
      why: 'The weeks that count double and the weeks that decide seeding should not be systematically easier for some franchises.',
      enforcedBy: 'scoreSeason',
    },
    {
      key: 'worst-week-and-finale',
      tier: 'preference',
      rule: 'The season’s worst bye week gets an interdivision round, and the season ends on division games.',
      why: 'A rivalry finish is worth having, but not at the cost of the fairness terms above — in a year when the final week IS the worst bye week, the finale is not all-division.',
      enforcedBy: 'buildWeekPlan',
    },
    {
      key: 'home-away',
      tier: 'exact',
      rule: 'Home and away are balanced as evenly as the schedule allows.',
      why: 'Which side is home constrains nothing else, so it is fixed exactly by a post-pass instead of being annealed for.',
      enforcedBy: 'balanceHomeAway',
    },
  ];
  return list.map((c) => ({ since: null, enforcedBy: null, ...c }));
};

/** Was this rule in force for `season`? A rule with no `since` always was. */
const inForce = (constraint, season) =>
  season == null || constraint.since == null || season >= constraint.since;

/**
 * The rules a given season's schedule actually had to satisfy, ranked 1..n.
 *
 * @param {{ season?: number|null }} [opts]
 *   `season` — the season being DISPLAYED. Omit when planning the next one
 *   (the admin builder) so every adopted goal applies. The list does not vary
 *   by league; only the verdicts do.
 * @returns {{rank:number, tier:string, rule:string, why:string,
 *            enforcedBy:string|null, since:number|null}[]}
 */
export const scheduleConstraints = ({ season = null } = {}) =>
  allConstraints()
    .filter((c) => inForce(c, season))
    .map((c, i) => ({ rank: i + 1, ...c }));

/**
 * Rules adopted AFTER `season` — what a past reveal is allowed to say about
 * its own gaps. Unranked on purpose: they had no rank in that season's list.
 * Empty when `season` is omitted or is current.
 */
export const upcomingConstraints = ({ season = null } = {}) =>
  season == null ? [] : allConstraints().filter((c) => !inForce(c, season));

/**
 * How many division games ended up on NFL bye weeks, and how much of that the
 * format forced.
 *
 * The two numbers are NOT the same thing and the difference is the whole point:
 * the AFL's 36 are all forced, while The League's ceiling is its entire
 * schedule and any bye-week division game there is a preference being spent.
 * Printing the raw count without that split reads as a failure in one league
 * and as a free pass in the other.
 *
 * @param {{ total?: number, byeFree: number, ceiling: number }} summary
 */
export const divisionByeSplit = ({ total, byeFree, ceiling }) => {
  if (!Number.isFinite(total) || !total) return null;
  const onByes = total - byeFree;
  const forced = Math.max(0, total - ceiling);
  const chosen = Math.max(0, onByes - forced);
  return {
    total,
    onByes,
    percent: Math.round((onByes / total) * 100),
    forced,
    chosen,
    /** Every bye-week division game the format allowed us to avoid, we avoided. */
    atCeiling: byeFree >= ceiling,
  };
};

/**
 * One sentence explaining the count above — the caption under the number.
 * `finaleNote` is the league's own reason for spending any non-forced ones.
 */
export const describeDivisionByeSplit = (split, { finaleNote = 'the all-division finish' } = {}) => {
  if (!split) return null;
  if (!split.onByes) return 'not one of them lands on an NFL bye week';
  if (!split.chosen) return `all ${split.forced} forced by the format — the floor, not a miss`;
  if (!split.forced) return `${split.chosen} spent on ${finaleNote}`;
  return `${split.forced} forced by the format, ${split.chosen} spent on ${finaleNote}`;
};
