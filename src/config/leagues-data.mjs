/**
 * League registry — the single source of truth for every per-league constant.
 *
 * Plain .mjs so both the Astro app (via src/config/leagues.ts, which adds
 * types) and node cron scripts (import '../src/config/leagues-data.mjs') can use
 * it. Never hardcode a league id, slug, data path, or domain anywhere else —
 * look it up here. Adding a league = adding one entry to LEAGUES (plus DNS /
 * Vercel domain attachment for its apex domains).
 */

import { isDemoEnv } from '../utils/demo-isolation-core.mjs';

export const LEAGUES = {
  theleague: {
    /** MFL numeric league id */
    id: '13522',
    /** Canonical slug: path segment under src/pages/ and in URLs */
    slug: 'theleague',
    /**
     * Short slug used by nav config / styles. Every entry's navSlug carries a
     * JSDoc `const` cast so TypeScript reads the literal: `LeagueSlug`
     * (src/types/nav.ts) is DERIVED from these, so a new league needs no type edit.
     */
    navSlug: /** @type {const} */ ('theleague'),
    /**
     * Color theme — a file in src/themes/. Any league may name any theme;
     * a theme is complete on its own and never inherits from another.
     * Compiled by scripts/generate-league-themes.mjs.
     */
    theme: 'theleague',
    /**
     * Starting preset for the feature checkboxes (league-archetypes.mjs).
     * Code reads `features`, never this.
     */
    archetype: 'dynasty-cap',
    /**
     * Franchises that see admin-only nav links, receive ops alerts
     * (scripts/lib/ops-alert.mjs), and are treated as commissioners when MFL's
     * login did not say so (isCommissionerOrAdmin's fallback). League-scoped:
     * the same 4-digit id is a different team in each league.
     */
    adminFranchiseIds: ['0001', '0000'],
    /**
     * Schedule planner policy (src/utils/schedule-plan.mjs). The League ran
     * `simple` while the two modes were compared; constructive was adopted on
     * the numbers — bye spread 17 to 4 and home/away 7-11 to 9-9, neither of
     * which re-timing can reach, since moving rounds between weeks never
     * changes which side is home. `keepDivisionFinish` no longer applies in
     * this mode: the constructive week plan ends on division games by
     * construction. `mode: 'simple'` is still reachable per call for a
     * minimal in-season repair. A league without this field has no planner.
     */
    /**
     * Schefter scanners (scripts/lib/schefter-leagues.mjs): the events file,
     * the NAMES of the GroupMe env vars, and which lanes run. A league without
     * this block has no scanner. The unprefixed env names are TheLeague's by
     * history: they predate the AFL.
     */
    schefter: {
      eventsPath: 'src/data/theleague/resolved-events.json',
      env: {
        schefterBot: 'GROUPME_SCHEFTER_BOT_ID',
        rogerBot: 'GROUPME_ROGER_BOT_ID',
        groupId: 'GROUPME_GROUP_ID',
        rogerSender: 'GROUPME_ROGER_BOT_SENDER_ID',
      },
      lanes: {
        tradeBait: true,
        eventReminders: true,
        // Uses the rumor mill + big-drop flow for GroupMe; no direct posting in scanLeague.
        directGroupMe: false,
        tradeOfferRumors: true,
        groupmeListen: true,
        // Roger's clapback lane. AFL-first by request: the AFL drafts on the
        // Labor Day weekend, so its autodraft damage is days old and its owners
        // are the ones currently taking shots at Roger's countdowns. Flip this
        // on here once the AFL has run a season's worth of replies.
        rogerReplies: false,
      },
    },
    schedulePolicy: {
      mode: 'constructive',
      startWindow: [1, 2, 3, 4],
      endWindow: [12, 13, 14],
      doubleheaderCount: 4,
      keepDivisionFinish: true,
      crossConference: null,
    },
    name: 'The League',
    /** League mark: light cut for light grounds, dark cut for dark ones. */
    /** First season of the league's player archive (draft results notes it). */
    playerArchiveStartYear: 2007,
    logo: { light: '/assets/logos/theleague-logo.svg', dark: '/assets/logos/theleague-logo-dark.svg' },
    /** Schefter share-card branding (src/utils/schefter-og.ts). Absent = derived from name/domain/themeColor. */
    shareCard: { name: 'The League', domain: 'theleague.us', primary: '#1c497c' },
    /** MFL server hostname for this league */
    mflHost: 'www49.myfantasyleague.com',
    /** Repo-relative data directory written by the fetch pipelines */
    dataPath: 'data/theleague',
    /** Apex domains that serve this league (bare + www) */
    domains: ['theleague.us', 'www.theleague.us'],
    /**
     * The single canonical host for absolute URLs to this league (nav
     * cross-league switch links, admin article links, announcements). The
     * www variant matches what Vercel serves and what users browse; session
     * cookies are host-only, so every generated absolute URL must agree on
     * this host or logins appear to vanish across links. Use leagueOrigin()
     * — don't pick from `domains` ad hoc.
     */
    canonicalDomain: 'www.theleague.us',
    /**
     * Stable staging hostnames for this league. Deliberately SEPARATE from
     * `domains` — see the stagingDomains note above buildHostToSlugMap().
     */
    stagingDomains: ['staging.theleague.us'],
    /**
     * The path the custom-site demo serves this league's slot under —
     * demo.mfl.football/dynasty — where the demo build has replaced its data
     * with a fictional salary-cap dynasty league (docs/plans/custom-site-demo.md).
     */
    demoPath: 'dynasty',
    /**
     * Repo-relative league config + Schefter feed locations. TheLeague's
     * live under src/data (build-time imports); AFL's under its dataPath.
     * These are the single source of truth — consumers (article pipeline,
     * schedule-strength compute, schefter-scan) must read them from here,
     * not re-encode the paths.
     */
    configPath: 'src/data/theleague.config.json',
    schefterFeedPath: 'src/data/theleague/schefter-feed.json',
    /**
     * The Owners' Poll — the weekly owner vote that publishes inside The
     * Pecking Order. See docs/plans/owners-poll.md.
     *
     * `slots` is the ballot depth (rank your top N), NOT the field size, and
     * the two are deliberately independent: a 7-slot ballot in a 16-team
     * league leaves a tail the poll does not order, which is a stated design
     * trade rather than an oversight. It lives here rather than as a constant
     * because the AFL's 24-team field would want a different depth, and
     * because tests/league-literal-guard.test.ts is the thing that keeps a
     * number like this from being retyped into three modules.
     *
     * There is NO ballot minimum. Whatever ballots come in are the result —
     * a quorum used to gate the consensus, and all it achieved was suppressing
     * the poll on light weeks and spending the chat's one daily post saying so.
     *
     * `closeWeekday` / `closeHourPT` are when the ballot shuts (0=Sun).
     * THURSDAY, not Wednesday, and that is a turnout decision: setting a
     * lineup before the first kickoff is the one obligatory weekly action in
     * this league and it mostly happens Wed-Sun, so a Wednesday deadline
     * closed before the highest-traffic weekly action even began. The close is
     * additionally clamped to just before the real first kickoff, so a
     * Thanksgiving week (games at ~10:00 PT) cannot take votes after two games
     * have been played.
     */
    ownersPoll: {
      enabled: true,
      slots: 7,
      closeWeekday: 4,
      closeHourPT: 16,
    },
    /**
     * THE LEAGUE'S OFFICIAL CLOCK — the zone this league keeps its own time
     * in. Lineup locks, auction windows, waiver deadlines and the 8:45
     * rollover are all quoted in it, so it is the shared reference printed
     * beside whatever clock a viewer has chosen for themselves.
     *
     * It is a SETTING, not a constant: `viewer-preferences.ts` deliberately
     * does not import this registry (it is in Storybook's rendering graph —
     * see docs/claude/rules/viewer-preferences.md), so the clock is READ here
     * and passed in. `leagueClock(slug)` in src/config/leagues.ts is the
     * accessor; nothing should reach for `LEAGUE_CLOCK` when it knows its
     * league.
     *
     * `equivalents` is an IDENTITY list — zones that keep the same wall clock
     * as `zone` year-round, DST flips included — NOT a snapshot of today's
     * offsets. A viewer already on one of them is not shown the league clock
     * a second time, because "1:00 PM PT · 1:00 PM PT" helps nobody.
     */
    officialClock: {
      id: 'PT',
      zone: 'America/Los_Angeles',
      label: 'PT',
      name: "The league's clock (Pacific)",
      equivalents: ['America/Vancouver', 'America/Tijuana'],
    },
    /**
     * Trade deadline. A per-league constant, so it lives here rather than
     * inline in the code that needs it — `tradeDeadlineIsoDate(slug, year)` in
     * `src/utils/trade-deadline.mjs` is the only resolver.
     *
     * TheLeague's deadline is a FIXED calendar date (Nov 13), which is why it
     * carries no `rule`. It is duplicated today in `hero-resolver.ts`
     * (`isTradeDeadlineDay`) and `src/types/hero-state.ts` as a bare Nov 13 —
     * `tests/schefter-rumor-cadence.test.ts` pins the registry against
     * hero-resolver's copy so the two cannot silently disagree.
     */
    /**
     * The league chat the news persona posts into — see `chatConfigFor` in
     * scripts/lib/chat.mjs. Only env var NAMES live here, never a token.
     *   groupme: { provider, botEnv }                 bot id per league
     *   slack:   { provider, tokenEnv, channelEnv }   bot token + channel id
     * A league with no `chat` has no chat: its columns publish to the site and
     * push, and nothing is posted anywhere else.
     */
    chat: { provider: 'groupme', botEnv: 'GROUPME_SCHEFTER_BOT_ID' },
    tradeDeadline: { kind: 'fixed', month: 11, day: 13 },
    /**
     * League-minimum salary. Every player added to a roster carries at least
     * this — a first-come-first-served free-agent add included, which MFL
     * records with NO price on the transaction row. Read by anything that
     * prices a pickup (the waiver-pickups column once called two FCFS adds
     * "free assets for zero dollars"). Absent for a league with no salaries.
     */
    minimumSalary: 425_000,
    features: {
      contracts: true,
      salaryCap: true,
      keepers: false,
      powerRankings: true,
      rulesQa: true,
      playoffs: true,
      franchisePages: true,
      liveLineups: true,
      schefterFeed: true,
      schefterTips: true,
      liveScoring: true,
      liveScoringSample: true,
      /** Rookies only, cap of 3. */
      taxiSquad: true,
      offseasonAuction: true,
      accounting: true,
      viewerPreferences: true,
      pushNotifications: true,
      /** Branding is hand-curated here; the editor stays off until chosen. */
      brandingEditor: false,
    },
    /**
     * Prize table for the commissioner's accounting page, straight from the
     * constitution's PAYOUTS section. Amounts are DOLLARS OWED TO the winner —
     * the accounting writer converts them to MFL's sign convention, which is
     * not the same thing (see docs/claude/rules/accounting.md).
     *
     * `prizePool` is the constitution's stated total and exists ONLY so the
     * page can show plan-vs-pool and surface a drift. It is never used to
     * scale or cap a payout.
     */
    payouts: {
      prizePool: 712,
      prizes: [
        { key: 'champion', label: 'League Champion', amount: 300, source: { kind: 'placement', place: 1 } },
        { key: 'second', label: '2nd Place', amount: 150, source: { kind: 'placement', place: 2 } },
        { key: 'third', label: '3rd Place', amount: 100, source: { kind: 'placement', place: 3 } },
        { key: 'fourth', label: '4th Place', amount: 50, source: { kind: 'placement', place: 4 } },
        { key: 'fifth', label: '5th Place', amount: 45, source: { kind: 'placement', place: 5 } },
        { key: 'sixth', label: '6th Place', amount: 25, source: { kind: 'placement', place: 6 } },
        // $3 x 14 weeks. The WEEK COUNT is not a constant to trust blindly:
        // the planner pays whichever regular-season weeks actually have
        // scores, and `weeks` is the expected count it reconciles against.
        { key: 'weekly-high', label: 'Weekly High Score', amount: 3, source: { kind: 'weekly-high', weeks: 14 } },
      ],
    },
    // Contract dynasty league — long-horizon value is the right opening board.
    defaultRankingSources: ['fantasycalc', 'sharks', 'mfl-adp'],
    /**
     * Weeks that run Throwback Week — franchises wear a legacy identity from
     * their `history[]` era instead of their current one. Only TheLeague runs
     * it today; a league without the key simply never triggers it. Read by
     * `src/data/theleague/throwback-weeks.mjs` (the app's accessor) and by the
     * schedule-release lock, which reserves a marquee slot for the week.
     */
    throwbackWeeks: [4],
  },
  'afl-fantasy': {
    id: '19621',
    slug: 'afl-fantasy',
    navSlug: /** @type {const} */ ('afl'),
    theme: 'afl',
    archetype: 'deluxe-keeper',
    adminFranchiseIds: ['0001'],
    /** Schefter scanners — see TheLeague's entry for the shape. */
    schefter: {
      eventsPath: 'data/afl-fantasy/resolved-events.json',
      env: {
        schefterBot: 'GROUPME_AFL_SCHEFTER_BOT_ID',
        rogerBot: 'GROUPME_AFL_ROGER_BOT_ID',
        // The AFL's own group. Roger's reply lane no-ops with a warning until
        // it is set; his reminders are unaffected either way.
        groupId: 'GROUPME_AFL_GROUP_ID',
        rogerSender: 'GROUPME_AFL_ROGER_BOT_SENDER_ID',
      },
      lanes: {
        // Trade-block listings → rumor-mill tips; the scanner builds its
        // tips-queue keys from the league (schefter:afl:…).
        tradeBait: true,
        eventReminders: true,
        // Posts breaking/standard transactions directly to GroupMe from scanLeague.
        directGroupMe: true,
        // Deferred: needs MFL pendingOffer access and the duplicate-players
        // escalation model re-thought first.
        tradeOfferRumors: false,
        // Schefter's mention→tip ingest is still TheLeague-only (its Redis
        // keys are TheLeague-scoped).
        groupmeListen: false,
        // Roger answers the AFL first; independent of groupmeListen, since
        // Roger's lane keys off its own league-scoped prefix.
        rogerReplies: true,
      },
    },
    /** Schedule planner policy (src/utils/schedule-plan.mjs). */
    schedulePolicy: {
      mode: 'constructive',
      startWindow: [1, 2, 3, 4],
      endWindow: [12, 13, 14],
      doubleheaderCount: 3,
      keepDivisionFinish: false,
      crossConference: {
        week: 1,
        anchorYear: 2024,
        anchorPairing: [
          ['North', 'East'],
          ['South', 'West'],
        ],
        alternatePairing: [
          ['North', 'West'],
          ['South', 'East'],
        ],
        protectedRivalries: [['Computer Jocks', 'Jewpacabra']],
      },
    },
    name: 'AFL',
    /**
     * Push notification art (src/utils/push-notify-trade.ts). The badge must
     * be a white-on-transparent silhouette (Android tints its alpha); see
     * scripts/generate-notification-icons.mjs. Absent = the site's PWA art.
     */
    pushArt: { icon: '/assets/afl/favicons/favicon-192.png', badge: '/assets/afl/favicons/badge-96.png' },
    playerArchiveStartYear: 2003,
    /** Demo banner line (DemoBanner.astro), where the archetype's default does not fit. */
    demoPitch: 'The conference standings, tier tables and playoff brackets here were built for this league; your site is built around how yours works.',
    logo: { light: '/assets/logos/afl-logo.svg', dark: '/assets/logos/afl-logo-dark.svg' },
    shareCard: { name: 'AFL Fantasy', domain: 'afl-fantasy.com', primary: '#002244' },
    mflHost: 'www44.myfantasyleague.com',
    dataPath: 'data/afl-fantasy',
    domains: ['afl-fantasy.com', 'www.afl-fantasy.com'],
    /** See TheLeague entry — canonical host for absolute URLs. */
    canonicalDomain: 'www.afl-fantasy.com',
    /** See TheLeague entry — stable staging hostnames, never canonical. */
    stagingDomains: ['staging.afl-fantasy.com'],
    /** See TheLeague entry — single source of truth for these locations. */
    configPath: 'data/afl-fantasy/afl.config.json',
    schefterFeedPath: 'data/afl-fantasy/schefter-feed.json',
    /**
     * League-year rollover (month is 1-indexed). AFL flips to the new MFL
     * league year on June 1 — NOT TheLeague's Feb 14 date — because the new
     * AFL season isn't created on MFL until late spring. Consumed by
     * getAflLeagueYear() in src/utils/league-year.ts. Hard flip: on/after this
     * date AFL points at the new year regardless of whether the MFL league
     * exists yet, so the new league must be created on MFL by June 1.
     */
    leagueYearRollover: { month: 6, day: 1 },
    /**
     * AFL runs 24 franchises as duplicate-player conferences — the same NFL
     * player can be rostered by two franchises at once. Any logic that treats
     * "player is on some other roster" as meaningful (e.g. the cut-player
     * ownership preflight) must not draw conclusions from other franchises'
     * rosters in this league.
     */
    duplicatePlayers: true,
    /**
     * The Owners' Poll. See docs/plans/owners-poll.md; the shared machinery is
     * the same as TheLeague's and only these numbers differ.
     *
     * ONE 24-team ballot, not two conference-scoped ones. That fork was left
     * open when the poll shipped, and it is settled the way the column it
     * publishes inside already is: the AFL Pecking Order ranks all 24
     * franchises in a single list, so a conference-scoped poll would print a
     * consensus that disagrees with the machine ranking beside it on which
     * teams are even comparable. Duplicate players make cross-conference
     * comparison awkward to argue about, which is the entertainment, not a
     * defect.
     *
     * `slots` is 10, proportional to TheLeague's 7-of-16 rather than copied
     * from it — 7 of 24 would rank under a third of the field and leave most
     * of the league tied at zero. It stays well under the field size (the
     * unranked block is the design; see the plan's "One tension worth
     * naming").
     */
    ownersPoll: {
      enabled: true,
      slots: 10,
      closeWeekday: 4,
      closeHourPT: 16,
    },
    /**
     * THE LEAGUE'S OFFICIAL CLOCK — the zone this league keeps its own time
     * in. Lineup locks, auction windows, waiver deadlines and the 8:45
     * rollover are all quoted in it, so it is the shared reference printed
     * beside whatever clock a viewer has chosen for themselves.
     *
     * It is a SETTING, not a constant: `viewer-preferences.ts` deliberately
     * does not import this registry (it is in Storybook's rendering graph —
     * see docs/claude/rules/viewer-preferences.md), so the clock is READ here
     * and passed in. `leagueClock(slug)` in src/config/leagues.ts is the
     * accessor; nothing should reach for `LEAGUE_CLOCK` when it knows its
     * league.
     *
     * `equivalents` is an IDENTITY list — zones that keep the same wall clock
     * as `zone` year-round, DST flips included — NOT a snapshot of today's
     * offsets. A viewer already on one of them is not shown the league clock
     * a second time, because "1:00 PM PT · 1:00 PM PT" helps nobody.
     */
    officialClock: {
      id: 'PT',
      zone: 'America/Los_Angeles',
      label: 'PT',
      name: "The league's clock (Pacific)",
      equivalents: ['America/Vancouver', 'America/Tijuana'],
    },
    /**
     * Trade deadline — the Wednesday between Week 10 and Week 11, i.e.
     * kickoff + 10*7 - 1 days. Derived rather than fixed because it tracks
     * the NFL calendar; the same rule backs the `afl-trade-deadline` event in
     * `src/data/afl-fantasy/league-events.json`, and
     * `tests/schefter-rumor-cadence.test.ts` pins the two against each other.
     */
    /** League chat — see TheLeague's entry for the shape. */
    chat: { provider: 'groupme', botEnv: 'GROUPME_AFL_SCHEFTER_BOT_ID' },
    tradeDeadline: { kind: 'computed', rule: 'wednesday-between-week-10-and-11' },
    features: {
      contracts: false,
      salaryCap: false,
      keepers: true,
      /** The Pecking Order — published weekly (scripts/lib/league-jobs.mjs reads this). */
      powerRankings: true,
      rulesQa: true,
      playoffs: true,
      franchisePages: true,
      liveLineups: false,
      schefterFeed: true,
      schefterTips: true,
      liveScoring: true,
      liveScoringSample: true,
      /** The AFL has no practice squad — keepers are its off-roster mechanic. */
      taxiSquad: false,
      offseasonAuction: false,
      accounting: true,
      viewerPreferences: true,
      pushNotifications: true,
      /** Branding is hand-curated here; the editor stays off until chosen. */
      brandingEditor: false,
    },
    /**
     * AFL prize table (constitution PAYOUTS). The AFL pays for WINNING, and
     * almost every prize resolves off something the league already publishes.
     *
     * The playoff-side prizes are the subtle ones. The AFL has SIX divisions
     * but pays only FOUR division titles: each conference sends four teams —
     * its two best division winners (seeds 1-2) plus two wild cards (seeds
     * 3-4) — so a third division winner who misses the playoffs is not paid.
     * Both prizes therefore key off PLAYOFF SEED, not off a division-title
     * award slug: seeds 1-2 are the paid division champions, seeds 3-4 the
     * wild cards. Paying all six division slugs instead totals $2,525 against
     * a $2,220 pool; paying the four seeds totals $2,225, which is the pool
     * within the same rounding TheLeague's "approximately $712" carries.
     * Confirmed with the commissioner, Aug 2026 — do not "fix" this back to
     * six division awards.
     */
    payouts: {
      prizePool: 2220,
      prizes: [
        { key: 'afl-championship', label: 'League Championship', amount: 300, source: { kind: 'award', slug: 'afl-championship' } },
        { key: 'al-champion', label: 'AL Champion', amount: 150, source: { kind: 'award', slug: 'al-champion' } },
        { key: 'nl-champion', label: 'NL Champion', amount: 150, source: { kind: 'award', slug: 'nl-champion' } },
        // Seeds 1-2 in each conference bracket: the division winners who
        // actually reached the playoffs. Four paid, not six.
        { key: 'division-title', label: 'Division Championship', amount: 150, source: { kind: 'playoff-seed', seeds: [1, 2] } },
        // Seeds 3-4: the playoff teams that did not win a division.
        { key: 'wild-card', label: 'Wild Card', amount: 100, source: { kind: 'playoff-seed', seeds: [3, 4] } },
        { key: 'premier-league', label: 'Premier League Champion', amount: 225, source: { kind: 'tier-rank', tier: 'Premier League', rank: 1 } },
        { key: 'premier-league-2', label: 'Premier League 2nd', amount: 150, source: { kind: 'tier-rank', tier: 'Premier League', rank: 2 } },
        { key: 'premier-league-3', label: 'Premier League 3rd', amount: 100, source: { kind: 'tier-rank', tier: 'Premier League', rank: 3 } },
        { key: 'premier-league-4', label: 'Premier League 4th', amount: 50, source: { kind: 'tier-rank', tier: 'Premier League', rank: 4 } },
        { key: 'dleague-champion', label: 'D-League Champion', amount: 50, source: { kind: 'tier-rank', tier: 'D-League', rank: 1 } },
        { key: 'nit', label: 'NIT Champion', amount: 50, source: { kind: 'award', slug: 'nit' } },
      ],
    },
    // Keeper league that re-drafts most of the roster every year, so the
    // defaults lean redraft/ADP. FantasyCalc dynasty stays AVAILABLE, just
    // not on by default — it overrates youth for a one-season horizon.
    defaultRankingSources: ['mfl-adp', 'espn', 'sharks'],
    /**
     * Week 8, deliberately NOT TheLeague's Week 4 — the two leagues share
     * owners and a site, so spacing the events apart gives each its own
     * moment instead of one crowded weekend.
     *
     * Week 8 is also a plain 12-matchup slate. The AFL plays doubleheaders in
     * weeks 1, 2 and one LATE week that moves year to year (12 in 2023/2026,
     * 13 in 2024/2025) — picking one of those would have made the throwback
     * week a derived value rather than a constant, with the same
     * copy-last-year's-number trap `schedule-optimization.md` documents.
     */
    throwbackWeeks: [8],
  },
  'best-ball-1': {
    id: '37610',
    slug: 'best-ball-1',
    navSlug: /** @type {const} */ ('bb1'),
    theme: 'bb1',
    archetype: 'best-ball',
    adminFranchiseIds: ['0001', '0000'],
    name: 'Best Ball #1',
    logo: { light: '/assets/logos/bestball-logo.svg', dark: '/assets/logos/bestball-logo-dark.svg' },
    mflHost: 'www45.myfantasyleague.com',
    dataPath: 'data/best-ball-1',
    /**
     * The custom-site demo serves a fictional best-ball league in this slot at
     * demo.mfl.football/redraft (docs/plans/custom-site-demo.md, phase 4).
     */
    demoPath: 'redraft',
    /**
     * Path-only league: served at /best-ball-1 on the site's own domains
     * (mfl.football), no dedicated apex. Best-ball sister leagues
     * (#2, #3, …) will follow the same pattern.
     */
    domains: [],
    /**
     * Empty for the same reason `domains` is: bb1 is reachable only under a
     * path prefix on the SHARED host, so its staging host is the shared
     * host's own (staging.mfl.football) and must NOT map to a slug — a shared
     * host that resolves to one league would rewrite every other league's
     * paths under it.
     */
    stagingDomains: [],
    configPath: 'data/best-ball-1/bb1.config.json',
    schefterFeedPath: 'data/best-ball-1/schefter-feed.json',
    /**
     * Best-ball leagues are re-created on MFL each summer ahead of the
     * startup draft, so the league year rolls with the new-league
     * creation window (same clock as AFL), not TheLeague's Feb 14.
     */
    leagueYearRollover: { month: 6, day: 1 },
    /**
     * Draft-only best-ball league: the startup draft is the whole game.
     * No lineups, no add/drops, no in-season roster management — UI that
     * offers any of those must be skipped for leagues with this flag.
     */
    bestBall: true,
    /**
     * No Owners' Poll here, and not because nobody got to it: the poll ranks
     * TEAMS week to week, and a best-ball league has no weekly team story to
     * rank — no lineups, no in-season management, and it is draft-only
     * (docs/claude/rules/best-ball.md). The entry exists disabled so the shape
     * is present everywhere and shared components never branch on undefined.
     */
    ownersPoll: { enabled: false, slots: 0, closeWeekday: 4, closeHourPT: 16 },
    /**
     * THE LEAGUE'S OFFICIAL CLOCK — the zone this league keeps its own time
     * in. Lineup locks, auction windows, waiver deadlines and the 8:45
     * rollover are all quoted in it, so it is the shared reference printed
     * beside whatever clock a viewer has chosen for themselves.
     *
     * It is a SETTING, not a constant: `viewer-preferences.ts` deliberately
     * does not import this registry (it is in Storybook's rendering graph —
     * see docs/claude/rules/viewer-preferences.md), so the clock is READ here
     * and passed in. `leagueClock(slug)` in src/config/leagues.ts is the
     * accessor; nothing should reach for `LEAGUE_CLOCK` when it knows its
     * league.
     *
     * `equivalents` is an IDENTITY list — zones that keep the same wall clock
     * as `zone` year-round, DST flips included — NOT a snapshot of today's
     * offsets. A viewer already on one of them is not shown the league clock
     * a second time, because "1:00 PM PT · 1:00 PM PT" helps nobody.
     */
    officialClock: {
      id: 'PT',
      zone: 'America/Los_Angeles',
      label: 'PT',
      name: "The league's clock (Pacific)",
      equivalents: ['America/Vancouver', 'America/Tijuana'],
    },
    /**
     * Best Ball is draft-only — no in-season roster management, so there is
     * no trade deadline to keep. `null` is the honest answer and callers must
     * handle it; `tradeDeadlineIsoDate` returns null rather than inventing a date.
     */
    tradeDeadline: null,
    features: {
      contracts: false,
      salaryCap: false,
      keepers: false,
      powerRankings: false,
      rulesQa: false,
      playoffs: false,
      franchisePages: false,
      liveLineups: false,
      schefterFeed: false,
      schefterTips: false,
      /**
       * Results-shaped, not management-shaped — with no lineups to set,
       * scoreboard watching is the whole in-season experience here.
       */
      liveScoring: true,
      /**
       * No season to replay. The bundled sample is another league's teams, so
       * the board's own empty state is the honest answer out of season here.
       */
      liveScoringSample: false,
      /** Draft-only: no roster management at all, so nothing to park. */
      taxiSquad: false,
      /** Draft-only: nothing is acquired here after the draft. */
      offseasonAuction: false,
      /**
       * Draft-only league: no MFL syncing, no commissioner write path, and no
       * prize table in its rules. Turning this on would make the accounting
       * page the FIRST write into bb1's MFL league — don't, without deciding
       * that separately.
       */
      accounting: false,
      viewerPreferences: false,
      pushNotifications: false,
      /** Branding is hand-curated here; the editor stays off until chosen. */
      brandingEditor: false,
    },
    // Redraft best-ball: one season, no keepers, no contracts — straight
    // redraft ADP is exactly the right opening board.
    defaultRankingSources: ['mfl-adp', 'espn', 'sharks'],
  },
  /**
   * Archie's Fantasy Football League — the first league on the standard custom
   * package (docs/plans/league-chat-and-persona.md). 99 franchises in 9
   * divisions, and every division is its OWN player pool
   * (`playerLimitUnit: DIVISION`): the same player can be rostered once per
   * division. Anything roster-, free-agent- or ownership-shaped must be keyed
   * by division, the AFL's two-conference split generalized to N pools.
   *
   * Redraft (no salaries, contracts or keepers), head-to-head with victory
   * points. Its chat is Slack, and the only thing posted there is the weekly
   * strength-of-schedule column, The Gauntlet.
   */
  archies: {
    id: '10105',
    slug: 'archies',
    navSlug: /** @type {const} */ ('archies'),
    theme: 'archies',
    archetype: 'contest',
    adminFranchiseIds: [],
    name: "Archie's Fantasy Football League",
    mflHost: 'www48.myfantasyleague.com',
    dataPath: 'data/archies',
    /** Path-only on the shared host (mfl.football/archies), like Best Ball #1. */
    domains: [],
    /**
     * Served at /archies but NOT listed on the mfl.football front door until
     * the site owner decides a client league should be advertised there.
     */
    advertiseOnSharedHost: false,
    /**
     * Nav is OPT-IN, like Best Ball's: only links tagged `leagueOnly: archies`
     * render (src/utils/nav-utils.ts), because the default link set is pages
     * this league does not have yet.
     */
    optInNav: true,
    /** Pages come from the package-league set, entitled by `features` (package-league-routes.mjs). */
    pageKit: 'package',
    /** Short display name for the site header (the full name is too long there). */
    shortName: "Archie's",
    /**
     * The league's mark (Archie's head), read by the shared header and layout.
     * The art is outlined, so the light and dark cuts are deliberately the
     * same file. Both are still set: every league names both. Resized from the
     * league's own MFL skin art in public/mfl/10105/.
     */
    logo: { light: '/assets/logos/archies-head.webp', dark: '/assets/logos/archies-head.webp' },
    shareCard: { name: "Archie's FFL", domain: 'mfl.football/archies', primary: '#1d3a6e' },
    /** The share-card mark: the OG renderer reads PNG/SVG only, not WebP. */
    logoOg: '/assets/logos/archies-head.png',
    /**
     * Weekly Schefter article types this league gets (scripts/lib/article-leagues.mjs).
     * Absent = every type. Archie's has bought The Gauntlet only.
     */
    articleTypes: ['schedule-strength'],
    /**
     * Wordmark shown beside the mark in the header and homepage hero, in place
     * of the text short name.
     */
    wordmark: '/assets/logos/archies-wordmark.webp',
    /** Browser chrome colour (the mark's navy). */
    themeColor: '#1d3a6e',
    /** Empty for the same reason as Best Ball #1's — see that entry. */
    stagingDomains: [],
    configPath: 'data/archies/archies.config.json',
    schefterFeedPath: 'data/archies/schefter-feed.json',
    /** Redraft league re-created on MFL over the summer — the AFL's clock. */
    leagueYearRollover: { month: 6, day: 1 },
    /**
     * MFL reassigns this league's franchise ids between seasons (33 of 99
     * current teams moved between 2021 and 2026), so an id is not an identity.
     * Current teams follow themselves through `ownerHistory` (derived by
     * scripts/derive-owner-history.mjs); departed teams' seasons are grouped
     * by team NAME across ids in owner-tenures rather than per id.
     */
    renumbersFranchises: true,
    /** No poll at launch; the shape is present so shared code never branches on undefined. */
    ownersPoll: { enabled: false, slots: 0, closeWeekday: 4, closeHourPT: 16 },
    /**
     * The Pecking Order at 99 teams: every team is ranked, but the column
     * writes up only the top 25; the rest show in their division lists
     * (scripts/generate-pecking-order.mjs, PeckingOrderIssue.astro).
     */
    peckingOrder: { topN: 25 },
    /**
     * MAD POWER 99 — the league's playoff seeding (bylaws: 9 division
     * champions + 21 wild cards, 30 in). The 21 are each division's
     * runner-up plus 12 more, as the league's own MFL widget seeds them
     * (public/mfl/10105/standings.js, DECISIONS.md D2-D6). Every tier is in
     * MFL's row order, which the league sorts on Victory Points, then points,
     * then head-to-head.
     */
    standingsSeeding: { kind: 'mad', divisionLeaders: 9, runnersUp: 9, wildCards: 12 },
    /**
     * MFL `playerLimitUnit: DIVISION`: each of the nine divisions is its own
     * player pool, so the same player is routinely on up to nine rosters at
     * once. "On another roster" proves nothing here (cut-player's preflight),
     * and pool-aware code keys by division (buildPoolStructure,
     * poolOfFranchise).
     */
    duplicatePlayers: true,
    /**
     * TODO(commissioner): the league's own time zone is not confirmed yet.
     * Pacific is the site default and changes nothing for a viewer who has
     * picked their own clock.
     */
    officialClock: {
      id: 'PT',
      zone: 'America/Los_Angeles',
      label: 'PT',
      name: "The league's clock (Pacific)",
      equivalents: ['America/Vancouver', 'America/Tijuana'],
    },
    /** Slack only. Secrets are set per environment; see the plan doc's setup section. */
    chat: { provider: 'slack', tokenEnv: 'SLACK_ARCHIES_BOT_TOKEN', channelEnv: 'SLACK_ARCHIES_CHANNEL_ID' },
    /**
     * TODO(commissioner): the trade deadline is not confirmed. `null` means
     * "no deadline known" — callers already handle it, and inventing a date
     * would put a wrong one in front of 99 owners.
     */
    tradeDeadline: null,
    /**
     * Every flag set on purpose. Launch surfaces: homepage (with
     * transactions), news + The Gauntlet, standings, rosters + team pages.
     */
    features: {
      contracts: false,
      salaryCap: false,
      keepers: false,
      /** The Pecking Order, Tuesdays (top 25 + divisions; announced in Slack). */
      powerRankings: true,
      rulesQa: false,
      playoffs: false,
      franchisePages: true,
      liveLineups: false,
      /** The news feed carries The Gauntlet. */
      schefterFeed: true,
      /** No tips / rumor mill: that lane is built on the GroupMe listener. */
      schefterTips: false,
      /**
       * The shared board (/archies/live-scoring) and /archies/broadcast. MFL
       * serves this league's liveScoring in the FLAT shape (no pairings), so
       * `loadLiveScoringPayload` pairs it from the committed schedule; 99
       * matchups a week is why the board grows a division picker here.
       */
      liveScoring: true,
      /**
       * No offseason replay: the bundled sample is another league's teams,
       * and the board's own empty state is the honest answer out of season
       * (Best Ball #1's reasoning).
       */
      liveScoringSample: false,
      taxiSquad: false,
      offseasonAuction: false,
      accounting: false,
      viewerPreferences: false,
      pushNotifications: false,
      /**
       * Commissioner branding editor (/archies/admin/branding): names, colours
       * and uploaded marks, published through .github/workflows/branding-edit.yml.
       */
      brandingEditor: true,
    },
    defaultRankingSources: ['mfl-adp', 'espn', 'sharks'],
  },
};

