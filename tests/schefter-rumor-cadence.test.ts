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
  isLeagueSeasonOpen,
  MAILBAG_EXEMPT_FROM_MILL_CAP,
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

describe('two-post cycles follow the cap', () => {
  it('are off in season — two posts off one slot defeats a 1/day cap', () => {
    expect(allowsTwoPostCycle('theleague', atPT('2026-10-01'), SHARED)).toBe(false);
  });

  it('are on in the offseason and in the deadline window', () => {
    expect(allowsTwoPostCycle('theleague', atPT('2026-07-01'), SHARED)).toBe(true);
    expect(allowsTwoPostCycle('theleague', atPT('2026-11-10'), SHARED)).toBe(true);
  });

  it('gates every double-post path that still spends a chat slot', () => {
    // The daily counter increments once per delivering CYCLE, so a path that
    // ships two beats against one slot has to ask. Gating only busy-morning
    // left the gossip secondary shipping two posts against a cap of one — and
    // the tighter cap made it fire MORE often, since a 1/day mill drains the
    // gossip queue slower and it crosses the pressure threshold sooner.
    //
    // The busy-morning TRADE split stopped asking on 2026-09-08, when the
    // trade lanes went feed-first: a trade beat spends no slot, and a cycle
    // sends at most ONE chat ping however many beats it ships, so the pile-up
    // the question guards against cannot happen there. The gossip secondary
    // still pings per post and still asks. Anything ADDED here asks again.
    const src = readFileSync(
      path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
      'utf8',
    );
    const gossipIdx = src.indexOf("postKind === 'gossip' && secondaryBucket");
    expect(gossipIdx).toBeGreaterThan(-1);
    expect(src.slice(gossipIdx, gossipIdx + 900)).toMatch(/allowsTwoPostCycle/);

    // The trade split's exemption is only sound while a cycle can ping at
    // most once. That is `resolveTradeChatPing` returning a single index.
    const busyIdx = src.indexOf('BUSY_MORNING_TRADE_THRESHOLD &&');
    expect(busyIdx).toBeGreaterThan(-1);
    expect(src.slice(busyIdx - 700, busyIdx + 400)).not.toMatch(/allowsTwoPostCycle/);
    expect(src).toMatch(/if \(chatDecision\.index >= 0\) chatIndexes\.add\(chatDecision\.index\)/);
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
    const gateIdx = src.indexOf('let gates = await checkGates(redis, now');
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

  it('holds a reported offer for a multi-day cooldown', () => {
    // Was 7d — just past the tip expiry, so nearly every proposal was reported
    // exactly once. Cut to 3d on 2026-09-08 when the lane went feed-first: a
    // live negotiation is a story a REPORT can follow across a few beats, and
    // the drip in schefter-offer-beats.mjs is what stops those beats from
    // being the same post twice. It must never fall below a day — a same-day
    // repeat of one offer is the failure that started all of this.
    expect(src).toMatch(/const OFFER_REPOST_COOLDOWN_MS = 3 \* 24 \* 60 \* 60 \* 1000/);
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
