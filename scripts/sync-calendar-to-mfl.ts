/**
 * MFL Calendar Sync Script
 *
 * Pushes league calendar events from our app to MFL's calendar API.
 * Our app (league-events.ts) is the source of truth for all dates.
 *
 * YEARLY WORKFLOW (after new MFL league created ~Feb 14):
 * 1. pnpm sync:calendar                        → dry-run, preview what will be posted
 * 2. pnpm sync:calendar -- --read-only          → see what MFL currently has
 * 3. Clear MFL calendar in admin UI (no delete API exists)
 * 4. pnpm sync:calendar -- --live                → push events to MFL
 * 5. pnpm sync:calendar -- --read-only           → validate the push
 *
 * Usage:
 *   npx tsx scripts/sync-calendar-to-mfl.ts [options]
 *
 * Options:
 *   --year=YYYY    Target league year (default: current league year)
 *   --dry-run      Preview what would be posted (default)
 *   --live         Actually POST events to MFL
 *   --read-only    Just read and display MFL's current calendar
 */

import { resolveAllEvents, getNthDayOfMonth } from '../src/utils/league-event-resolver';
import { THE_LEAGUE_EVENTS } from '../src/data/theleague/league-events';
import type { ResolvedLeagueEvent, LinkTemplateVars } from '../src/types/league-events';

// ── Config ──────────────────────────────────────────────────────────────────

const MFL_HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';
const MFL_LEAGUE_ID = process.env.MFL_LEAGUE_ID || '13522';
const MFL_COMMISSIONER_COOKIE = process.env.MFL_COMMISSIONER_COOKIE || '';

// ── League Year (standalone, no Astro env dependency) ───────────────────────

/**
 * Calculate current league year without Astro's import.meta.env.
 * Mirrors the logic in src/utils/league-year.ts:
 * - Base year = calendar year if after Labor Day, else previous year
 * - League year = base year + 1 if after Feb 14 cutoff
 */
function calcCurrentLeagueYear(): number {
  const now = new Date();
  const calendarYear = now.getFullYear();
  // Labor Day = 1st Monday in September
  const laborDay = getNthDayOfMonth(calendarYear, 8, 1, 1);
  const baseYear = now >= laborDay ? calendarYear : calendarYear - 1;

  // Feb 14 @ 8:45 PM PST = Feb 15 04:45 UTC
  const febCutoff = new Date(Date.UTC(now.getFullYear(), 1, 15, 4, 45, 0, 0));
  return now >= febCutoff ? baseYear + 1 : baseYear;
}

// ── CLI Arg Parsing ─────────────────────────────────────────────────────────

interface CliOptions {
  year: number;
  mode: 'dry-run' | 'live' | 'read-only';
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let year: number | undefined;
  let mode: CliOptions['mode'] = 'dry-run';

  for (const arg of args) {
    if (arg.startsWith('--year=')) {
      year = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--live') {
      mode = 'live';
    } else if (arg === '--read-only') {
      mode = 'read-only';
    } else if (arg === '--dry-run') {
      mode = 'dry-run';
    }
  }

  return {
    year: year || calcCurrentLeagueYear(),
    mode,
  };
}

// ── Date Helpers ────────────────────────────────────────────────────────────

/** Convert a Date to Unix timestamp in seconds (what MFL expects) */
function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Format a Date for display */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Pad a string to a fixed width */
function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str + ' '.repeat(width - str.length);
}

// ── MFL API ─────────────────────────────────────────────────────────────────

function requireAuth(): void {
  if (!MFL_COMMISSIONER_COOKIE) {
    console.error('\n✗ MFL_COMMISSIONER_COOKIE environment variable is not set.');
    console.error('  Set it before running this script:');
    console.error('  export MFL_COMMISSIONER_COOKIE="your-cookie-value"\n');
    process.exit(1);
  }
}