/**
 * The custom-site demo's one host. Each demo league lives under its registry
 * `demoPath` on it (demo.mfl.football/dynasty), never on a subdomain of its own.
 */
export const DEMO_HOST = 'demo.mfl.football';

/** Nav link ids the demo's keeper slot renders (see its `navLinks`). */
const KEEPER_NAV_LINKS = ['submit-lineup', 'standings', 'afl-players', 'rosters', 'afl-keepers', 'front-office'];

/**
 * Nav link ids the demo's big league renders — the AFL slot's core pages for a
 * redraft league (no keepers, no AL/NL draft order, no constitution).
 */
const BIGLEAGUE_NAV_LINKS = ['submit-lineup', 'standings', 'afl-players', 'rosters', 'playoffs', 'live-scoring', 'front-office'];

/**
 * demoPath → route slug for every league the demo serves (dynasty →
 * theleague). Later demo types add a `demoPath` to their slot's entry —
 * `bigleague` for the conference league, `redraft` for best ball.
 */
export function demoLeaguePaths() {
  return Object.fromEntries(ALL_LEAGUES.filter((l) => l.demoPath).map((l) => [l.demoPath, l.slug]));
}

/**
 * The custom-site demo (docs/plans/custom-site-demo.md) renders a fictional
 * league in TheLeague's slot; its build replaced this league's data, so its
 * name goes too. Applied once at module load: the demo is a whole deployment,
 * so this never varies within a process.
 */
