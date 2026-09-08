/**
 * The rumor mill's cadence — how loud it is allowed to be, by date.
 *
 * Every case here is a rule from the 2026-09-08 owner report: two rumors about
 * the SAME trade offer, 7.5 hours apart, on a lane whose only real gate was a
 * league-wide 3/day + 4h budget. The three fixes were a much rarer leak roll,
 * a per-offer repost cooldown, and a cap that inverts with the calendar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  IN_SEASON_MAX_RUMOR_POSTS_PER_DAY,
  isBusyMorningAllowed,
  isLeagueSeasonOpen,
  leagueSeasonWindow,
  rumorMillCapReason,
  rumorMillDailyCap,
} from '../scripts/lib/schefter-rumor-cadence.mjs';
import {
  isTradeDeadlineWindow,
  nflKickoffIsoDate,
  ptDateString,
  shiftIsoDate,
  tradeDeadlineIsoDate,
  upcomingTradeDeadline,
  TRADE_DEADLINE_WINDOW_DAYS,
} from '../src/utils/trade-deadline.mjs';
import { MAX_POSTS_PER_DAY } from '../scripts/lib/schefter-groupme-budget.mjs';

/** Noon PT on a PT calendar date — safely inside the day at either offset. */
function atPT(iso: string): Date {
  return new Date(`${iso}T20:00:00Z`);
}

const SHARED = MAX_POSTS_PER_DAY;

describe('trade deadline — resolved from the registry, never inlined', () => {
  it('derives the NFL kickoff Thursday for known seasons', () => {
    // The real openers. If this drifts, every window below is wrong.
    expect(nflKickoffIsoDate(2024)).toBe('2024-09-05');
    expect(nflKickoffIsoDate(2025)).toBe('2025-09-04');
    expect(nflKickoffIsoDate(2026)).toBe('2026-09-10');
  });

  it("keeps TheLeague's fixed Nov 13 deadline", () => {
    for (const y of [2025, 2026, 2027]) {
      expect(tradeDeadlineIsoDate('theleague', y)).toBe(`${y}-11-13`);
    }
  });

  it("computes the AFL's Wednesday between weeks 10 and 11", () => {
    // Pinned against the AFL's own resolved event feed, which independently
    // computes 2026-11-18 from the same rule in league-event-resolver.ts.
    expect(tradeDeadlineIsoDate('afl-fantasy', 2026)).toBe('2026-11-18');
    const resolved = JSON.parse(
      readFileSync(path.join(process.cwd(), 'data/afl-fantasy/resolved-events.json'), 'utf8'),
    );
    const found = JSON.stringify(resolved).match(
      /"id":"afl-trade-deadline".*?"startDate":"(\d{4}-\d{2}-\d{2})/,
    );
    expect(found?.[1]).toBe('2026-11-18');
  });

  it('returns null for a league with no deadline rather than inventing one', () => {
    // Best Ball drafts and never trades. A substituted date would open a
    // deadline window in a league that has no deadline.
    expect(tradeDeadlineIsoDate('best-ball-1', 2026)).toBeNull();
    expect(isTradeDeadlineWindow('best-ball-1', atPT('2026-11-13'))).toBe(false);
    expect(upcomingTradeDeadline('best-ball-1', atPT('2026-11-13'))).toBeNull();
  });

  it('rolls to next year once this year’s deadline has passed', () => {
    expect(upcomingTradeDeadline('theleague', atPT('2026-11-13'))).toBe('2026-11-13');
    expect(upcomingTradeDeadline('theleague', atPT('2026-11-14'))).toBe('2027-11-13');
  });

  it('opens the window exactly 10 days out and closes it after deadline day', () => {
    const deadline = tradeDeadlineIsoDate('theleague', 2026)!;
    const open = shiftIsoDate(deadline, -TRADE_DEADLINE_WINDOW_DAYS);
    expect(isTradeDeadlineWindow('theleague', atPT(shiftIsoDate(open, -1)))).toBe(false);
    expect(isTradeDeadlineWindow('theleague', atPT(open))).toBe(true);
    // Deadline day itself is INSIDE the window — it is the loudest trading day
    // of the year, and muting Schefter on it defeats the exception.
    expect(isTradeDeadlineWindow('theleague', atPT(deadline))).toBe(true);
    expect(isTradeDeadlineWindow('theleague', atPT(shiftIsoDate(deadline, 1)))).toBe(false);
  });

  it('gives each league its OWN window — the two deadlines differ', () => {
    // TheLeague Nov 13, AFL Nov 18 in 2026. On Nov 7 only TheLeague is in its
    // run-up; on Nov 18 only the AFL is. A shared window would be wrong in
    // both leagues on both days.
    expect(isTradeDeadlineWindow('theleague', atPT('2026-11-07'))).toBe(true);
    expect(isTradeDeadlineWindow('afl-fantasy', atPT('2026-11-07'))).toBe(false);
    expect(isTradeDeadlineWindow('theleague', atPT('2026-11-18'))).toBe(false);
    expect(isTradeDeadlineWindow('afl-fantasy', atPT('2026-11-18'))).toBe(true);
  });

  it('reads the deadline off the registry, so a league cannot be missed', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/utils/trade-deadline.mjs'),
      'utf8',
    );
    expect(src).toMatch(/LEAGUES\[slug\]\?\.tradeDeadline/);
    const registry = readFileSync(
      path.join(process.cwd(), 'src/config/leagues-data.mjs'),
      'utf8',
    );
    // Every league declares one, even if the answer is "none".
    const declared = registry.match(/^\s*tradeDeadline:/gm) ?? [];
    const slugs = registry.match(/^\s{4}slug: '/gm) ?? [];
    expect(declared.length).toBe(slugs.length);
  });
});

