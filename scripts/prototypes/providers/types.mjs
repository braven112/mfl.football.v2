/**
 * PROTOTYPE — the normalized shapes every league provider must return.
 *
 * The whole point of this file: nothing downstream (broadcast board, Schefter,
 * Pecking Order, Record Book) should ever know which platform a league lives
 * on. It asks for a `NormalizedLeague` and gets one.
 *
 * DESIGN RULES, each one load-bearing:
 *
 * 1. `playerId` is ALWAYS the canonical id (MFL's), never the provider's.
 *    Translation happens inside the adapter, at the boundary, exactly once.
 *    `docs/claude/rules/live-scoring.md` already records why a raw provider id
 *    must not escape: ids from different systems are all plain digits, so a
 *    bad join resolves a DIFFERENT PERSON rather than failing.
 *
 * 2. `teamId` is a STRING, always. MFL uses '0001'; Sleeper uses integer
 *    roster_ids. Normalizing to string stops `'0001' !== 1` bugs, and keeps
 *    MFL's leading zeros, which are significant.
 *
 * 3. Every object carries `provider` + `providerLeagueId`. A companion app
 *    serving one user across four platforms has no other way to tell two
 *    franchise 0001s apart — the same ambiguity CLAUDE.md already documents
 *    for the two leagues in this repo ("both leagues have a franchise 0001").
 *
 * 4. Anything a provider cannot answer is `null`, never 0 or ''. Sleeper has
 *    no salary cap; MFL has no `metadata.streak`. A zero that means "absent"
 *    is how a cap page renders $0 of room and an owner cuts a player.
 */

/** @typedef {'mfl'|'sleeper'|'espn'|'fleaflicker'} ProviderKind */

/**
 * @typedef {object} NormalizedLeague
 * @property {ProviderKind} provider
 * @property {string} providerLeagueId
 * @property {string} name
 * @property {number} season
 * @property {number} teamCount
 * @property {string[]} rosterPositions  starting slots, provider spelling preserved
 * @property {boolean|null} usesSalaries  null = provider cannot say
 */

/**
 * @typedef {object} NormalizedTeam
 * @property {string} teamId
 * @property {string} name
 * @property {string|null} ownerName
 * @property {string|null} ownerId
 * @property {string|null} logo
 */

/**
 * @typedef {object} NormalizedRoster
 * @property {string} teamId
 * @property {string[]} playerIds   canonical ids
 * @property {string[]} starterIds  canonical ids, in lineup order
 * @property {string[]} unmatched   provider ids the crosswalk could not resolve
 */

/**
 * @typedef {object} NormalizedMatchup
 * @property {number} week
 * @property {string} matchupId
 * @property {{ teamId: string, points: number|null }[]} sides
 */

/**
 * @typedef {object} NormalizedTransaction
 * @property {string} id
 * @property {'add'|'drop'|'trade'|'waiver'|'other'} type
 * @property {number|null} timestamp  epoch ms
 * @property {string[]} teamIds
 * @property {{ teamId: string, playerId: string }[]} adds
 * @property {{ teamId: string, playerId: string }[]} drops
 */

/**
 * Every adapter implements exactly this.
 * @typedef {object} LeagueProvider
 * @property {ProviderKind} kind
 * @property {(id: string) => Promise<NormalizedLeague>} getLeague
 * @property {(id: string) => Promise<NormalizedTeam[]>} getTeams
 * @property {(id: string) => Promise<NormalizedRoster[]>} getRosters
 * @property {(id: string, week: number) => Promise<NormalizedMatchup[]>} getMatchups
 * @property {(id: string, week: number) => Promise<NormalizedTransaction[]>} getTransactions
 */
export {};
