/**
 * POST /api/admin/sync-calendar
 *
 * Calendar sync API for the admin page.
 * Requires commissioner or admin role.
 *
 * Actions:
 *   preview - Resolve events and return payloads (no MFL calls)
 *   read    - Read MFL's current calendar
 *   sync    - POST events to MFL calendar API
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { resolveAllEvents } from '../../../utils/league-event-resolver';
import { THE_LEAGUE_EVENTS } from '../../../data/theleague/league-events';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import type { LinkTemplateVars } from '../../../types/league-events';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const MFL_HOST = import.meta.env.MFL_HOST || 'https://api.myfantasyleague.com';
const MFL_LEAGUE_ID = import.meta.env.MFL_LEAGUE_ID || '13522';
const MFL_COMMISSIONER_COOKIE = import.meta.env.MFL_COMMISSIONER_COOKIE || '';

interface SyncEvent {
  name: string;
  eventType: string;
  startDate: string;
  endDate: string;
  startUnix: number;
  endUnix: number;
}

interface SyncResult {
  name: string;
  success: boolean;
  error?: string;
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function buildPayloads(year: number): SyncEvent[] {
  const now = new Date();
  const linkVars: LinkTemplateVars = {
    mflHost: 'www49.myfantasyleague.com',
    year: year.toString(),
    prevYear: (year - 1).toString(),
    leagueId: MFL_LEAGUE_ID,
  };

  const resolved = resolveAllEvents(THE_LEAGUE_EVENTS, year, now, linkVars);

  return resolved
    .filter((e) => e.definition.mflSync)
    .map((e) => ({
      name: e.definition.mflSync!.title || e.definition.name,
      eventType: e.definition.mflSync!.eventType,
      startDate: e.startDate.toISOString(),
      endDate: e.endDate.toISOString(),
      startUnix: toUnixSeconds(e.startDate),
      endUnix: toUnixSeconds(e.endDate),
    }));
}

async function readMFLCalendar(year: number): Promise<unknown> {
  if (!MFL_COMMISSIONER_COOKIE) {
    throw new Error('MFL_COMMISSIONER_COOKIE is not configured on the server');
  }

  const url = `${MFL_HOST}/${year}/export?TYPE=calendar&L=${MFL_LEAGUE_ID}&JSON=1`;
  const response = await fetch(url, {
    headers: { Cookie: `MFL_USER_ID=${MFL_COMMISSIONER_COOKIE}` },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`MFL returned ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json') || contentType.includes('javascript')) {
    return response.json();
  }
  return { raw: (await response.text()).slice(0, 5000) };
}

async function postCalendarEvent(
  year: number,
  event: SyncEvent,
): Promise<SyncResult> {
  if (!MFL_COMMISSIONER_COOKIE) {
    return { name: event.name, success: false, error: 'MFL_COMMISSIONER_COOKIE not configured' };
  }

  const url = `${MFL_HOST}/${year}/import?TYPE=calendarEvent&L=${MFL_LEAGUE_ID}`;
  const body = new URLSearchParams({
    EVENT_TYPE: event.eventType,
    START_TIME: event.startUnix.toString(),
    END_TIME: event.endUnix.toString(),
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
        } else {
          return { name: event.name, success: true };
        }
      } else {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < delays.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  return { name: event.name, success: false, error: lastError };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: JSON_HEADERS },
      );
    }

    if (user.role !== 'commissioner' && user.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Commissioner or admin role required' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    const body = await request.json();
    const { action, year: requestedYear } = body as { action: string; year?: number };
    const year = requestedYear || getCurrentLeagueYear();

    if (action === 'preview') {
      const events = buildPayloads(year);
      return new Response(
        JSON.stringify({ action: 'preview', year, events }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    if (action === 'read') {
      const calendar = await readMFLCalendar(year);
      return new Response(
        JSON.stringify({ action: 'read', year, calendar }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    if (action === 'sync') {
      const events = buildPayloads(year);
      const results: SyncResult[] = [];

      for (const event of events) {
        const result = await postCalendarEvent(year, event);
        results.push(result);
        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success).length;

      return new Response(
        JSON.stringify({ action: 'sync', year, results, summary: { successes, failures, total: results.length } }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use "preview", "read", or "sync".' }),
      { status: 400, headers: JSON_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
