/**
 * Guards for the deadline-reminder migration (Sep 2026).
 *
 * The model: every deadline reminder goes to web push, and the group chat
 * carries it only for the owners the fan-out could not reach. Chat volume then
 * falls to zero on its own as owners subscribe — there is no cutover date and
 * no flag to flip, which is exactly why the wiring has to be pinned. Three
 * separate near-misses are encoded below:
 *
 *   1. A push lane that never ran. `CRON_SECRET` was absent from
 *      lineup-reminders.yml entirely and from schefter-scan.yml's SCANNER step
 *      (it was set only on the watch-list step), so both fan-outs logged
 *      "CRON_SECRET not set — skipping" on every run while the chat posts went
 *      out normally and hid it.
 *   2. A fallback that fails toward silence. If "nobody was unreached" and
 *      "we never asked" are the same value, a push outage silently cancels the
 *      league's only remaining notice of a deadline.
 *   3. A season gate on the calendar month. Week 1 kicks off the Thursday AFTER
 *      Labor Day, so `month >= 9` is in-season up to nine days early — which on
 *      2026-09-06 posted a warning naming 17 of the AFL's 24 teams for not
 *      setting a lineup nobody could set yet.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bypassesDayCap,
  EXEMPT_KINDS,
  isPlannedToday,
  OWN_BUDGET_KINDS,
  PUSH_ONLY_KINDS,
} from '../scripts/lib/groupme-day-plan.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('the push lane is actually wired in CI', () => {
  // Each entry: the workflow, and the run: line whose step must carry the
  // secret. Naming the run line rather than the whole file is the point — the
  // schefter-scan bug was a CRON_SECRET present in the file but on the wrong
  // step, which any whole-file grep would have called green.
  const cases = [
    {
      workflow: '.github/workflows/lineup-reminders.yml',
      step: 'node scripts/schefter-lineup-check.mjs',
    },
    {
      workflow: '.github/workflows/schefter-scan.yml',
      step: 'node scripts/schefter-scan.mjs',
    },
    // Both league steps. This workflow was missed on the first pass, and the
    // 2026-09-06 08:49 PT run shows exactly what that costs: two posts that
    // scored 8/10 at the quality gate, "Held: rumor is push-only" AND
    // "CRON_SECRET not set — skipping rumor push" in the same run. Feed-only,
    // reaching nobody.
    {
      workflow: '.github/workflows/schefter-rumor-scan.yml',
      step: 'node scripts/schefter-rumor-scan.mjs --league theleague',
    },
    {
      workflow: '.github/workflows/schefter-rumor-scan.yml',
      step: 'node scripts/schefter-rumor-scan.mjs --league afl-fantasy',
    },
  ];

  for (const { workflow, step } of cases) {
    it(`${workflow} gives CRON_SECRET to the step running \`${step}\``, () => {
      const src = read(workflow);
      const runIndex = src.indexOf(step);
      expect(runIndex, `${workflow} no longer runs ${step}`).toBeGreaterThan(-1);

      // The step's env block is the text between the previous `- name:` and
      // its `run:`. A secret declared after the run line belongs to a later
      // step and does nothing for this one.
      const stepStart = src.lastIndexOf('- name:', runIndex);
      const envBlock = src.slice(stepStart, runIndex);
      // An ASSIGNMENT, not the mere string. A comment explaining why the
      // secret matters satisfies `toContain('CRON_SECRET')` perfectly well —
      // that is the shape of grep-guard that has twice gone green over deleted
      // wiring in this repo (see docs/claude/rules/league-urls.md).
      const assigned = envBlock
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .some((line) => /^\s*CRON_SECRET:\s*\$\{\{\s*secrets\.CRON_SECRET\s*\}\}\s*$/.test(line));
      expect(
        assigned,
        `${workflow}: CRON_SECRET must be ASSIGNED on the step running ${step}, or the push fan-out silently sends nothing`,
      ).toBe(true);
    });
  }

  it('the lineup lane can resolve GroupMe members so unreached owners get @-mentioned', () => {
    expect(read('.github/workflows/lineup-reminders.yml')).toMatch(
      /^\s*GROUPME_SERVICE_TOKEN:\s*\$\{\{\s*secrets\.GROUPME_SERVICE_TOKEN\s*\}\}\s*$/m,
    );
  });
});

describe('a push that could not run reaches NOBODY, never everybody', () => {
  const src = read('scripts/lib/push-fanout.mjs');

  it('derives the unreached set from what was requested', () => {
    // `requested` is the whole safety property: every early return reports the
    // full roster as unreached, so a fallback still names everyone.
    expect(src).toMatch(/const requested = \[\.\.\.new Set\(/);
    expect(src).toMatch(/undelivered: requested/);
  });

  it('reports everyone unreached on each early return', () => {
    for (const bail of ['dry-run', 'no secret']) {
      expect(
        src,
        `the "${bail}" bail must go through nobodyReached(), not return a bare { sent: 0 }`,
      ).toContain(`nobodyReached('${bail}')`);
    }
  });

  it('returns delivered/undelivered from the successful path too', () => {
    expect(src).toMatch(/undelivered = requested\.filter\(/);
    expect(src).toMatch(/delivered: \[\.\.\.delivered\]/);
  });

  it('the route reports per-franchise delivery', () => {
    const route = read('src/pages/api/cron/push-fanout.ts');
    expect(route).toContain('delivered');
    expect(route).toContain('undelivered');
    // A franchise reached by ANY notification in the batch is reached, full
    // stop — otherwise one missed post in a multi-touch batch names an owner
    // whose phone did buzz.
    expect(route).toMatch(/undelivered.*filter\(\(id\) => !delivered\.includes\(id\)\)/s);
  });
});

describe('the chat lanes ask who was unreached before they post', () => {
  it('the lineup warning filters its chat post by the fan-out result', () => {
    const src = read('scripts/schefter-lineup-check.mjs');
    expect(src).toMatch(/const push = await sendPushFanout\(/);
    expect(src).toMatch(/push\.undelivered/);
    // No unreached owner must mean no post, not an empty-bodied one.
    expect(src).toMatch(/if \(unreached\.length === 0\)/);
    expect(src).toContain('buildFallbackPost');
  });

  it("Roger's day-of touch posts only when someone was unreached", () => {
    const src = read('scripts/schefter-scan.mjs');
    expect(src).toMatch(/unreachedIds = new Set\(push\.undelivered/);
    expect(src).toMatch(/if \(unreachedIds\.size === 0\)/);
    expect(src).toContain('buildFallbackPost');
  });

  it('a league-audience deadline still announces in season, once, a week out', () => {
    const src = read('scripts/schefter-scan.mjs');
    // The trade deadline is a signal to the ROOM — get your offers in — not an
    // obligation on any one owner, so a private push to each of them is the
    // wrong shape and the in-season silence rule does not apply to it.
    expect(src).toContain("LEAGUE_ANNOUNCE_TOUCH = '7d'");
    expect(src).toMatch(/event\.audience === 'league'/);
    expect(src).toMatch(/meta\.isAnnounce && \(meta\.leagueAudience \|\| !inSeason\)/);
  });

  it('both leagues mark their trade deadline as league-audience', () => {
    for (const file of [
      'src/data/theleague/resolved-events.json',
      'data/afl-fantasy/resolved-events.json',
    ]) {
      const { events } = JSON.parse(read(file));
      const deadline = events.find((e: { id: string }) => /trade|trading/.test(e.id));
      expect(deadline, `${file} has no trade deadline event`).toBeTruthy();
      // The resolver has to CARRY the flag, not just accept it in the source
      // list — the scanner reads this file, not compute-league-events.mjs.
      expect(deadline.audience, `${file}: trade deadline lost its audience flag`).toBe('league');
    }
  });

  it("Throwback Week announces on the Tuesday that opens the NFL week", () => {
    // The requirement is "Tuesday", but nothing in the code says Tuesday — it
    // says '2d'. That only lands on Tuesday because an NFL week is anchored to
    // its Thursday kickoff, which is a fact about getNflWeekStart, not about
    // this event. So assert the DAY, from the real resolved dates: if the
    // anchor ever moves, the post silently drifts to another weekday and no
    // other test would notice.
    for (const file of [
      'src/data/theleague/resolved-events.json',
      'data/afl-fantasy/resolved-events.json',
    ]) {
      const { events } = JSON.parse(read(file));
      const throwback = events.filter((e: { id: string }) => e.id.startsWith('throwback-week-'));
      expect(throwback.length, `${file} has no throwback event`).toBeGreaterThan(0);
      for (const e of throwback) {
        expect(e.audience, `${e.id} must post league-wide`).toBe('league');
        expect(e.announceTouch, `${e.id} must announce two days out`).toBe('2d');
        const fires = new Date(new Date(e.startDate).getTime() - 2 * 86_400_000);
        expect(
          fires.getUTCDay(),
          `${e.id}: the 2d touch fires ${fires.toISOString().slice(0, 10)}, not a Tuesday`,
        ).toBe(2);
      }
    }
  });

  it('honours a per-event announce touch, defaulting to a week out', () => {
    const src = read('scripts/schefter-scan.mjs');
    expect(src).toMatch(/event\.announceTouch \?\? LEAGUE_ANNOUNCE_TOUCH/);
  });

  it('the throwback tally reports both halves, from one Redis pass', () => {
    const src = read('scripts/schefter-scan.mjs');
    // picked AND total, not just the leftover count — the post goes to the
    // whole room, so the outstanding group needs a denominator.
    expect(src).toMatch(/return \{ total: franchiseIds\.length, picked: franchiseIds\.length - defaults, defaults \}/);
    expect(src).toMatch(/pickedCount: counts\?\.picked/);
    expect(src).toMatch(/totalCount: counts\?\.total/);
  });

  it('never marks an event league-audience that cannot reach its announce touch', () => {
    // A touch only fires for events whose tier qualifies for it. Mark an event
    // league-audience with an announce touch its tier cannot reach and the
    // loop simply never gets there: no post, no error, no way to tell from the
    // log that the flag did nothing.
    const RANK: Record<string, number> = { major: 3, standard: 2, minor: 1 };
    const MIN_TIER: Record<string, string> = {
      '14d': 'major',
      '7d': 'standard',
      '2d': 'major',
      dayof: 'minor',
    };
    for (const file of [
      'src/data/theleague/resolved-events.json',
      'data/afl-fantasy/resolved-events.json',
    ]) {
      const { events } = JSON.parse(read(file));
      const stranded = events
        .filter((e: { audience?: string }) => e.audience === 'league')
        .filter((e: { tier: string; announceTouch?: string }) => {
          const touch = e.announceTouch ?? '7d';
          return (RANK[e.tier] ?? 0) < (RANK[MIN_TIER[touch]] ?? 99);
        })
        .map((e: { id: string; tier: string; announceTouch?: string }) =>
          `${e.id} (${e.tier} cannot reach ${e.announceTouch ?? '7d'})`,
        );
      expect(
        stranded,
        `${file}: raise the tier or change the announce touch — this event can never announce`,
      ).toEqual([]);
    }
  });

  it("Roger's mid-flight touches never reach the chat", () => {
    const src = read('scripts/schefter-scan.mjs');
    // Only two lanes may post: the announce touch, and the day-of fallback.
    // Anything else logs and continues.
    expect(src).toMatch(/push only\$\{inSeason \? ' \(in season\)' : ''\}/);
    // The 14d and 2d touches have no lane of their own in either direction.
    expect(src).not.toMatch(/touchId === '14d'|touchId === '2d'/);
  });

  it('the trade lanes reach the chat, governed by their own budget', () => {
    // These promote trading, which only works in the room where trades get
    // talked about. They are not reminders competing with the league's
    // chatter — they are the chatter.
    expect(PUSH_ONLY_KINDS.has('rumor')).toBe(false);
    expect(PUSH_ONLY_KINDS.has('trade-speculation')).toBe(false);
    expect(OWN_BUDGET_KINDS.has('rumor')).toBe(true);
    expect(OWN_BUDGET_KINDS.has('trade-speculation')).toBe(true);
    // They skip the weekday calendar — a rumor held until its assigned day is
    // not a rumor any more.
    expect(bypassesDayCap('rumor')).toBe(true);
    expect(isPlannedToday('rumor', new Date('2026-11-16T18:00:00Z'))).toBe(true);
  });

  it('the transaction firehose stays out of the chat', () => {
    // Every add, drop and waiver claim, scanned every 15 minutes. This is the
    // lane that got the chat muted in the first place.
    expect(PUSH_ONLY_KINDS.has('transaction')).toBe(true);
    expect(OWN_BUDGET_KINDS.has('transaction')).toBe(false);
  });

  it('an own-budget kind never claims or releases the day', () => {
    // Claiming would spend the league's one calendar slot on a rumor and
    // silence that day's column; releasing would hand back a slot it never
    // took. Both gates must use the wider predicate.
    const src = read('scripts/lib/groupme-capped.mjs');
    expect(src).toMatch(/if \(!bypassesDayCap\(kind\)\) \{/);
    expect(src).toMatch(/!result\.posted && !bypassesDayCap\(kind\)/);
    expect(src, 'the narrow isExempt check must not survive here').not.toMatch(
      /if \(!isExempt\(kind\)\)/,
    );
  });

  it('speculation asks the shared budget and consumes a slot', () => {
    const src = read('scripts/lib/speculation-groupme.mjs');
    // Two lanes, ONE budget. A post that does not consume its slot lets the
    // rumor mill believe it still has the full three.
    expect(src).toMatch(/evaluatePingWindow/);
    expect(src).toMatch(/await verdict\.consume\?\.\(\)/);
    // Fails closed: posting blind is how an uncapped lane happens.
    expect(src).toMatch(/no Redis — cannot check the trade budget/);
  });

  it('speculation actually reaches phones now', () => {
    const src = read('scripts/schefter-trade-speculation.mjs');
    // It had no push route at all — a daily job publishing into silence.
    expect(src).toMatch(/sendPushFanout\(/);
    expect(src).toMatch(/category: 'rumor'/);
  });

  it('the fallback kinds stay exempt from the one-post-a-day cap', () => {
    // They are already the narrowest message we can send — held, and the
    // specific owners who have no other channel hear about the deadline
    // nowhere at all.
    expect(EXEMPT_KINDS.has('roger-fallback')).toBe(true);
    expect(EXEMPT_KINDS.has('lineup-deadline')).toBe(true);
  });
});

describe('"in season" is the opener, not the calendar month', () => {
  const inSeason = (iso: string) => {
    const now = new Date(iso);
    const year = now.getUTCFullYear();
    return isSeasonWindowOpen(year, now) || isSeasonWindowOpen(year - 1, now);
  };

  it('is closed on the Sunday before the opener — the run that shipped the bug', () => {
    // 2026-09-06: Labor Day is Sept 7, week 1 kicks off Thursday Sept 10.
    // The month check called this in-season and posted to both leagues.
    expect(inSeason('2026-09-06T18:16:00Z')).toBe(false);
  });

  it('is open on the first Sunday of week 1', () => {
    expect(inSeason('2026-09-13T16:15:00Z')).toBe(true);
  });

  it('is still open in January and shut by February', () => {
    expect(inSeason('2026-01-11T17:15:00Z')).toBe(true);
    expect(inSeason('2026-02-15T17:15:00Z')).toBe(false);
  });

  it('holds for a year whose Labor Day falls differently', () => {
    // 2027: Labor Day Sept 6, opener Thursday Sept 9.
    expect(inSeason('2027-09-05T16:15:00Z')).toBe(false);
    expect(inSeason('2027-09-12T16:15:00Z')).toBe(true);
  });

  it('no reminder lane still gates on the calendar month', () => {
    for (const file of ['scripts/schefter-lineup-check.mjs', 'scripts/schefter-scan.mjs']) {
      expect(read(file), `${file} must gate on isSeasonWindowOpen, not the month`).not.toMatch(
        /month >= 9 \|\| month === 1/,
      );
    }
  });
});