if (isDemoEnv()) {
  LEAGUES.theleague.name = 'The Demo League';
  // The fourth slot (docs/plans/custom-site-demo.md, phase 4): a fictional
  // keeper league — no salary cap, no contracts — at demo.mfl.football/keeper.
  // It exists ONLY on a demo deployment. Production's crons, push senders and
  // sync scripts enumerate this registry; a league they could see here is one
  // they would poll MFL for. Its pages are the AFL's, shared as components.
  LEAGUES.keeper = {
    id: '99002',
    slug: 'keeper',
    navSlug: /** @type {const} */ ('keeper'),
    /** Wears the AFL's theme — reuse by naming it, not by sharing a selector. */
    theme: 'afl',
    archetype: 'deluxe-keeper',
    adminFranchiseIds: [],
    /**
     * Only these nav links render here — the keeper slot has the AFL's core
     * pages, not all of them, and an untagged link to one it lacks is a 404.
     */
    navLinks: KEEPER_NAV_LINKS,
    name: 'The Keeper League',
    logo: { light: '/assets/logos/keeper-logo.svg', dark: '/assets/logos/keeper-logo-dark.svg' },
    mflHost: LEAGUES['afl-fantasy'].mflHost,
    dataPath: 'data/keeper',
    demoPath: 'keeper',
    domains: [],
    stagingDomains: [],
    configPath: 'data/keeper/keeper.config.json',
    schefterFeedPath: 'data/keeper/schefter-feed.json',
    leagueYearRollover: LEAGUES['afl-fantasy'].leagueYearRollover,
    ownersPoll: { enabled: false, slots: 0, closeWeekday: 4, closeHourPT: 16 },
    officialClock: LEAGUES['afl-fantasy'].officialClock,
    tradeDeadline: LEAGUES['afl-fantasy'].tradeDeadline,
    features: {
      ...LEAGUES['afl-fantasy'].features,
      schefterFeed: false,
      schefterTips: false,
      // No live scoring page in this slot: on, the homepage hero's game-day
      // card linked one that 404s.
      liveScoring: false,
      liveScoringSample: false,
      accounting: false,
      pushNotifications: false,
    },
    defaultRankingSources: LEAGUES['afl-fantasy'].defaultRankingSources,
  };
  // The AFL's slot serves the fictional 96-team big league at
  // demo.mfl.football/bigleague: eight conferences, three tiers, redraft. Set
  // after the keeper slot above, which copies the AFL's own features.
  const afl = LEAGUES['afl-fantasy'];
  afl.name = 'The Big League';
  afl.demoPath = 'bigleague';
  afl.navLinks = BIGLEAGUE_NAV_LINKS;
  afl.features = {
    ...afl.features,
    keepers: false,
    schefterFeed: false,
    schefterTips: false,
    liveScoringSample: false,
    accounting: false,
    pushNotifications: false,
  };
  afl.ownersPoll = { ...afl.ownersPoll, enabled: false };
}

