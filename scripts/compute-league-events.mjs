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

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputPath = path.join(projectRoot, 'src', 'data', 'theleague', 'resolved-events.json');

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

// ── Resolve dates ──

function resolveEvents(year) {
  const now = new Date();

  // NFL Draft date — try to read from league-year-config if it exists
  let nflDraftDate = getNthDayOfMonth(year, 3, 4, 4); // default: 4th Thursday of April

  return EVENTS.map(event => {
    let startDate;

    if (event.startRule.type === 'fixed') {
      startDate = new Date(year, event.startRule.month - 1, event.startRule.day);
    } else if (event.startRule.type === 'computed') {
      if (event.startRule.rule === 'rookie-draft') {
        // Saturday after next week post-NFL Draft
        const dayOfWeek = nflDraftDate.getDay();
        const daysUntilNextSaturday = (6 - dayOfWeek + 7) % 7 + 7;
        startDate = new Date(nflDraftDate.getFullYear(), nflDraftDate.getMonth(), nflDraftDate.getDate() + daysUntilNextSaturday);
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

const resolved = resolveEvents(year);
const output = {
  computedAt: now.toISOString(),
  leagueYear: year,
  events: resolved,
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(`Resolved ${resolved.length} events for ${year}:`);
resolved.forEach(e => {
  const status = e.isPast ? '(past)' : `${e.daysUntil}d away`;
  console.log(`  ${e.id}: ${new Date(e.startDate).toLocaleDateString()} — ${status} [${e.tier}]`);
});
