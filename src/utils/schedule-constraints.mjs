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
 * @param {{ crossConference?: boolean, divisionSize?: number }} [league]
 *   `crossConference` — the league plays one cross-conference game (the AFL).
 *   Its Week 1 slot is the reason the AFL's bye-free division ceiling is not
 *   the whole schedule, so the clause only appears for a league that has one.
 * @returns {{rank:number, tier:string, rule:string, why:string, enforcedBy:string|null}[]}
 */
export const scheduleConstraints = ({ crossConference = false } = {}) => {
  const list = [
    {
      tier: 'format',
      rule: 'One game per franchise per week — two in a doubleheader — and every franchise plays the same number of games.',
      why: 'A season is a set of whole rounds. Move a single game and the invariant breaks on the first move.',
      enforcedBy: 'validateSeason',
    },
    {
      tier: 'format',
      rule: crossConference
        ? 'Division rivals twice, the other division in your conference once, and one cross-conference game in Week 1.'
        : 'Division rivals twice, everybody else once.',
      why: crossConference
        ? 'The constitution fixes both the opponent counts and the week the cross-conference game is played.'
        : 'The constitution fixes the opponent counts.',
      enforcedBy: 'validateSeason',
    },
    {
      tier: 'hard',
      rule: 'No doubleheader falls on an NFL bye week.',
      why: 'A doubleheader pays the bye penalty twice, so a bye week is the one week it must not land on.',
      enforcedBy: 'validateSeason',
    },
    {
      tier: 'hard',
      rule: 'Division rivals never meet twice inside three weeks.',
      why: 'A rematch seven days later is the same game again — same rosters, no new information — and it settles the division race before the season has one.',
      enforcedBy: 'tests/schedule-optimization.test.ts',
    },
    {
      tier: 'hard',
      rule: 'Doubleheaders split between the start and the end of the season.',
      why: 'Both ends carry extra games, so neither half of the season decides more than its share. It yields to the rule above it: in a year with too few bye-free weeks at one end, staying off the byes wins.',
      enforcedBy: 'chooseDoubleheaderWeeks + tests/schedule-optimization.test.ts',
    },
    {
      tier: 'maximise',
      rule: 'Division games take every bye-free slot the format leaves them.',
      why: crossConference
        ? 'It is a ceiling, not a target of zero: a franchise has 8 bye-free slots, one goes to the Week 1 cross-conference game, and it plays 10 division games — so some are forced onto bye weeks no matter how the season is drawn.'
        : 'Reported against the slots the format actually leaves, never against zero.',
      enforcedBy: 'divisionGameCeiling',
    },
    {
      tier: 'maximise',
      rule: 'Bye-week luck is levelled — first the gap between the two teams in a game, then each franchise’s season-long net.',
      why: 'The heaviest term in the objective. Facing a team missing four starters while you are whole is the largest unearned edge a schedule can hand out.',
      enforcedBy: 'scoreSeason',
    },
    {
      tier: 'maximise',
      rule: 'Doubleheader opponents, then late-season opponents, are balanced in strength.',
      why: 'The weeks that count double and the weeks that decide seeding should not be systematically easier for some franchises.',
      enforcedBy: 'scoreSeason',
    },
    {
      tier: 'preference',
      rule: 'The season’s worst bye week gets an interdivision round, and the season ends on division games.',
      why: 'A rivalry finish is worth having, but not at the cost of the fairness terms above — in a year when the final week IS the worst bye week, the finale is not all-division.',
      enforcedBy: 'buildWeekPlan',
    },
    {
      tier: 'exact',
      rule: 'Home and away are balanced as evenly as the schedule allows.',
      why: 'Which side is home constrains nothing else, so it is fixed exactly by a post-pass instead of being annealed for.',
      enforcedBy: 'balanceHomeAway',
    },
  ];
  return list.map((c, i) => ({ rank: i + 1, ...c }));
};

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