export const DEFAULT_LEAGUE_SLUG = 'theleague';

export const ALL_LEAGUES = Object.values(LEAGUES);

/** MFL numeric id of the default league. Use instead of hardcoding '13522'. */
export const DEFAULT_LEAGUE_ID = LEAGUES[DEFAULT_LEAGUE_SLUG].id;

/**
 * MFL leagues that are NOT registered here but whose owners may still sign in
 * to MFL Live on the shared host, as invited testers.
 *
 * Deliberately NOT registry entries. They have no pages, no data directory and
 * no feature flags. The only thing being added is permission to sign in to
 * `/live`, and a registry entry would give a league the whole site.
 *
 * 10105 tested the board here from Sep 2026 until it became a registered
 * league (`archies`), whose owners sign in as any registered league's do.
 */
export const MFL_LIVE_PILOT_LEAGUE_IDS = [];

/**
 * OPEN SIGN-IN for MFL Live: when true, an owner of ANY MyFantasyLeague league
 * may sign in on the shared host's /login, not just owners of the leagues
 * above. Off until the live data feed is licensed (the business plan's
 * "Before selling" list) — flipping it is the launch of Owner Suite's free
 * tier.
 *
 * A session for a league outside the registry is MFL-Live-ONLY, and that is
 * enforced by the league id itself, not by a claim: `getAuthUser` refuses any
 * league outside the registry and the pilot list, so every endpoint outside
 * /live treats such a visitor as signed out. Only `getMflLiveUser`
 * (src/utils/auth.ts), used by the /live pages and their APIs, accepts one —
 * and always as a plain owner, whatever MFL's commissioner cookie said.
 */