describe('season window — kickoff through the championship', () => {
  it('runs from the kickoff Thursday to championship Monday', () => {
    const { startIso, endIso } = leagueSeasonWindow(2026);
    expect(startIso).toBe('2026-09-10');
    // Week 17 starts at kickoff + 16*7 and closes on MNF four days later.
    expect(endIso).toBe(shiftIsoDate(startIso, 16 * 7 + 4));
  });

  it('is closed in the offseason and open in the season', () => {
    expect(isLeagueSeasonOpen(atPT('2026-08-01'))).toBe(false);
    expect(isLeagueSeasonOpen(atPT('2026-09-09'))).toBe(false); // day before kickoff
    expect(isLeagueSeasonOpen(atPT('2026-09-10'))).toBe(true);
    expect(isLeagueSeasonOpen(atPT('2026-11-15'))).toBe(true);
  });

  it('still reads as in-season in early January, before the title is decided', () => {
    // The season that kicked off in September ends in January. Resolving the
    // season year off a Labor-Day-clock helper would test January against a
    // window that closed months earlier and report "offseason" mid-playoffs.
    const { endIso } = leagueSeasonWindow(2026);
    expect(endIso.startsWith('2027-01')).toBe(true);
    expect(isLeagueSeasonOpen(atPT(endIso))).toBe(true);
    expect(isLeagueSeasonOpen(atPT(shiftIsoDate(endIso, 1)))).toBe(false);
  });

  it('reopens for the whole offseason, not just for a month', () => {
    for (const d of ['2027-01-05', '2027-03-01', '2027-06-15', '2027-09-01']) {
      expect(isLeagueSeasonOpen(atPT(d))).toBe(false);
    }
  });
});

