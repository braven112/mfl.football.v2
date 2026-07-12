#!/usr/bin/env node
/**
 * Compute League Events
 *
 * Resolves all league event definitions into concrete dates for the current year.
 * Outputs a JSON file that the schefter scanner can read without importing TypeScript.
 *
 * Run: node scripts/compute-league-events.mjs
 * Output: src/data/theleague/resolved-events.json
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calendarDaysUntil } from './lib/roger-reminder-window.mjs';
import {
  getNflWeekStart,
  parseThrowbackWeeks,
  throwbackEventId,
  DEFAULT_THROWBACK_WEEKS,
} from './lib/throwback-reminder.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputPath = path.join(projectRoot, 'src', 'data', 'theleague', 'resolved-events.json');
const aflOutputPath = path.join(projectRoot, 'data', 'afl-fantasy', 'resolved-events.json');

// ── Date computation (mirrors league-event-resolver.ts) ──

function getNthDayOfMonth(year, month, dayOfWeek, nth) {
  const first = new Date(year, month, 1);
  const firstDow = first.getDay();
  let diff = dayOfWeek - firstDow;
  if (diff < 0) diff += 7;
  return new Date(year, month, 1 + diff + (nth - 1) * 7);
}

function getLaborDay(year) {
  return getNthDayOfMonth(year, 8, 1, 1); // September, Monday, 1st
}

function resolveDate(rule, year) {
  switch (rule) {
    case 'third-thursday-march': return getNthDayOfMonth(year, 2, 4, 3);
    case 'third-sunday-august': return getNthDayOfMonth(year, 7, 0, 3);
    case 'nfl-kickoff': {
      const ld = getLaborDay(year);
      return new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() + 3);
    }
    case 'friday-before-week-11': {
      const ld = getLaborDay(year);
      const kickoff = new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() + 3);
      return new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate() + 10 * 7 - 6);
    }
    case 'wednesday-before-week-11': {
      // AFL trade deadline: Wednesday between Week 10 and Week 11 = friday-before-week-11 minus 2 days
      const ld = getLaborDay(year);
      const kickoff = new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() + 3);
      return new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate() + 10 * 7 - 8);
    }
    case 'after-week-16': {
      const ld = getLaborDay(year);
      const kickoff = new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() + 3);
      return new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate() + 16 * 7);
    }
    case 'playoffs-start': {
      const ld = getLaborDay(year);
      const kickoff = new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() + 3);
      return new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate() + 14 * 7);
    }
    case 'championship-week': {
      const ld = getLaborDay(year);
      const kickoff = new Date(ld.getFullYear(), ld.getMonth(), ld.getDate() + 3);
      return new Date(kickoff.getFullYear(), kickoff.getMonth(), kickoff.getDate() + 16 * 7);
    }
    case 'second-sunday-february':
      // Super Bowl Sunday (AFL IR-to-active deadline). NFL moved to 2nd Sunday in Feb starting 2022.
      return getNthDayOfMonth(year, 1, 0, 2);
    default: return new Date(year, 0, 1);
  }
}

// ── Event definitions (mirrors league-events.ts) ──

const EVENTS = [
  { id: 'team-purchase-deadline', name: 'Team Purchase Deadline', startRule: { type: 'fixed', month: 2, day: 1 }, tier: 'minor' },
  { id: 'tagging-period', name: 'Tagging Period', startRule: { type: 'fixed', month: 2, day: 1 }, tier: 'minor' },
  { id: 'last-day-release', name: 'Last Day to Release Players', startRule: { type: 'fixed', month: 2, day: 14 }, tier: 'minor' },
  { id: 'new-season-starts', name: 'New Season Starts', startRule: { type: 'fixed', month: 2, day: 15 }, tier: 'standard' },
  { id: 'tag-offer-period', name: 'Offer Period on Tagged Players', startRule: { type: 'fixed', month: 2, day: 15 }, tier: 'minor' },
  { id: 'tag-matching-period', name: 'Tag Matching Period', startRule: { type: 'fixed', month: 3, day: 1 }, tier: 'minor' },
  { id: 'offseason-fa-opens', name: 'Offseason Free Agency Opens', startRule: { type: 'computed', rule: 'third-thursday-march' }, tier: 'major' },
  { id: 'nfl-draft', name: 'NFL Draft', startRule: { type: 'fixed', month: 4, day: 23 }, tier: 'standard' },
  { id: 'rookie-draft', name: 'Rookie Draft', startRule: { type: 'computed', rule: 'rookie-draft' }, tier: 'major' },
  { id: 'declare-rookie-contracts', name: 'Declare Contracts / Cut to 22', startRule: { type: 'computed', rule: 'third-sunday-august' }, tier: 'standard' },
  { id: 'offseason-fa-closes', name: 'Offseason FA Closes', startRule: { type: 'computed', rule: 'third-sunday-august' }, tier: 'standard' },
  { id: 'nfl-season-starts', name: 'NFL Season Starts', startRule: { type: 'computed', rule: 'nfl-kickoff' }, tier: 'standard' },
  { id: 'trading-deadline', name: 'Trading Deadline', startRule: { type: 'computed', rule: 'friday-before-week-11' }, tier: 'major' },
  { id: 'in-season-fa-ends', name: 'In-Season FA Ends', startRule: { type: 'computed', rule: 'after-week-16' }, tier: 'minor' },
  { id: 'playoffs-start', name: 'Playoffs Begin', startRule: { type: 'computed', rule: 'playoffs-start' }, tier: 'major' },
  { id: 'league-championship', name: 'League Championship', startRule: { type: 'computed', rule: 'championship-week' }, tier: 'major' },
];

// ── Throwback Week events (TheLeague only) ──
// The week number lives in src/data/theleague/throwback-config.ts
// (THROWBACK_WEEKS) — single source of truth. We parse it out of the TS
// source rather than duplicating the number here; if the parse ever fails we
// warn and fall back to DEFAULT_THROWBACK_WEEKS. The DATE is computed, never
// hardcoded: NFL Week N starts kickoff Thursday + (N-1)*7 days (see
// scripts/lib/throwback-reminder.mjs). tier: major → full 14d/7d/2d/day-of
// Roger touch schedule.

async function loadThrowbackEvents() {
  const configPath = path.join(projectRoot, 'src', 'data', 'theleague', 'throwback-config.ts');
  let weeks = null;
  try {
    weeks = parseThrowbackWeeks(await fs.readFile(configPath, 'utf8'));
  } catch (err) {
    console.warn(`Could not read throwback-config.ts (${err.message})`);
  }
  if (!weeks) {
    console.warn(`THROWBACK_WEEKS parse failed — falling back to [${DEFAULT_THROWBACK_WEEKS}]`);
    weeks = DEFAULT_THROWBACK_WEEKS;
  }
  return weeks.map(week => ({
    id: throwbackEventId(week),
    name: `Throwback Week (NFL Week ${week})`,
    startRule: { type: 'computed', rule: 'nfl-week-start', week },
    tier: 'major',
  }));
}

// ── AFL Fantasy event definitions ──
// Sourced from docs/claude/afl-rules.md "Important Dates" + src/data/afl-fantasy/league-events.json.
// Tier policy mirrors TheLeague: major = 14d/7d/2d/day-of touches, standard = 7d/day-of, minor = day-of only.

const AFL_EVENTS = [
  { id: 'afl-league-dues', name: 'AFL League Dues', startRule: { type: 'fixed', month: 4, day: 1 }, tier: 'major' },
  { id: 'afl-keeper-deadline', name: 'AFL Keeper Deadline', startRule: { type: 'fixed', month: 7, day: 15 }, tier: 'major' },
  { id: 'afl-trade-deadline', name: 'AFL Trade Deadline', startRule: { type: 'computed', rule: 'wednesday-before-week-11' }, tier: 'major' },
  { id: 'afl-draft-window-opens', name: 'AFL Annual Draft Window', startRule: { type: 'fixed', month: 8, day: 20 }, tier: 'major' },
  { id: 'afl-ir-deadline', name: 'AFL IR-to-Active Deadline', startRule: { type: 'computed', rule: 'second-sunday-february' }, tier: 'standard' },
  { id: 'afl-nfl-season-starts', name: 'NFL Season Starts', startRule: { type: 'computed', rule: 'nfl-kickoff' }, tier: 'standard' },
];

// ── Resolve dates ──

function resolveEvents(year, eventList = EVENTS) {
  const now = new Date();

  // NFL Draft date — try to read from league-year-config if it exists
  let nflDraftDate = getNthDayOfMonth(year, 3, 4, 4); // default: 4th Thursday of April

  return eventList.map(event => {
    let startDate;

    if (event.startRule.type === 'fixed') {
      startDate = new Date(year, event.startRule.month - 1, event.startRule.day);
    } else if (event.startRule.type === 'computed') {
      if (event.startRule.rule === 'rookie-draft') {
        // Saturday after next week post-NFL Draft
        const dayOfWeek = nflDraftDate.getDay();
        const daysUntilNextSaturday = (6 - dayOfWeek + 7) % 7 + 7;
        startDate = new Date(nflDraftDate.getFullYear(), nflDraftDate.getMonth(), nflDraftDate.getDate() + daysUntilNextSaturday);
      } else if (event.startRule.rule === 'nfl-week-start') {
        // Computed NFL week start (e.g. Throwback Week): kickoff Thursday
        // + (week-1)*7 — never a hardcoded calendar date.
        startDate = getNflWeekStart(year, event.startRule.week);
      } else {
        startDate = resolveDate(event.startRule.rule, year);
      }
    }

    const daysUntil = calendarDaysUntil(startDate, now);
    const isPast = daysUntil < -1; // Allow day-of posts

    return {
      id: event.id,
      name: event.name,
      tier: event.tier,
      startDate: startDate.toISOString(),
      daysUntil,
      isPast,
    };
  });
}

// ── Main ──

const now = new Date();
const year = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;

const throwbackEvents = await loadThrowbackEvents();
const resolved = resolveEvents(year, [...EVENTS, ...throwbackEvents]);
const output = {
  computedAt: now.toISOString(),
  leagueYear: year,
  events: resolved,
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Resolved ${resolved.length} TheLeague events for ${year}:`);
resolved.forEach(e => {
  const status = e.isPast ? '(past)' : `${e.daysUntil}d away`;
  console.log(`  ${e.id}: ${new Date(e.startDate).toLocaleDateString()} — ${status} [${e.tier}]`);
});

// AFL — emit a parallel resolved-events.json so the schefter scanner's Roger
// reminders fire on AFL deadlines using the same touch logic.
const aflResolved = resolveEvents(year, AFL_EVENTS);
const aflOutput = {
  computedAt: now.toISOString(),
  leagueYear: year,
  events: aflResolved,
};
await fs.mkdir(path.dirname(aflOutputPath), { recursive: true });
await fs.writeFile(aflOutputPath, JSON.stringify(aflOutput, null, 2) + '\n');
console.log(`\nResolved ${aflResolved.length} AFL events for ${year}:`);
aflResolved.forEach(e => {
  const status = e.isPast ? '(past)' : `${e.daysUntil}d away`;
  console.log(`  ${e.id}: ${new Date(e.startDate).toLocaleDateString()} — ${status} [${e.tier}]`);
});