export const MFL_LIVE_OPEN_SIGN_IN = false;

/**
 * Every MFL league id whose owners may sign in to MFL Live, in PREFERENCE
 * order: the registry's leagues in registry order, then the pilot leagues.
 *
 * The order matters. An account in several of these gets a session scoped to
 * the FIRST one it belongs to, so an owner of TheLeague keeps the TheLeague
 * session they had before this list existed, and a pilot league is only ever
 * the session's league for someone in no registered league. The board reads
 * every league from `myleagues` whichever league the session names.
 *
 * @returns {string[]}
 */
export function mflLiveSignInLeagueIds() {
  return [...ALL_LEAGUES.map((l) => l.id), ...MFL_LIVE_PILOT_LEAGUE_IDS];
}

/** @param {string} slug Canonical slug ('theleague' | 'afl-fantasy') */
export function getLeagueBySlug(slug) {
  return LEAGUES[slug] ?? null;
}

/** @param {string} id MFL numeric league id */
export function getLeagueById(id) {
  return ALL_LEAGUES.find((l) => l.id === id) ?? null;
}

/**
 * Resolve a URL pathname to its league (e.g. '/afl-fantasy/rosters').
 * Falls back to the default league for unprefixed paths.
 * @param {string} pathname
 */
export function getLeagueByPath(pathname) {
  for (const league of ALL_LEAGUES) {
    if (pathname === `/${league.slug}` || pathname.startsWith(`/${league.slug}/`)) {
      return league;
    }
  }
  return LEAGUES[DEFAULT_LEAGUE_SLUG];
}

