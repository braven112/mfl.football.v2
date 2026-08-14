/**
 * Ask Roger Redis key prefixes, per league.
 *
 * Lives in .mjs (not .ts) on purpose: the API endpoints import it as TypeScript
 * AND scripts/roger-improvement-notify.mjs imports it as plain node. Before
 * this file existed the endpoints owned the prefixes and any script that wanted
 * to read flags had to re-type the strings — a split source of truth where a
 * rename silently stops the notifier finding anything, with no test to catch it.
 *
 * Keyed by the registry slug from src/config/leagues-data.mjs, so adding a
 * league is one entry here plus one endpoint file.
 */

/**
 * @typedef {{
 *   answers: string,
 *   rateLimit: string,
 *   flags: string,
 *   label: string,
 *   seedFile: string,
 * }} RulesQAKeys
 */

/**
 * TheLeague's keys are the original unprefixed strings and MUST stay
 * byte-identical — `rules-qa:all` holds every stored answer since launch.
 * @type {Record<string, RulesQAKeys>}
 */
export const RULES_QA_KEYS = {
  theleague: {
    answers: 'rules-qa:all',
    rateLimit: 'rules-qa:rate',
    flags: 'rules-qa:flags',
    label: 'TheLeague',
    seedFile: 'rules-qa-seeds.json',
  },
  'afl-fantasy': {
    answers: 'afl-rules-qa:all',
    rateLimit: 'afl-rules-qa:rate',
    flags: 'afl-rules-qa:flags',
    label: 'AFL',
    seedFile: 'afl-rules-qa-seeds.json',
  },
};

/**
 * Where the seed cards live, relative to SEED_DIR. Stored as a bare basename,
 * not a full path: `src/data/afl-rules-qa-seeds.json` contains the substring
 * `data/afl`, which tests/league-literal-guard.test.ts forbids outside the
 * registry. Joining at the call site keeps the guard strict rather than
 * buying an allowlist exemption for what is really just a filename.
 */
export const SEED_DIR = 'src/data';

/** Every league that has an Ask Roger surface, as [slug, keys] pairs. */
export const ALL_RULES_QA_LEAGUES = Object.entries(RULES_QA_KEYS);
