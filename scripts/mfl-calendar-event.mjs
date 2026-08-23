#!/usr/bin/env node
/**
 * Put Schedule Release Day on the MFL league calendar.
 *
 * ONE THING TO KNOW BEFORE USING THIS. MFL's `import?TYPE=calendarEvent` takes
 * exactly five parameters — L, EVENT_TYPE, START_TIME, END_TIME, HAPPENS —
 * and NONE of them is a title or a description. A CUSTOM event therefore
 * lands on the calendar as a dated marker with whatever label MFL chooses for
 * it, not "Schedule Release". That is an API limitation, not an oversight
 * here, and it is why this script is deliberately NOT wired into the release
 * cron: run it once by hand, look at what MFL actually renders, and decide
 * whether an unlabeled marker is worth having.
 *
 * The script sends a DESCRIPTION field anyway, on the chance MFL accepts an
 * undocumented one. MFL ignores unknown parameters silently, so this is free
 * to try and proves nothing on its own — which is exactly why the raw response
 * is printed rather than summarised.
 *
 * COMMISSIONER WRITES have two requirements that differ from reads
 * (docs/claude/insights/domains/mfl-api.md, 2026-03-13):
 *   1. The league's own www## host. api.myfantasyleague.com rejects
 *      commissioner imports with "API requires commissioner access".
 *   2. BOTH cookies: MFL_USER_ID and MFL_IS_COMMISH. The second is set by
 *      MFL's commissioner login flow and is easy to miss when copying.
 *
 * Environment:
 *   MFL_USER_ID       required — commissioner session cookie
 *   MFL_IS_COMMISH    required — commissioner privilege cookie
 *   MFL_WRITE_HOST    optional — override the write host
 *
 * Usage:
 *   node scripts/mfl-calendar-event.mjs --league=theleague --dry-run
 *   node scripts/mfl-calendar-event.mjs --league=theleague
 */
import { LEAGUES, defaultMflWriteHost } from '../src/config/leagues-data.mjs';
import { scheduleReleaseDate } from '../src/utils/schedule-release.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const dryRun = process.argv.includes('--dry-run');

const slug = arg('league', 'theleague');
const league = LEAGUES[slug];
if (!league) {
  console.error(`Unknown league: ${slug}`);
  process.exit(1);
}

const year = Number(arg('year', new Date().getUTCFullYear()));
const date = scheduleReleaseDate(slug, year);
if (!date) {
  console.error(`No schedule-release date configured for ${slug}.`);
  process.exit(1);
}

// The reveal fires at 9am PT; put the calendar marker at the same moment so the
// calendar and the page agree. 16:00 UTC is 9am PDT — the release dates for
// both leagues fall inside daylight time, so no winter offset case exists.
const start = new Date(date);
start.setUTCHours(16, 0, 0, 0);
const startUnix = Math.floor(start.getTime() / 1000);

// Writes go to the league's own host, never the api gateway.
const host = process.env.MFL_WRITE_HOST || `https://${league.mflHost}`;
// END_TIME and HAPPENS are not optional — this endpoint takes exactly five
// parameters and omitting two of them is a rejected write. MFL returns its
// errors at HTTP 200, so a call missing them looks EXACTLY like a successful
// one from the response status; the omission was invisible until the header's
// own parameter list was read back against the request.
// A release marker is a single all-day-ish point in time, so the event ends
// where it starts and never repeats.
const params = new URLSearchParams({
  L: league.id,
  EVENT_TYPE: 'CUSTOM',
  START_TIME: String(startUnix),
  END_TIME: String(startUnix),
  HAPPENS: 'ONCE',
  // Undocumented. Sent on the chance MFL honours it; ignored silently if not.
  DESCRIPTION: `${league.name} Schedule Release`,
});
const url = `${host}/${year}/import?TYPE=calendarEvent&${params}`;

console.log(`\n${league.name} — Schedule Release calendar event`);
console.log(`  date:  ${start.toISOString()} (${startUnix})`);
console.log(`  host:  ${host}`);

if (dryRun) {
  console.log(`  [dry run] would POST ${url}`);
  process.exit(0);
}

const userId = process.env.MFL_USER_ID;
const isCommish = process.env.MFL_IS_COMMISH;
if (!userId || !isCommish) {
  console.error(
    '\nBoth MFL_USER_ID and MFL_IS_COMMISH must be set. A commissioner write with only\n' +
      'MFL_USER_ID is rejected — MFL_IS_COMMISH is set separately by the commissioner\n' +
      'login flow and is the one usually missed when copying cookies.',
  );
  process.exit(1);
}

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Cookie: `MFL_USER_ID=${userId}; MFL_IS_COMMISH=${isCommish}`,
    'User-Agent': 'mfl.football schedule release',
  },
});
const body = await res.text();

// Printed raw and in full. MFL answers errors with HTTP 200 and an error
// payload, so the status alone proves nothing — and the open question this
// script exists to settle (does the event get a usable label?) is only
// answerable by looking at the calendar afterwards.
console.log(`\n  HTTP ${res.status}`);
console.log(`  ${body.trim()}`);
console.log(
  `\nNow open the league calendar and check what the event is CALLED. MFL's API has\n` +
    `no title parameter, so it may show as an unlabeled custom event — if it does,\n` +
    `an owner cannot tell what it is for, and it is probably not worth keeping.`,
);
if (/error/i.test(body)) process.exitCode = 1;