/**
 * Default host for MFL COMMISSIONER WRITES, honoring the MFL_WRITE_HOST env
 * override. Commissioner imports fail on the api.myfantasyleague.com
 * gateway — they must go to the league's own web host. Shared by
 * mfl-contract-writer.ts, apply-pending-contracts.mjs, and
 * sync-draft-pick-contracts.mjs so the invariant lives in one place.
 *
 * @param {Record<string, string | undefined>} [env] Defaults to process.env.
 */
export function defaultMflWriteHost(env = process.env) {
  return env.MFL_WRITE_HOST || `https://${LEAGUES[DEFAULT_LEAGUE_SLUG].mflHost}`;
}

/**
 * The shared app host that serves every league under its path prefix
 * (/theleague/*, /afl-fantasy/*). Fallback target for absolute cross-league
 * URLs when a league has no apex domain of its own.
 *
 * This is v2, not the apex, and that is deliberate as of Sep 2026. The apex
 * `mfl.football` still answers 406 — it is being pointed at Vercel on its own
 * schedule, expected to take months — and this constant is not decoration:
 * it is the ONLY origin Best Ball #1 has (`domains: []`), so it is what every
 * absolute bb1 link, the league-switcher fallback and any GroupMe message
 * built by `leagueUrl` resolve to. Pointed at a host that 406s, those are
 * dead links in owners' chat clients, not a cosmetic inaccuracy.
 *
 * Flip this back to the apex once it serves, and delete nothing else — the
 * apex stays in SHARED_APP_HOSTS below either way, so both hosts behave
 * correctly through the switch and the flip is a one-line change.
 */