describe('rumorMillDailyCap', () => {
  it('is the shared budget in the offseason', () => {
    expect(rumorMillDailyCap('theleague', atPT('2026-07-01'), SHARED)).toBe(SHARED);
    expect(rumorMillCapReason('theleague', atPT('2026-07-01'))).toBe('offseason');
  });

  it('drops to one per day once the season is being played', () => {
    expect(rumorMillDailyCap('theleague', atPT('2026-10-01'), SHARED)).toBe(
      IN_SEASON_MAX_RUMOR_POSTS_PER_DAY,
    );
    expect(IN_SEASON_MAX_RUMOR_POSTS_PER_DAY).toBe(1);
    expect(rumorMillCapReason('theleague', atPT('2026-10-01'))).toBe('in season');
  });

  it('returns to the shared budget inside each league’s deadline run-up', () => {
    // In BOTH leagues — on its own deadline's schedule.
    expect(rumorMillDailyCap('theleague', atPT('2026-11-10'), SHARED)).toBe(SHARED);
    expect(rumorMillDailyCap('afl-fantasy', atPT('2026-11-15'), SHARED)).toBe(SHARED);
    expect(rumorMillCapReason('afl-fantasy', atPT('2026-11-15'))).toBe('trade-deadline window');
    // ...and each league is back to 1/day once ITS deadline passes.
    expect(rumorMillDailyCap('theleague', atPT('2026-11-15'), SHARED)).toBe(1);
    expect(rumorMillDailyCap('afl-fantasy', atPT('2026-11-19'), SHARED)).toBe(1);
  });

  it('never exceeds the shared budget it is handed', () => {
    // The mill's cap is a TIGHTENING of the shared budget, never a widening —
    // otherwise the lane could outspend the budget it draws from.
    for (const d of ['2026-07-01', '2026-10-01', '2026-11-12', '2027-01-04']) {
      for (const slug of ['theleague', 'afl-fantasy']) {
        expect(rumorMillDailyCap(slug, atPT(d), SHARED)).toBeLessThanOrEqual(SHARED);
        expect(rumorMillDailyCap(slug, atPT(d), SHARED)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('busy-morning catch-up follows the cap', () => {
  it('is off in season — two posts off one slot defeats a 1/day cap', () => {
    expect(isBusyMorningAllowed('theleague', atPT('2026-10-01'), SHARED)).toBe(false);
  });

  it('is on in the offseason and in the deadline window', () => {
    expect(isBusyMorningAllowed('theleague', atPT('2026-07-01'), SHARED)).toBe(true);
    expect(isBusyMorningAllowed('theleague', atPT('2026-11-10'), SHARED)).toBe(true);
  });
});

describe('scanner wiring', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
    'utf8',
  );

  it('gates the busy-morning double-post on the cap', () => {
    expect(src).toMatch(/isBusyMorningAllowed\(LEAGUE_SLUG, now, MAX_POSTS_PER_DAY\)/);
  });

  it('counts the mill on its OWN key, not the shared budget', () => {
    // The shared rumor:posts_today also carries the transaction scanner's
    // big-name-drop pings and the speculation lane. Gating the in-season cap
    // on it would let a real roster move silence the rumor mill for the day,
    // which is the opposite of "let the league do the talking".
    expect(src).toMatch(/rumor:mill_posts_today/);
    expect(src).toMatch(/rumorMillDailyCap\(LEAGUE_SLUG, now, MAX_POSTS_PER_DAY\)/);
    expect(src).toMatch(/redis\.incr\(RUMOR_MILL_POSTS_TODAY_KEY\)/);
  });

  it('leaves the SHARED budget constant untouched at its lib value', () => {
    expect(src).toContain(`const MAX_POSTS_PER_DAY = ${MAX_POSTS_PER_DAY}`);
  });

  it('spends a mill slot on the quiet-day post too', () => {
    // A quiet-day post is a rumor-mill feed entry. Without this, a quiet-day
    // post and a real rumor could both ship against a 1/day cap.
    const quietIdx = src.indexOf('QUIET_DAY_LAST_DATE_KEY, todayPtDate');
    expect(quietIdx).toBeGreaterThan(-1);
    const window = src.slice(quietIdx, quietIdx + 900);
    expect(window).toMatch(/RUMOR_MILL_POSTS_TODAY_KEY/);
  });
});

describe('per-offer rarity gates', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
    'utf8',
  );

  it('rolls each offer at most once per Pacific day', () => {
    expect(src).toMatch(/const OFFER_LAST_ROLL_DATE_KEY = schefterKey\(NAV_SLUG, 'trade_offers:last_roll_date'\)/);
    expect(src).toMatch(/if \(lastRollDate === todayPtForRoll\) \{/);
  });

  it('holds a reported offer for a 7-day cooldown', () => {
    expect(src).toMatch(/const OFFER_REPOST_COOLDOWN_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
    expect(src).toMatch(/nowMs - lastPostMs < OFFER_REPOST_COOLDOWN_MS/);
    expect(src).toMatch(/hset\(OFFER_LAST_POST_KEY/);
  });

  it('checks the cooldown BEFORE spending the offer’s daily roll', () => {
    // Order is load-bearing: rolling a cooling-down offer would burn its one
    // roll for the day and make the roll counter lie about how many chances
    // an offer had to leak.
    const cooldownIdx = src.indexOf('nowMs - lastPostMs < OFFER_REPOST_COOLDOWN_MS');
    const rollIdx = src.indexOf('if (lastRollDate === todayPtForRoll)');
    expect(cooldownIdx).toBeGreaterThan(-1);
    expect(rollIdx).toBeGreaterThan(cooldownIdx);
  });

  it('does not stamp the day’s roll during a dry run', () => {
    // A dry run that consumed the roll would silence the real scanner for the
    // rest of the day on every offer it touched.
    const idx = src.indexOf('hset(OFFER_LAST_ROLL_DATE_KEY');
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, idx - 300), idx)).toMatch(/if \(!dryRun\) \{/);
  });
});
