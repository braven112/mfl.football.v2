/**
 * League archetypes: starting presets for the feature checkboxes.
 *
 * An archetype only decides which boxes start ticked. The registry entry stores
 * the archetype together with the league's final `features`, and code reads the
 * features, never the archetype. Each preset is modelled on a real league
 * (`example`). `tests/league-feature-catalog.test.ts` pins every example
 * league's features to its preset, so a preset cannot drift away from the
 * league it claims to copy without the test saying so.
 *
 * `standard-redraft` has no example yet. It is the AFL with the deluxe extras
 * removed, and the first such league launched should become its template.
 */

import { FEATURE_CATALOG, FEATURE_KEYS, featureDependencyErrors, getFeature } from './league-feature-catalog.mjs';

/**
 * @typedef {'dynasty-cap' | 'deluxe-keeper' | 'contest' | 'best-ball' | 'standard-redraft'} LeagueArchetype
 */

/**
 * @typedef {object} ArchetypePreset
 * @property {string} label
 * @property {string} description
 * @property {string | null} example  Registry slug of the league it models.
 * @property {Record<string, boolean>} features
 */

/** @type {Record<LeagueArchetype, ArchetypePreset>} */
export const ARCHETYPES = {
  'dynasty-cap': {
    label: 'Dynasty with salary cap',
    description: 'Contracts, cap, taxi squad and an offseason auction. Rosters carry over every year.',
    example: 'theleague',
    features: {
      contracts: true,
      salaryCap: true,
      keepers: false,
      powerRankings: true,
      liveLineups: true,
      schefterFeed: true,
      schefterTips: true,
      liveScoring: true,
      liveScoringSample: true,
      taxiSquad: true,
      offseasonAuction: true,
      accounting: true,
      viewerPreferences: true,
      pushNotifications: true,
      brandingEditor: false,
    },
  },
  'deluxe-keeper': {
    label: 'Deluxe keeper',
    description: 'Keepers plus the full premium set: conferences, news feed, tips, accounting.',
    example: 'afl-fantasy',
    features: {
      contracts: false,
      salaryCap: false,
      keepers: true,
      powerRankings: false,
      liveLineups: false,
      schefterFeed: true,
      schefterTips: true,
      liveScoring: true,
      liveScoringSample: true,
      taxiSquad: false,
      offseasonAuction: false,
      accounting: true,
      viewerPreferences: true,
      pushNotifications: true,
      brandingEditor: false,
    },
  },
  contest: {
    label: 'Large contest league',
    description: 'Many teams in divisions, with power rankings, a news feed and a slim nav.',
    example: 'archies',
    features: {
      contracts: false,
      salaryCap: false,
      keepers: false,
      powerRankings: true,
      liveLineups: false,
      schefterFeed: true,
      schefterTips: false,
      liveScoring: true,
      liveScoringSample: false,
      taxiSquad: false,
      offseasonAuction: false,
      accounting: false,
      viewerPreferences: false,
      pushNotifications: false,
      brandingEditor: true,
    },
  },
  'best-ball': {
    label: 'Best ball',
    description: 'Draft-only. No lineups, no add/drops; the draft and the scoreboard are the game.',
    example: 'best-ball-1',
    features: {
      contracts: false,
      salaryCap: false,
      keepers: false,
      powerRankings: false,
      liveLineups: false,
      schefterFeed: false,
      schefterTips: false,
      liveScoring: true,
      liveScoringSample: false,
      taxiSquad: false,
      offseasonAuction: false,
      accounting: false,
      viewerPreferences: false,
      pushNotifications: false,
      brandingEditor: false,
    },
  },
  'standard-redraft': {
    label: 'Standard redraft',
    description: 'Weekly lineups, waivers and standings. Fresh draft every year, no contracts or keepers.',
    example: null,
    features: {
      contracts: false,
      salaryCap: false,
      keepers: false,
      powerRankings: true,
      liveLineups: true,
      schefterFeed: true,
      schefterTips: false,
      liveScoring: true,
      liveScoringSample: true,
      taxiSquad: false,
      offseasonAuction: false,
      accounting: false,
      viewerPreferences: true,
      pushNotifications: true,
      brandingEditor: true,
    },
  },
};

export const ARCHETYPE_KEYS = /** @type {LeagueArchetype[]} */ (Object.keys(ARCHETYPES));

/** Franchise count at which a league reads as a contest rather than a home league. */
export const CONTEST_FRANCHISE_THRESHOLD = 40;

const asNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const yes = (v) => String(v ?? '').trim().toLowerCase() === 'yes' || String(v ?? '').trim() === '1';
const countOf = (block, key) => {
  if (!block) return 0;
  const v = block[key];
  return Array.isArray(v) ? v.length : v ? 1 : 0;
};

/**
 * Best-fit archetype for an MFL `TYPE=league` export, with a one-line reason.
 * Order matters: the first rule that fires wins.
 * @param {Record<string, any>} league
 * @returns {{ archetype: LeagueArchetype, reason: string }}
 */
export function detectArchetype(league) {
  const l = league ?? {};
  if (yes(l.bestLineup)) {
    return { archetype: 'best-ball', reason: 'MFL sets the best lineup automatically (best ball).' };
  }
  if (yes(l.usesContractYear) || (yes(l.usesSalaries) && asNum(l.salaryCapAmount) > 0)) {
    return { archetype: 'dynasty-cap', reason: 'MFL tracks contracts or a salary cap.' };
  }
  const teams = countOf(l.franchises, 'franchise') || asNum(l.franchises?.count);
  if (teams >= CONTEST_FRANCHISE_THRESHOLD || String(l.playerLimitUnit ?? '').toUpperCase() === 'DIVISION') {
    return {
      archetype: 'contest',
      reason: `${teams} teams${String(l.playerLimitUnit ?? '').toUpperCase() === 'DIVISION' ? ', players owned once per division' : ''}: a large contest league.`,
    };
  }
  if (asNum(l.maxKeepers) > 0 || String(l.keeperType ?? '').toLowerCase() === 'keeper') {
    return { archetype: 'deluxe-keeper', reason: 'MFL has keepers set.' };
  }
  return { archetype: 'standard-redraft', reason: 'No contracts, cap or keepers: a redraft league.' };
}

/**
 * @typedef {object} FeatureSuggestion
 * @property {boolean} on
 * @property {string} reason
 * @property {'mfl-setting' | 'preset' | 'ai' | 'dependency'} source
 */

/**
 * Pre-ticked checkboxes for a new league: the archetype's preset, overridden
 * wherever an MFL setting decides a feature, then with any feature whose
 * prerequisite ended up off switched off too.
 *
 * Pass `archetype` to re-preset from a type the user picked on the Launcher;
 * MFL-setting overrides still apply on top of it.
 *
 * @param {Record<string, any>} league  MFL `TYPE=league` export's `league` object.
 * @param {{ archetype?: LeagueArchetype }} [opts]
 */
export function suggestLeagueSetup(league, opts = {}) {
  const detected = detectArchetype(league);
  const archetype = opts.archetype ?? detected.archetype;
  const preset = ARCHETYPES[archetype];
  if (!preset) throw new Error(`Unknown archetype: ${archetype}`);

  /** @type {Record<string, FeatureSuggestion>} */
  const features = {};
  for (const f of FEATURE_CATALOG) {
    const hit = f.detect?.(league ?? {}) ?? null;
    features[f.key] = hit
      ? { on: hit.on, reason: hit.reason, source: 'mfl-setting' }
      : {
          on: preset.features[f.key],
          reason: `${preset.label} default.`,
          source: 'preset',
        };
  }

  settleDependencies(features);

  return {
    archetype,
    detectedArchetype: detected.archetype,
    archetypeReason: detected.reason,
    features,
  };
}

/**
 * Switch off every box whose prerequisite is off, in place, with a reason.
 * Repeats until stable so a chain (A needs B needs C) settles regardless of
 * catalog order. Used after the rules AND after any later change (the AI
 * review, a human override) so a saved selection is always valid.
 * @param {Record<string, FeatureSuggestion>} features
 */
export function settleDependencies(features) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of FEATURE_CATALOG) {
      if (!features[f.key]?.on) continue;
      const missing = f.requires.find((r) => !features[r]?.on);
      if (missing) {
        features[f.key] = {
          on: false,
          reason: `Needs ${getFeature(missing)?.label ?? missing}, which is off.`,
          source: 'dependency',
        };
        changed = true;
      }
    }
  }
  return features;
}

/**
 * Flatten a suggestion to the plain `features` object a registry entry stores.
 * @param {Record<string, { on: boolean }>} suggested
 */
export function toRegistryFeatures(suggested) {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, Boolean(suggested[k]?.on)]));
}

export { featureDependencyErrors };