/** Read MFL's current calendar entries */
async function readMFLCalendar(year: number): Promise<unknown> {
  requireAuth();

  const url = `${MFL_HOST}/${year}/export?TYPE=calendar&L=${MFL_LEAGUE_ID}&JSON=1`;
  console.log(`\nFetching MFL calendar: ${url}\n`);

  const response = await fetch(url, {
    headers: {
      Cookie: `MFL_USER_ID=${MFL_COMMISSIONER_COOKIE}`,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    console.error(`✗ Failed to read MFL calendar: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error(`  Response: ${text.slice(0, 500)}`);
    return null;
  }

  const contentType = response.headers.get('content-type') || '';

  // MFL might return JSON or ICS depending on the endpoint
  if (contentType.includes('json') || contentType.includes('javascript')) {
    const data = await response.json();
    console.log('MFL Calendar (JSON):');
    console.log(JSON.stringify(data, null, 2));
    return data;
  } else {
    const text = await response.text();
    console.log('MFL Calendar (raw):');
    console.log(text.slice(0, 3000));
    if (text.length > 3000) {
      console.log(`\n... (${text.length - 3000} more characters)`);
    }
    return text;
  }
}

interface MFLCalendarEventPayload {
  eventName: string;
  eventType: string;
  startTime: number;
  endTime: number;
}

/** POST a single calendar event to MFL */
async function postCalendarEvent(
  year: number,
  payload: MFLCalendarEventPayload,
): Promise<{ success: boolean; error?: string }> {
  const url = `${MFL_HOST}/${year}/import?TYPE=calendarEvent&L=${MFL_LEAGUE_ID}`;

  const body = new URLSearchParams({
    EVENT_TYPE: payload.eventType,
    START_TIME: payload.startTime.toString(),
    END_TIME: payload.endTime.toString(),
  });

  const delays = [1000, 3000, 9000];
  let lastError = '';

  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `MFL_USER_ID=${MFL_COMMISSIONER_COOKIE}`,
        },
        body: body.toString(),
        redirect: 'follow',
      });

      if (response.ok) {
        const text = await response.text();
        if (text.toLowerCase().includes('error')) {
          lastError = `MFL returned error: ${text.slice(0, 200)}`;
          console.error(`  ✗ Attempt ${attempt + 1} failed: ${lastError}`);
        } else {
          return { success: true };
        }
      } else {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        console.error(`  ✗ Attempt ${attempt + 1} failed: ${lastError}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Attempt ${attempt + 1} error: ${lastError}`);
    }

    if (attempt < delays.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  return { success: false, error: lastError };
}

// ── Core Logic ──────────────────────────────────────────────────────────────

function resolveEventsForYear(year: number): ResolvedLeagueEvent[] {
  const now = new Date();
  const linkVars: LinkTemplateVars = {
    mflHost: 'www49.myfantasyleague.com',
    year: year.toString(),
    prevYear: (year - 1).toString(),
    leagueId: MFL_LEAGUE_ID,
  };

  return resolveAllEvents(THE_LEAGUE_EVENTS, year, now, linkVars);
}

function buildPayloads(
  resolved: ResolvedLeagueEvent[],
): Array<{ event: ResolvedLeagueEvent; payload: MFLCalendarEventPayload }> {
  return resolved
    .filter((e) => e.definition.mflSync)
    .map((e) => ({
      event: e,
      payload: {
        eventName: e.definition.mflSync!.title || e.definition.name,
        eventType: e.definition.mflSync!.eventType,
        startTime: toUnixSeconds(e.startDate),
        endTime: toUnixSeconds(e.endDate),
      },
    }));
}

function printDryRunTable(
  items: Array<{ event: ResolvedLeagueEvent; payload: MFLCalendarEventPayload }>,
  year: number,
  isLive: boolean,
): void {
  const label = isLive ? 'LIVE' : 'DRY RUN';
  console.log(`\nMFL Calendar Sync — ${year} (${label})`);
  console.log('━'.repeat(100));
  console.log(
    `${pad('Event', 35)} ${pad('MFL Type', 16)} ${pad('Start', 28)} ${pad('End', 28)}`,
  );
  console.log(
    `${'─'.repeat(35)} ${'─'.repeat(16)} ${'─'.repeat(28)} ${'─'.repeat(28)}`,
  );

  for (const { event, payload } of items) {
    const name = payload.eventName;
    const type = payload.eventType;
    const start = formatDate(event.startDate);
    const end = formatDate(event.endDate);
    console.log(`${pad(name, 35)} ${pad(type, 16)} ${pad(start, 28)} ${pad(end, 28)}`);
  }

  console.log(`\n${items.length} event(s) total.`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { year, mode } = parseArgs();

  console.log(`\nMFL Calendar Sync`);
  console.log(`League: ${MFL_LEAGUE_ID} | Year: ${year} | Mode: ${mode}`);

  // Read-only mode: just fetch and display MFL's calendar
  if (mode === 'read-only') {
    await readMFLCalendar(year);
    return;
  }

  // Resolve events and build payloads
  const resolved = resolveEventsForYear(year);
  const items = buildPayloads(resolved);

  if (items.length === 0) {
    console.log('\nNo events with mflSync configured. Nothing to do.');
    return;
  }

  // Print the table
  printDryRunTable(items, year, mode === 'live');

  // Dry-run: stop here
  if (mode === 'dry-run') {
    console.log('\nThis was a dry run. Run with --live to push to MFL.');
    return;
  }

  // Live mode: POST each event
  requireAuth();
  console.log('\nPushing events to MFL...\n');

  let successes = 0;
  let failures = 0;

  for (const { payload } of items) {
    const name = payload.eventName;
    process.stdout.write(`  ${pad(name, 35)} `);

    const result = await postCalendarEvent(year, payload);
    if (result.success) {
      console.log('✓');
      successes++;
    } else {
      console.log(`✗ ${result.error}`);
      failures++;
    }

    // Small delay between requests to be polite to MFL
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`\nResults: ${successes} succeeded, ${failures} failed`);

  // Validate by reading back
  if (successes > 0) {
    console.log('\n── Validation ──────────────────────────────────────────');
    console.log('Reading MFL calendar to verify...');
    await readMFLCalendar(year);
  }
}

main().catch((error) => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
