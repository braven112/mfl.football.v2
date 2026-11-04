/**
 * A sync that found nothing must commit nothing — every commit to `main` is a
 * production build. Over 8 days in Oct 2026, 137 of 602 roster-sync and
 * Schefter-scan commits changed only a run timestamp: `generatedAt` in
 * injuries.json, `fetchedAt` in tradeBait-by-franchise.json, and
 * `lastScanTimestamp` in the Schefter feed on a scan with no new moves.
 * These scans pin each of those three writers to the skip-if-unchanged path.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripScheduleSpreads } from '../scripts/lib/mfl-schedule-feed.mjs';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('sync writers skip timestamp-only changes', () => {
  const feeds = read('scripts/fetch-mfl-feeds.mjs');

  it('treats generatedAt as volatile for every feed write', () => {
    const m = feeds.match(/const VOLATILE_FEED_KEYS = \[([^\]]*)\]/);
    expect(m, 'VOLATILE_FEED_KEYS not found').toBeTruthy();
    expect(m![1]).toContain("'generatedAt'");
  });

  it('writes tradeBait-by-franchise.json through writeJsonIfChanged, ignoring fetchedAt', () => {
    const start = feeds.indexOf('const writeTradeBaitByFranchise');
    const body = feeds.slice(start, feeds.indexOf('\n};', start));
    expect(body).toMatch(/writeJsonIfChanged\(file, payload, \{ ignoreKeys: \['fetchedAt'\] \}\)/);
    expect(body).not.toMatch(/fs\.writeFileSync/);
  });

  it('leaves the Schefter feed untouched on a scan with no new transactions', () => {
    const scan = read('scripts/schefter-scan.mjs');
    const start = scan.indexOf('if (newTxns.length === 0) {');
    expect(start).toBeGreaterThan(-1);
    const block = scan.slice(start, scan.indexOf('return 0;', start));
    expect(block).not.toMatch(/fs\.writeFile/);
    expect(block).not.toMatch(/lastScanTimestamp\s*=/);
  });

  it('stores trade-bait state through setTradeBaitState, which stamps only a change', () => {
    // mergeFeed picks the trade-bait state by tradeBaitStateAt, so every write
    // must go through the helper that maintains it.
    const scan = read('scripts/schefter-scan.mjs');
    // The one direct assignment allowed is inside the helper itself.
    expect(scan.match(/feed\.tradeBaitState\s*=(?!=)/g)?.length).toBe(1);
    expect(scan.match(/(?<!function )setTradeBaitState\(feed, nextState\)/g)?.length).toBe(2);
  });

  it('drops the projected matchup spreads from schedule.json before writing', () => {
    // MFL recomputes these from live projections, so they moved on most
    // syncs and kept schedule.json a "real" change no reader cared about.
    expect(feeds).toMatch(/key: 'schedule',[\s\S]{0,200}parser: \(t\) => stripScheduleSpreads\(JSON\.parse\(t\)\)/);
    const feed = {
      schedule: {
        weeklySchedule: [
          { week: '9', matchup: [{ franchise: [{ id: '0001', spread: '1.4', isHome: '1' }, { id: '0002', spread: '-1.4' }] }] },
          // MFL collapses one-element arrays to a bare object.
          { week: '10', matchup: { franchise: { id: '0003', spread: '7', score: '101.2' } } },
        ],
      },
    };
    expect(stripScheduleSpreads(feed)).toEqual({
      schedule: {
        weeklySchedule: [
          { week: '9', matchup: [{ franchise: [{ id: '0001', isHome: '1' }, { id: '0002' }] }] },
          { week: '10', matchup: { franchise: { id: '0003', score: '101.2' } } },
        ],
      },
    });
  });

  it('holds live-read files out of the roster-sync commit, right before it', () => {
    const wf = read('.github/workflows/roster-sync.yml');
    const hold = wf.indexOf('run: node ./scripts/hold-sync-files.mjs');
    const commit = wf.indexOf('- name: Commit and push updates');
    expect(hold, 'hold step missing').toBeGreaterThan(-1);
    // Nothing may run between the hold and the commit, or it could rewrite a restored file.
    expect(wf.slice(hold, commit)).not.toMatch(/\n\s+run:/);
    const step = wf.slice(wf.lastIndexOf('- name:', hold), hold);
    expect(step).toContain('UPSTASH_REDIS_REST_URL');
    expect(step).toContain('UPSTASH_REDIS_REST_TOKEN');
  });

  it('leaves live-odds.json alone in season, when the site reads ESPN instead', () => {
    const odds = read('scripts/fetch-live-odds.mjs');
    expect(odds).toMatch(/if \(weekIndex === -1 && !isOffSeason\(\)\)/);
    expect(read('src/utils/coach-data.ts')).toMatch(/if \(isOffSeason && fallbackData\) return fallbackData;/);
  });

  it('renders injuries through the live reader, since the committed copy is a daily snapshot', () => {
    for (const page of [
      'src/components/shared/rosters/RostersPage.astro',
      'src/components/shared/free-agents/FreeAgentsPage.astro',
      'src/components/shared/lineup/LineupPage.astro',
      'src/pages/theleague/rosters.astro',
    ]) {
      const src = read(page);
      expect(src, page).toMatch(/await loadLiveInjuryMap\(/);
      expect(src, page).not.toMatch(/\bloadInjuryMap\(/);
    }
  });

  it('feeds the lineup warnings and app badge the live report, not the disk copy alone', () => {
    for (const file of ['src/utils/my-team-week.ts', 'src/pages/api/app-badge.ts']) {
      expect(read(file), file).toMatch(/await loadLiveInjuryFeed\(league\.slug, \w+, readFeed\(league, \w+, 'injuries\.json'\)/);
    }
  });
});

/**
 * Phase 4a (docs/plans/league-data-out-of-deploy.md): the roster sync holds
 * the current league year's rosters.json and transactions.json (and the
 * top-players.json derived from them) out of its commit, letting them through
 * once a day. The committed copy is therefore up to a day old, which is only
 * safe while every reader that shows owners who holds whom reads live first.
 * These pin each of those readers to its overlay, and classify every other
 * reader, so a new page that reads the committed copy alone fails here.
 */