export const SHARED_APP_ORIGIN = 'https://v2.mfl.football';

/**
 * Every hostname that serves the shared app — production and its staging
 * twin. These belong to NO league: they serve all of them by path prefix, so
 * no single league's identity (PWA manifest, canonical origin) belongs on
 * one, and they must never appear in HOST_TO_SLUG or they would rewrite every
 * other league's paths under whichever slug they mapped to.
 *
 * A list rather than a comparison against SHARED_APP_ORIGIN alone: an exact
 * compare recognises production and silently misses staging.mfl.football,
 * which then behaves like a league's own host on the one site whose whole job
 * is to reproduce production. v2.mfl.football is the third case and the one
 * that proves the point — it is where the app actually serves today, it is
 * NOT the canonical origin, and an origin-derived check misses it entirely.
 *
 * Membership here is decided by ONE question: does this hostname serve every
 * league under a path prefix? Not "is it canonical", not "is it production".
 * v2 answers yes (/theleague and /afl-fantasy both resolve on it), so a
 * single league's PWA identity must not be served there, regardless of what
 * SHARED_APP_ORIGIN says.
 */
const SHARED_APP_HOSTS = ['mfl.football', 'v2.mfl.football', 'staging.mfl.football'];

/**
 * Is this hostname the shared multi-league app host (either environment)?
 *
 * @param {string} hostname
 */
export function isSharedAppHost(hostname) {
  return SHARED_APP_HOSTS.includes(hostname);
}

/**
 * Does this league live somewhere OTHER than the shared host?
 *
 * A league with an apex of its own (theleague.us, afl-fantasy.com) has a real
 * front door, so the shared host is a second, unwanted one for it. A league
 * with `domains: []` — Best Ball #1, and every best-ball sister after it —
 * has NO other address: the shared host's path prefix is the only place it
 * exists, so hiding it there would delete it from the internet.
 *
 * That is why this is DERIVED from `domains` rather than a list of two slugs.
 * A hardcoded ['theleague', 'afl-fantasy'] would silently hide best-ball #2
 * the day it is given an apex, and silently expose a fourth full league the
 * day one is added without anyone remembering this file.
 *
 * @param {{ domains?: string[] }} league Registry entry.
 */
export function leagueHasOwnFrontDoor(league) {
  return (league.domains?.length ?? 0) > 0;
}

/**
 * The league whose pages must NOT be served at this hostname + path, or null.
 *
 * `mfl.football` and `v2.mfl.football` are the MFL app: MFL Live, the splash,
 * sign-in, and the path-only leagues. They are deliberately NOT a second way
 * into TheLeague or the AFL — those have their own domains, and a league
 * reachable at two addresses is two sets of links, two things to index and two
 * places to keep an owner signed in.
 *
 * Returns the league so the caller can say WHICH one, not just that something
 * is hidden. Matches the prefix exactly or as a path segment, so `/theleague`
 * and `/theleague/rosters` are hidden while a future `/theleague-archive`
 * would not be caught by accident.
 *
 * @param {string} hostname
 * @param {string} pathname
 * @returns {object | null}
 */
export function resolveSharedHostHiddenLeague(hostname, pathname) {
  if (!isSharedAppHost(hostname)) return null;
  for (const league of ALL_LEAGUES) {
    if (!leagueHasOwnFrontDoor(league)) continue;
    const prefix = `/${league.slug}`;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return league;
  }
  return null;
}

/**
 * The shared host's staging twin. Named separately from SHARED_APP_HOSTS
 * because that list answers "is this the multi-league host?" (either
 * environment) while this answers "is this a staging host?" — two different
 * questions that happen to share an entry.
 */
const SHARED_APP_STAGING_HOST = 'staging.mfl.football';

