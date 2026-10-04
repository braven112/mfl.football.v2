/**
 * League feature catalog — the checkbox list a new league is launched from.
 *
 * One entry per flag in a registry league's `features` block
 * (`LeagueFeatures`, src/config/leagues.ts). The League Launcher renders this
 * list as checkboxes; `suggestLeagueSetup` (league-archetypes.mjs) pre-ticks it
 * from the league's MFL settings; the launch writes the final ticks into the
 * registry entry. `tests/league-feature-catalog.test.ts` fails if a flag exists
 * in the registry without an entry here, or the other way round.
 *
 * `detect(league)` reads MFL's `TYPE=league` export (the `league` object) and
 * answers ONLY when an MFL setting genuinely decides the feature:
 *   - `{ on, reason }` — the setting decides it; overrides the archetype preset.
 *   - `null`           — MFL has no opinion; the archetype preset stands.
 * Never guess here. A feature MFL cannot see (Schefter, push, accounting) has
 * no detector, and the preset — or the AI pass on the Launcher — decides it.
 *
 * `requires` lists features that must also be on. A suggestion or a saved
 * league that ticks a feature without its prerequisites is invalid
 * (`featureDependencyErrors`).
 */

/** @typedef {'roster' | 'live' | 'news' | 'community' | 'admin'} FeatureGroup */

/**
 * @typedef {object} DetectResult
 * @property {boolean} on
 * @property {string} reason  One line, shown beside the checkbox.
 */

/**
 * @typedef {object} FeatureCatalogEntry
 * @property {string} key            Flag name in the registry's `features`.
 * @property {string} label
 * @property {string} description
 * @property {FeatureGroup} group
 * @property {string[]} requires
 * @property {(league: Record<string, any>) => DetectResult | null} [detect]
 */

/** @type {Record<FeatureGroup, string>} */
export const FEATURE_GROUPS = {
  roster: 'Roster management',
  live: 'Game day',
  news: 'News & content',
  community: 'Owners & notifications',
  admin: 'Commissioner tools',
};

const asNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const yes = (v) => String(v ?? '').trim().toLowerCase() === 'yes' || String(v ?? '').trim() === '1';
const arrayOf = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Seasons MFL lists for this league id (its own history block). */
export function mflSeasonCount(league) {
  return arrayOf(league?.history?.league).length;
}