describe('held rosters and transactions are read live', () => {
  const ROSTERS_LIVE = /\b(?:liveRostersFeed|getCachedRosterFranchises|getCachedRosters|loadRostersFeed|resolveRostersPayload)\(/;
  const TX_LIVE = /\b(?:getCachedRecentTransactions|mergeTransactionRows|loadTransactionsSeason)\(/;

  it('holds them in one group, current league year only', () => {
    const held = read('scripts/lib/held-sync-files.mjs');
    const start = held.indexOf("group: 'rosters'");
    const group = held.slice(start, held.indexOf('];', start));
    expect(group).toContain('rosters|transactions');
    expect(group).toContain('top-players');
    expect(group).toContain('currentYearOnly: true');
  });

  it('pins each must-read-live reader to its overlay', () => {
    const readers: Array<[string, RegExp]> = [
      ['src/components/shared/trade-builder/TradeBuilderPage.astro', /await liveRostersFeed\(committedRostersData, selectedYear, league\.id\)/],
      ['src/pages/theleague/front-office/trade-builder.astro', /const rostersData = await liveRostersFeed\(/],
      ['src/components/shared/custom-rankings/CustomRankingsPage.astro', /rostersData = await liveRostersFeed\(rostersData, leagueYear, league\.id\)/],
      ['src/pages/afl-fantasy/keeper-analysis.astro', /await liveRostersFeed\(committedCurRosters, selectedYear, league\.leagueId\)/],
      ['src/utils/draft-broadcast-server.ts', /year === liveYear \? liveRostersFeed\(committed, year, leagueId\)/],
      ['src/pages/theleague/admin/cutdown-report.astro', /const rosterData = await liveRostersFeed\(/],
      ['src/pages/theleague/admin/cutdown-report.astro', /mergeTransactionRows\(toArray\(transactionsData\?\.transactions\?\.transaction\), recentTransactions\)/],
      ['src/components/theleague/season-heroes/WaiverWireHero.astro', /rosteredIdsOf\(await liveRostersFeed\(/],
      ['src/components/shared/package-league/PackageLeagueHome.astro', /await liveRostersFeed\(committedRostersFeed, leagueYear, league\.id\)/],
      ['src/pages/afl-fantasy/index.astro', /await liveRostersFeed\(committedRostersFeed, rosterYear, AFL\.id\)/],
      ['src/utils/front-office-planner-data.ts', /mergeTransactionRows\([\s\S]{0,120}await getCachedRecentTransactions\(String\(draftSeasonYear\)/],
      // Already live before Phase 4a; pinned so they stay that way.
      ['src/components/shared/rosters/RostersPage.astro', /await getCachedRosterFranchises\(String\(selectedYear\), LEAGUE_ID\)/],
      ['src/pages/theleague/rosters.astro', /await getCachedRosters\(currentLeagueYearStr, THELEAGUE_ID\)/],
      ['src/pages/theleague/players.astro', /getCachedRosters\(String\(currentYear\), mflLeagueId\)/],
      ['src/pages/theleague/index.astro', /mergeTransactionRows\(staticTransactions, liveTransactions\)/],
      ['src/utils/front-office-planner-data.ts', /await getCachedRosters\(leagueYearStr, THELEAGUE_ID\)/],
      ['src/utils/front-office-keeper-data.ts', /await getCachedRosterFranchises\(leagueYearStr, leagueId\)/],
      ['src/utils/transactions-feeds.ts', /getCachedRecentTransactions\(String\(input\.year\), input\.leagueId\)/],
    ];
    for (const [file, overlay] of readers) expect(read(file), file).toMatch(overlay);
  });

  it('hands both draft-broadcast readers the live-first feed', () => {
    for (const page of ['src/pages/afl-fantasy/draft/broadcast.astro', 'src/pages/theleague/draft/broadcast.astro']) {
      const src = read(page);
      expect(src, page).toMatch(/const rostersFeed = await loadRostersFeed\(league\.dataPath, leagueYear, \{\s*liveYear: defaultYear,/);
      for (const fn of ['loadConferenceKeepers', 'loadFranchiseHoldings']) {
        const call = new RegExp(`${fn}\\(([\\s\\S]*?)\\);`).exec(src)?.[1] ?? '';
        expect(call, `${page} ${fn}`).toMatch(/\brostersFeed\s*$/);
      }
    }
  });

  it('merges live transactions and the live roster into the auto-cut block', () => {
    const src = read('src/pages/theleague/rosters.astro');
    const block = src.slice(src.indexOf('const rawTxFeed ='), src.indexOf('const autocutRookieIds ='));
    expect(block).toMatch(/mergeTransactionRows\([\s\S]*await getCachedRecentTransactions\(currentLeagueYearStr, THELEAGUE_ID\)/);
    expect(block).toMatch(/Object\.entries\(cachedRosterPlayers\)/);
    // And the draft assets' trade source, which is the league year in season.
    expect(src).toMatch(/const transactionsData = committedTransactionsData && draftSeasonYear === currentLeagueYear/);
  });

  it('asks MFL before its checkout in the rumor scan, so a completed trade is not re-posted', () => {
    const scan = read('scripts/schefter-rumor-scan.mjs');
    const body = (name: string) => {
      const start = scan.indexOf(`async function ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      return scan.slice(start, scan.indexOf('\n}\n', start));
    };
    expect(body('loadRosterOwners')).toMatch(/fetchLiveLeagueExport\(year, 'rosters'\)/);
    expect(body('loadCompletedTradeSignatures')).toMatch(/fetchLiveLeagueExport\(year, 'transactions', '&TRANS_TYPE=TRADE'\)/);
    // Null (never a throw) is what sends a reader to the committed file.
    expect(body('fetchLiveLeagueExport')).toMatch(/return null;/);
  });

  /**
   * Every src reader of a rosters.json / transactions.json, classified. A file
   * that reads one must carry a live overlay for it, hand its globs to a shared
   * component that does, or be listed as a reader a day's lag cannot hurt.
   * An entry that no longer reads either feed fails too, so the lists shrink.
   */
  const WRAPPERS: Record<string, string> = {
    'src/pages/afl-fantasy/rosters.astro': 'src/components/shared/rosters/RostersPage.astro',
    'src/pages/archies/rosters.astro': 'src/components/shared/rosters/RostersPage.astro',
    'src/pages/keeper/rosters.astro': 'src/components/shared/rosters/RostersPage.astro',
    'src/pages/afl-fantasy/front-office/trade-builder.astro': 'src/components/shared/trade-builder/TradeBuilderPage.astro',
    'src/pages/archies/front-office/trade-builder.astro': 'src/components/shared/trade-builder/TradeBuilderPage.astro',
    'src/pages/keeper/front-office/trade-builder.astro': 'src/components/shared/trade-builder/TradeBuilderPage.astro',
    'src/pages/archies/index.astro': 'src/components/shared/package-league/PackageLeagueHome.astro',
    'src/pages/keeper/index.astro': 'src/components/shared/package-league/PackageLeagueHome.astro',
    'src/pages/theleague/transactions.astro': 'src/components/shared/transactions/TransactionsPage.astro',
    'src/pages/afl-fantasy/transactions.astro': 'src/components/shared/transactions/TransactionsPage.astro',
    'src/pages/archies/transactions.astro': 'src/components/shared/transactions/TransactionsPage.astro',
    'src/pages/archies/free-agents.astro': 'src/components/shared/free-agents/FreeAgentsPage.astro',
  };
  // The plan's "a day's lag is fine" readers, plus files that read nothing themselves.
  const DAY_LAG_OK = new Set([
    'src/components/theleague/season-heroes/MatchupPreviewHero.astro', // the matchup preview
    'src/utils/offseason-hero-data.ts', // hero casting and "owned by" labels
    'src/pages/theleague/activity.astro', // activity's move fallback
    'src/pages/afl-fantasy/activity.astro',
    'src/pages/archies/activity.astro',
    'src/pages/best-ball-1/activity.astro',
    'src/utils/rosters/roster-page-feeds.ts', // a lookup over globs its callers overlay
    'src/utils/mfl-transactions-cache.ts', // the live cache itself
    'src/data/live-scoring-sample.ts', // a frozen sample season
  ]);
  const FEEDS: Array<[string, RegExp, RegExp]> = [
    ['rosters', /[/'"{,]rosters(?:\.json['"`]|,[^}]*\}\.json|\}\.json)/, ROSTERS_LIVE],
    ['transactions', /[/'"{,]transactions(?:\.json['"`]|,[^}]*\}\.json|\}\.json)/, TX_LIVE],
  ];
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return walk(rel);
      return /\.(astro|ts|tsx|mjs|js)$/.test(e.name) ? [rel] : [];
    });
  const sources = walk('src').map((file) => [file, read(file)] as const);

  for (const [feed, reads, live] of FEEDS) {
    it(`classifies every src reader of ${feed}.json`, () => {
      const unclassified: string[] = [];
      for (const [file, src] of sources) {
        if (!reads.test(src) || live.test(src) || DAY_LAG_OK.has(file)) continue;
        const component = WRAPPERS[file];
        if (component && live.test(read(component)) && src.includes(path.basename(component))) continue;
        unclassified.push(file);
      }
      expect(
        unclassified,
        `read ${feed}.json live first (src/utils/rosters/live-rosters-feed.ts, src/utils/mfl-transactions-cache.ts) or justify it in this test`,
      ).toEqual([]);
    });
  }

  it('keeps both lists honest: every entry still reads a held feed', () => {
    const readsAny = (src: string) => FEEDS.some(([, reads]) => reads.test(src));
    for (const file of [...DAY_LAG_OK, ...Object.keys(WRAPPERS)]) expect(readsAny(read(file)), file).toBe(true);
  });
});