/**
 * Every staging hostname the site answers on: each league's `stagingDomains`
 * plus the shared host's staging twin.
 *
 * Derived, never a second hand-maintained list — a staging host that exists in
 * Vercel but not here is a host the write guard does not recognise, which is
 * the failure this whole mechanism exists to prevent.
 *
 * @returns {string[]}
 */
export function stagingHosts() {
  const hosts = [SHARED_APP_STAGING_HOST];
  for (const league of ALL_LEAGUES) {
    hosts.push(...(league.stagingDomains ?? []));
  }
  return hosts;
}

/**
 * Is this hostname one of the staging sites?
 *
 * Used for the things that are decided by WHERE the viewer is — the noindex
 * header and the staging banner. It is deliberately NOT the whole story for
 * blocking outbound writes: see isNonProductionDeploy() in
 * src/utils/deploy-environment.ts for why that question is answered by the
 * deployment rather than the host.
 *
 * @param {string} hostname
 */
export function isStagingHost(hostname) {
  return stagingHosts().includes(hostname);
}

/**
 * Canonical absolute origin for a league (e.g. 'https://www.theleague.us'),
 * or null when the league has no apex domain. THE way to build absolute
 * URLs to a league — session cookies are host-only, so every producer of
 * absolute league URLs (nav switch links, admin article links, GroupMe
 * announcements, OG tags) must agree on one host per league.
 *
 * @param {{ canonicalDomain?: string, domains?: string[] }} league Registry entry.
 */
export function leagueOrigin(league) {
  const domain =
    league.canonicalDomain ??
    league.domains?.find((d) => d.startsWith('www.')) ??
    league.domains?.[0];
  return domain ? `https://${domain}` : null;
}

/**
 * Strip a league's OWN path prefix from an internal path.
 *
 * Internal routes are stored prefixed (`/theleague/calendar`) because that's
 * the real Astro route and the only form that works on the shared host. On the
 * league's apex domain the prefix is redundant — middleware rewrites `/calendar`
 * and vercel.json 301s `/theleague/calendar` back to it — so an absolute link
 * built by naive concatenation reads `https://www.theleague.us/theleague/calendar`
 * and costs a redirect hop.
 *
 * Only the league's own slug is stripped: a cross-league link
 * (`/afl-fantasy/...` in a TheLeague post) must keep its prefix to resolve.
 *
 * @param {{ slug: string }} league Registry entry.
 * @param {string} path Internal path, with or without the prefix.
 */
export function stripLeaguePrefix(league, path) {
  const prefix = `/${league.slug}`;
  if (path === prefix) return '/';
  if (!path.startsWith(prefix)) return path;
  const rest = path.slice(prefix.length);
  // Boundary-checked so `/theleague-foo` isn't mangled mid-segment.
  if (!/^[/?#]/.test(rest)) return path;
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/** True when `path` already starts with SOME league's slug prefix. */
function hasAnyLeaguePrefix(path) {
  return ALL_LEAGUES.some((l) => stripLeaguePrefix(l, path) !== path);
}

/**
 * The mirror of stripLeaguePrefix: guarantee a league-local path carries its
 * prefix, which is what routes on the SHARED host (mfl.football) — the only
 * place a league without its own apex domain is reachable.
 *
 * A path already prefixed for ANY league is returned untouched, so a
 * cross-league link never gets double-prefixed onto the wrong league.
 *
 * @param {{ slug: string }} league Registry entry.
 * @param {string} path Internal path, with or without the prefix.
 */
export function ensureLeaguePrefix(league, path) {
  if (hasAnyLeaguePrefix(path)) return path;
  return path === '/' ? `/${league.slug}` : `/${league.slug}${path}`;
}

/**
 * THE way to build an absolute URL to a page for a league — canonical host
 * (see leagueOrigin) plus the path in whichever form that host actually routes.
 * Never concatenate an origin and a path by hand.
 *
 * Total in both directions, so callers don't have to know which kind of league
 * they hold: on a league's own apex domain the prefix is redundant and gets
 * STRIPPED; on the shared host (path-only leagues — no apex domain) it is
 * required and gets ADDED. Pass either form and get a URL that resolves.
 *
 * @param {{ slug: string, canonicalDomain?: string, domains?: string[] }} league
 * @param {string} [path] Internal path (prefixed or not), e.g. '/theleague/calendar'.
 */
export function leagueUrl(league, path = '/') {
  // Already absolute (or protocol-relative) — pass through untouched. Feed
  // links are not always internal: `post.link` on an ESPN item is a full
  // https:// URL, and treating one as a path would emit the nonsense
  // `https://www.theleague.us/https://www.espn.com/...`.
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path)) return path;
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const origin = leagueOrigin(league);
  if (!origin) return `${SHARED_APP_ORIGIN}${ensureLeaguePrefix(league, withSlash)}`;
  return `${origin}${stripLeaguePrefix(league, withSlash)}`;
}

/**
 * Apex hostname → canonical slug map, derived from each league's `domains`
 * PLUS its `stagingDomains`. Consumed by src/utils/league-host-map.ts, which
 * middleware uses to rewrite `/rosters` → `/theleague/rosters` on a
 * league-owned host.
 *
 * Why `stagingDomains` is a separate field rather than more entries in
 * `domains`: a staging host needs exactly ONE of the things `domains` grants
 * — the host→slug rewrite — and none of the rest.
 *   - `leagueOrigin()` picks the canonical host out of `domains`, and every
 *     absolute URL we emit (nav switch links, GroupMe, OG tags) must keep
 *     pointing at production. Session cookies are host-only, so an absolute
 *     link that leaked a staging host would look like a vanished login.
 *   - Registry invariants assume `domains` holds real apexes: every bare
 *     domain needs a `www.` twin (tests/leagues-registry.test.ts), and every
 *     entry needs prefix-strip redirects in vercel.json
 *     (tests/league-url-prefix.test.ts).
 * tests/league-staging-domains.test.ts pins that separation in both directions.
 */
export function buildHostToSlugMap() {
  /** @type {Record<string, string>} */
  const map = {};
  for (const league of ALL_LEAGUES) {
    for (const domain of [...league.domains, ...(league.stagingDomains ?? [])]) {
      map[domain] = league.slug;
    }
  }
  return map;
}
/**
 * Which BUILT-IN ranking sources are ticked into "My Rank" by default, per
 * league. Every source is AVAILABLE everywhere — this only decides the
 * starting composite, because the right default depends on how the league
 * drafts: dynasty trade values are the wrong opening board for a league that
 * re-drafts, and a straight redraft ADP is the wrong one for a contract
 * dynasty league.
 *
 * An owner's own tick/weight choices always win after the first visit; this
 * is a starting point, not a policy. Ids come from
 * scripts/fetch-ranking-sources.mjs.
 *
 * Every league carries its own rankings storage (see rankings-scope.ts), so
 * every league can carry its own defaults.
 */
export const DEFAULT_RANKING_SOURCES_FALLBACK = ['mfl-adp', 'sharks'];

/** Built-in ranking sources ticked on by default for a league slug. */
export function defaultRankingSourcesFor(slug) {
  return LEAGUES[slug]?.defaultRankingSources ?? DEFAULT_RANKING_SOURCES_FALLBACK;
}
