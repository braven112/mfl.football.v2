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
  allowsTwoPostCycle,
  IN_SEASON_MAX_RUMOR_POSTS_PER_DAY,
  AWAKE_START_OFFSET_FROM_KICKOFF_DAYS,
  isLeagueAwake,
  MAILBAG_EXEMPT_FROM_MILL_CAP,
  leagueAwakeWindow,
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
    expect(tradeDeadlineIsoDate('afl-fantasy', 2026)).toBe('2026-11-18');
  });

  it('agrees with the AFL event feed the site actually renders', () => {
    // compute-league-events.mjs REGENERATES and commits this artifact, so its
    // year advances on its own. Comparing it to a hardcoded date would pass
    // today and fail on every CI run from Feb 2027 — read the year off the
    // artifact and check the two derivations agree for whatever year it holds.
    const resolved = JSON.parse(
      readFileSync(path.join(process.cwd(), 'data/afl-fantasy/resolved-events.json'), 'utf8'),
    );
    const event = resolved.events.find(
      (e: { id: string }) => e.id === 'afl-trade-deadline',
    );
    expect(event, 'afl-trade-deadline missing from resolved-events.json').toBeDefined();
    expect(tradeDeadlineIsoDate('afl-fantasy', resolved.leagueYear)).toBe(
      String(event.startDate).slice(0, 10),
    );
  });

  it("pins TheLeague's registry date against the hero-resolver override", () => {
    // hero-resolver.ts carries its own hardcoded `month === 11 && day === 13`
    // for the trade-deadline-day hero. Nothing shares the two, so moving the
    // registry date would silently desync the hero override from the rumor
    // mill's deadline window — the hero would fire on a day the mill no longer
    // treats as the deadline. This IS that pin.
    const hero = readFileSync(
      path.join(process.cwd(), 'src/utils/hero-resolver.ts'),
      'utf8',
    );
    const m = hero.match(/return month === (\d+) && day === (\d+);/);
    expect(m, 'isTradeDeadlineDay no longer matches the expected shape').toBeTruthy();
    const [, month, day] = m!;
    expect(tradeDeadlineIsoDate('theleague', 2026)).toBe(
      `2026-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    );
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

describe('awake window — draft weekend through the championship', () => {
  it('opens on draft weekend (Labor Day - 8), not at kickoff', () => {
    const { startIso } = leagueAwakeWindow(2026);
    // Labor Day 2026 is Sep 7; the AFL's NL email draft is the Sunday eight
    // days before it. The anchor is the AFL's calendar and the window takes no
    // slug — TheLeague's own Cut to 22 is `third-sunday-august` (2026-08-16),
    // a fortnight earlier, so it stays loud through its own deadlines.
    expect(startIso).toBe('2026-08-30');
    expect(startIso).toBe(shiftIsoDate(nflKickoffIsoDate(2026), -11));
    expect(AWAKE_START_OFFSET_FROM_KICKOFF_DAYS).toBe(-11);
  });

  it('still closes on championship Monday — the start moving must not drag the end', () => {
    // Both ends measure from KICKOFF. Deriving endIso from startIso would
    // retire the quiet cap eleven days early, i.e. mid-playoffs.
    const { endIso } = leagueAwakeWindow(2026);
    expect(endIso).toBe(shiftIsoDate(nflKickoffIsoDate(2026), 16 * 7 + 4));
    expect(endIso).toBe('2027-01-04');
  });

  it('is closed in the quiet months and open from the drafts on', () => {
    expect(isLeagueAwake(atPT('2026-08-01'))).toBe(false);
    // 2026-08-29 is the AFL's AL Live Draft Saturday (Labor Day - 9). The
    // window opens the NEXT day, at the NL email draft — a deliberate choice
    // of anchor, not an oversight: see AWAKE_START_OFFSET_FROM_KICKOFF_DAYS.
    expect(isLeagueAwake(atPT('2026-08-29'))).toBe(false);
    expect(isLeagueAwake(atPT('2026-08-30'))).toBe(true);
    expect(isLeagueAwake(atPT('2026-11-15'))).toBe(true);
  });

  it('covers the roster week between the drafts and kickoff', () => {
    // The gap this window was widened to cover. On 2026-09-08 — drafts done,
    // cuts landing, kickoff two days out — the mill still had the full
    // offseason budget and shipped two beats about one offer, a second apart.
    for (const d of ['2026-08-31', '2026-09-05', '2026-09-08', '2026-09-09']) {
      expect(isLeagueAwake(atPT(d))).toBe(true);
      expect(rumorMillDailyCap('theleague', atPT(d), SHARED)).toBe(
        IN_SEASON_MAX_RUMOR_POSTS_PER_DAY,
      );
      expect(allowsTwoPostCycle('theleague', atPT(d), SHARED)).toBe(false);
    }
  });

  it('still reads as awake in early January, before the title is decided', () => {
    // The season that kicked off in September ends in January. Resolving the
    // season year off a Labor-Day-clock helper would test January against a
    // window that closed months earlier and report "offseason" mid-playoffs.
    const { endIso } = leagueAwakeWindow(2026);
    expect(endIso.startsWith('2027-01')).toBe(true);
    expect(isLeagueAwake(atPT(endIso))).toBe(true);
    expect(isLeagueAwake(atPT(shiftIsoDate(endIso, 1)))).toBe(false);
  });

  it('reopens for the whole quiet stretch, not just for a month', () => {
    for (const d of ['2027-01-05', '2027-03-01', '2027-06-15', '2027-08-01']) {
      expect(isLeagueAwake(atPT(d))).toBe(false);
    }
  });
});

describe('rumorMillDailyCap', () => {
  it('is the shared budget in the offseason', () => {
    expect(rumorMillDailyCap('theleague', atPT('2026-07-01'), SHARED)).toBe(SHARED);
    expect(rumorMillCapReason('theleague', atPT('2026-07-01'))).toBe('offseason');
  });

  it('drops to one per day once the league is awake', () => {
    expect(rumorMillDailyCap('theleague', atPT('2026-10-01'), SHARED)).toBe(
      IN_SEASON_MAX_RUMOR_POSTS_PER_DAY,
    );
    expect(IN_SEASON_MAX_RUMOR_POSTS_PER_DAY).toBe(1);
    expect(rumorMillCapReason('theleague', atPT('2026-10-01'))).toBe('league awake');
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

describe('two-post cycles follow the cap', () => {
  it('are off in season — two posts off one slot defeats a 1/day cap', () => {
    expect(allowsTwoPostCycle('theleague', atPT('2026-10-01'), SHARED)).toBe(false);
  });

  it('are on in the offseason and in the deadline window', () => {
    expect(allowsTwoPostCycle('theleague', atPT('2026-07-01'), SHARED)).toBe(true);
    expect(allowsTwoPostCycle('theleague', atPT('2026-11-10'), SHARED)).toBe(true);
  });

  it('gate BOTH double-post paths, not just the busy-morning one', () => {
    // The daily counter increments once per delivering CYCLE, so every path
    // that ships two beats has to ask. Gating only busy-morning left the
    // gossip secondary shipping two posts against a cap of one — and the
    // tighter cap made it fire MORE often, since a 1/day mill drains the
    // gossip queue slower and it crosses the pressure threshold sooner.
    const src = readFileSync(
      path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
      'utf8',
    );
    const calls = src.match(/allowsTwoPostCycle\(LEAGUE_SLUG, now, MAX_POSTS_PER_DAY\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // One guards the gossip secondary, one the busy-morning trade split.
    const gossipIdx = src.indexOf("postKind === 'gossip' && secondaryBucket");
    const busyIdx = src.indexOf('BUSY_MORNING_TRADE_THRESHOLD &&');
    expect(src.slice(gossipIdx, gossipIdx + 700)).toMatch(/allowsTwoPostCycle/);
    expect(src.slice(busyIdx - 400, busyIdx + 400)).toMatch(/allowsTwoPostCycle/);
  });
});

describe('the Friday mailbag is the one exemption from the cap', () => {
  it('is declared as an exemption, not left implicit', () => {
    expect(MAILBAG_EXEMPT_FROM_MILL_CAP).toBe(true);
  });

  it('is resolved BEFORE checkGates, which returns early', () => {
    // checkGates returns on a failed gate, so asking about the mailbag after
    // it is asking too late: in season one earlier rumor spends the only slot,
    // the mailbag never runs, its done-key is never set, and the swept gossip
    // tips age out unseen — the exact loss the mailbag exists to prevent.
    const src = readFileSync(
      path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
      'utf8',
    );
    const candidateIdx = src.indexOf('let mailbagCandidate = false;');
    const gateIdx = src.indexOf('const gates = await checkGates(redis, now');
    expect(candidateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(candidateIdx);
    expect(src).toMatch(/checkGates\(redis, now, \{ exemptFromMillCap: mailbagCandidate \}\)/);
    expect(src).toMatch(/if \(exemptFromMillCap && millPostsToday >= millCap\)/);
  });

  it('still requires gossip tips to actually be waiting', () => {
    // The exemption buys one extra post a week, not a standing licence: no
    // gossip in the queue means no mailbag and no exemption.
    const src = readFileSync(
      path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
      'utf8',
    );
    const idx = src.indexOf('let mailbagCandidate = false;');
    expect(src.slice(idx, idx + 900)).toMatch(/classifyTipKind\(t\) === 'gossip'/);
  });
});

describe('scanner wiring', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
    'utf8',
  );

  it('gates the busy-morning double-post on the cap', () => {
    expect(src).toMatch(/allowsTwoPostCycle\(LEAGUE_SLUG, now, MAX_POSTS_PER_DAY\)/);
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
    expect(src).toMatch(/OFFER_LAST_POST_KEY,\s*Object\.fromEntries/);
  });

  it('stamps the cooldown on DELIVERY, never at enqueue', () => {
    // scanTradeOffers only QUEUES a tip; the post ships later and may never
    // ship at all (quality gate, daily cap, strike-out, expiry). Stamping at
    // enqueue silenced an offer for 7 days over a post nobody read — and with
    // TIP_EXPIRY_MS also 7 days, that usually means never. The write belongs
    // beside the other delivery budgets, keyed off consumedBatch.
    const scanFnIdx = src.indexOf('async function scanTradeOffers(');
    const scanFnEnd = src.indexOf('// ── History subject heuristic ──');
    expect(scanFnIdx).toBeGreaterThan(-1);
    expect(scanFnEnd).toBeGreaterThan(scanFnIdx);
    // No cooldown WRITE anywhere inside the enqueue function.
    expect(src.slice(scanFnIdx, scanFnEnd)).not.toMatch(/hset\(\s*OFFER_LAST_POST_KEY/);
    // ...and the delivery-side write reads the consumed batch.
    const writeIdx = src.indexOf('const reportedOfferIds =');
    expect(writeIdx).toBeGreaterThan(scanFnEnd);
    expect(src.slice(writeIdx, writeIdx + 500)).toMatch(/consumedBatch/);
  });

  it('derives the offer id by stripping the prefix, not by offset', () => {
    // A bare slice(3) silently yields a garbage key if the tip id shape ever
    // changes, and a garbage key means no cooldown at all.
    expect(src).toMatch(/startsWith\('to_'\) \? t\.id\.slice\('to_'\.length\) : ''/);
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