/** @type {FeatureCatalogEntry[]} */
export const FEATURE_CATALOG = [
  {
    key: 'contracts',
    label: 'Player contracts',
    description: 'Contract years on every player: contract pages, expirations, extensions.',
    group: 'roster',
    requires: [],
    detect: (l) =>
      yes(l.usesContractYear)
        ? { on: true, reason: 'MFL tracks contract years (usesContractYear).' }
        : { on: false, reason: 'MFL does not track contract years.' },
  },
  {
    key: 'salaryCap',
    label: 'Salary cap',
    description: 'Salaries, cap space and cap projections.',
    group: 'roster',
    requires: [],
    detect: (l) =>
      yes(l.usesSalaries) && asNum(l.salaryCapAmount) > 0
        ? { on: true, reason: `MFL enforces a salary cap (${asNum(l.salaryCapAmount).toLocaleString('en-US')}).` }
        : { on: false, reason: 'MFL has no salary cap set.' },
  },
  {
    key: 'keepers',
    label: 'Keepers',
    description: 'Keeper selection, keeper deadlines and keeper analysis.',
    group: 'roster',
    requires: [],
    detect: (l) => {
      if (asNum(l.maxKeepers) > 0) {
        return { on: true, reason: `MFL allows ${asNum(l.maxKeepers)} keepers per team.` };
      }
      const kind = String(l.keeperType ?? '').toLowerCase();
      if (kind === 'keeper') return { on: true, reason: 'MFL keeper type is "keeper".' };
      if (kind === 'dynasty') return { on: false, reason: 'Dynasty league: every player carries over, so there is no keeper step.' };
      if (kind === 'none') return { on: false, reason: 'MFL keeper type is "none".' };
      return null;
    },
  },
  {
    key: 'taxiSquad',
    label: 'Taxi squad',
    description: 'A practice squad for rookies parked off the active roster.',
    group: 'roster',
    requires: [],
    detect: (l) =>
      asNum(l.taxiSquad) > 0
        ? { on: true, reason: `MFL taxi squad holds ${asNum(l.taxiSquad)}.` }
        : { on: false, reason: 'MFL has no taxi squad.' },
  },
  {
    key: 'offseasonAuction',
    label: 'Offseason auction',
    description: 'Free agency runs as a live MFL auction in the offseason.',
    group: 'roster',
    requires: [],
    detect: (l) =>
      String(l.loadRosters ?? '').includes('auction') || l.auction_kind
        ? { on: true, reason: 'MFL roster loading includes an auction.' }
        : { on: false, reason: 'MFL loads rosters by draft only, with no auction.' },
  },
  {
    key: 'liveLineups',
    label: 'Lineup alerts',
    description: 'Push alert before kickoff when a starting slot is empty or illegal.',
    group: 'live',
    requires: ['pushNotifications'],
  },
  {
    key: 'playoffs',
    label: 'Playoffs',
    description:
      "Playoff brackets with live scores. The page and its nav link appear once the league's brackets are set up on MFL.",
    group: 'live',
    requires: [],
  },
  {
    key: 'franchisePages',
    label: 'Franchise pages',
    description:
      "A page per club: all-time record, single-game highlights, rivals, trade ledger and name history, built from every season MFL holds for the league.",
    group: 'community',
    requires: [],
    detect: (l) =>
      mflSeasonCount(l) > 1
        ? { on: true, reason: `MFL holds ${mflSeasonCount(l)} seasons of this league's history.` }
        : { on: true, reason: 'History builds up from this season on.' },
  },
  {
    key: 'liveScoring',
    label: 'Live scoring',
    description: 'The live scoreboard and broadcast board.',
    group: 'live',
    requires: [],
    detect: () => ({ on: true, reason: 'Every MFL league has a weekly scoreboard.' }),
  },
  {
    key: 'liveScoringSample',
    label: 'Offseason scoring replay',
    description: "Replays last season's final week on the scoreboard when no games are live.",
    group: 'live',
    requires: ['liveScoring'],
    detect: (l) =>
      mflSeasonCount(l) > 1
        ? null
        : { on: false, reason: 'First MFL season, so there is no past week to replay.' },
  },
  {
    key: 'powerRankings',
    label: 'Power rankings',
    description: 'The weekly Pecking Order power rankings.',
    group: 'news',
    requires: [],
  },
  {
    key: 'schefterFeed',
    label: 'News feed (Schefter)',
    description: 'AI beat reporter posts on trades, signings and weekly results.',
    group: 'news',
    requires: [],
  },
  {
    key: 'schefterTips',
    label: 'Tips & rumor mill',
    description: 'Anonymous tips and the rumor mill. Needs a GroupMe chat listener.',
    group: 'news',
    requires: ['schefterFeed'],
  },
  {
    key: 'rulesQa',
    label: 'Ask Roger (rules Q&A)',
    description:
      "A Rules page and Roger, the AI rules chatbot. Answers from the league's rulebook, falling back to its MFL settings.",
    group: 'news',
    requires: [],
  },
  {
    key: 'viewerPreferences',
    label: 'Viewer preferences',
    description: 'The /preferences page: country and clock per viewer.',
    group: 'community',
    requires: [],
  },
  {
    key: 'pushNotifications',
    label: 'Push notifications',
    description: 'The /notifications page and per-category push alerts.',
    group: 'community',
    requires: [],
  },
  {
    key: 'accounting',
    label: 'League accounting',
    description: "Read and write MFL's money ledger and run season payouts.",
    group: 'admin',
    requires: [],
  },
  {
    key: 'brandingEditor',
    label: 'Branding editor',
    description: 'Commissioner editor for team names, colors and logos.',
    group: 'admin',
    requires: [],
  },
];

export const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key);

/** @param {string} key */
export function getFeature(key) {
  return FEATURE_CATALOG.find((f) => f.key === key) ?? null;
}

/**
 * Every unmet prerequisite in a features object, as readable strings.
 * Empty array = valid.
 * @param {Record<string, boolean>} features
 */
export function featureDependencyErrors(features) {
  const errors = [];
  for (const f of FEATURE_CATALOG) {
    if (!features[f.key]) continue;
    for (const req of f.requires) {
      if (!features[req]) errors.push(`${f.key} requires ${req}`);
    }
  }
  return errors;
}
