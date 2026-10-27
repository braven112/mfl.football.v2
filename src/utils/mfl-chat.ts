/**
 * An MFL league's own chat — the one on the league's MFL home page, not
 * GroupMe or Slack. Read and posted for the MFL Football app (package N).
 *
 * MFL HAS NO CHAT EXPORT. Its API reference says so in the `chat_save` entry
 * (probed live 2026-10-27, docs/claude/insights/domains/mfl-api.md):
 *
 *   - READ is a static file, `<host>/fflnetdynamic<year>/<league>_chat.xml`.
 *     It is public (same bytes with or without a cookie), XML only (`.json`
 *     is a 404), and a 404 when the league has never chatted.
 *   - POST is `chat_save` with `L` and `MESSAGE` (and an optional `TO_FID` for
 *     a private message, which this app does not send). It is one of MFL's
 *     "Misc" requests, a path of its own like `live_draft` and `login`, NOT an
 *     import type: `import?TYPE=chat_save` answers "Invalid Data Type
 *     (chat_save)", which is how the first production send failed. It must go
 *     to `api.myfantasyleague.com`; a league host answers "This API request
 *     must go to api.myfantasyleague.com".
 *
 * The file is `<messages><message id franchise_id message posted/>…</messages>`,
 * NEWEST FIRST, with the attributes in no fixed order. `posted` is a display
 * string in the league's zone ("Sat Aug 30 7:40:40 p.m. PT 2025"), which
 * `Date.parse` rejects, so `id` (16 characters, unique) is the only stable key.
 */

import { describeMflFailure, mflFetch } from './mfl-fetch';
import { readMflImportResult, type MflImportResult } from './mfl-import-result';

/** One chat message, oldest-first order once parsed. */
export interface MflChatMessage {
  /** MFL's own message id — the dedupe key for push alerts too. */
  id: string;
  /** 4-digit franchise id of the poster; '0000' is the commissioner. */
  franchiseId: string;
  text: string;
  /** MFL's own label, kept for display when `postedAt` can't be worked out. */
  postedLabel: string;
  /** ISO time, or null when the label is in a zone we can't place. */
  postedAt: string | null;
  /**
   * The one franchise a private message is for. No sample has carried one
   * (42 messages read 2026-10-27), so this is set only if MFL marks it with
   * a `to…` attribute; a reader must never show such a message to anyone else.
   */
  toFranchiseId?: string;
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

function decodeXmlAttr(text: string): string {
  // &amp; last, so "&amp;lt;" decodes to the literal "&lt;" and no further.
  return text
    .replace(/&(lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** MFL's zone labels → IANA zones. A label not here leaves `postedAt` null. */
const ZONES: Record<string, string> = {
  ET: 'America/New_York',
  CT: 'America/Chicago',
  MT: 'America/Denver',
  AZ: 'America/Phoenix',
  PT: 'America/Los_Angeles',
  AKT: 'America/Anchorage',
  HT: 'Pacific/Honolulu',
  GMT: 'UTC',
  UTC: 'UTC',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The zone's offset from UTC, in ms, at the instant `utcMs`. */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/**
 * "Sat Aug 30 7:40:40 p.m. PT 2025" → ISO, or null for anything else.
 * The wall time is in the named zone, DST included, so the offset is read
 * from the zone at that moment rather than assumed.
 */
export function parseMflChatPosted(label: string): string | null {
  const m = /^\s*\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([ap])\.?m\.?\s+([A-Z]+)\s+(\d{4})\s*$/i.exec(label);
  if (!m) return null;
  const [, mon, day, hour12, min, sec, ampm, zoneLabel, year] = m;
  const month = MONTHS.indexOf(mon[0].toUpperCase() + mon.slice(1).toLowerCase());
  const zone = ZONES[zoneLabel.toUpperCase()];
  if (month < 0 || !zone) return null;
  let hour = Number(hour12) % 12;
  if (ampm.toLowerCase() === 'p') hour += 12;
  const wall = Date.UTC(Number(year), month, Number(day), hour, Number(min), Number(sec));
  // Two passes: the first offset is read at a guess that may sit across a DST
  // change from the real instant; the second is read at the corrected one.
  let utc = wall - zoneOffsetMs(zone, wall);
  utc = wall - zoneOffsetMs(zone, utc);
  return Number.isFinite(utc) ? new Date(utc).toISOString() : null;
}

/** The chat file's messages, OLDEST first. Never throws; junk parses to []. */
export function parseMflChatXml(xml: string): MflChatMessage[] {
  const out: MflChatMessage[] = [];
  for (const m of `${xml ?? ''}`.matchAll(/<message\s([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1].toLowerCase()] = decodeXmlAttr(a[2]);
    const id = (attrs.id ?? '').trim();
    if (!id) continue;
    const franchiseId = (attrs.franchise_id ?? '').trim();
    const toKey = Object.keys(attrs).find((k) => /^to(_?f(ranchise)?_?id)?$/.test(k) || k === 'to_fid');
    const to = toKey ? attrs[toKey].trim() : '';
    const postedLabel = (attrs.posted ?? '').trim();
    out.push({
      id,
      franchiseId: /^\d+$/.test(franchiseId) ? franchiseId.padStart(4, '0') : franchiseId,
      text: attrs.message ?? '',
      postedLabel,
      postedAt: parseMflChatPosted(postedLabel),
      ...(to ? { toFranchiseId: /^\d+$/.test(to) ? to.padStart(4, '0') : to } : {}),
    });
  }
  // The file is newest-first; a chat reads oldest-first.
  return out.reverse();
}

/** Where a league's chat file lives. `host` is the league's own MFL host. */
export function mflChatFileUrl(host: string | null, year: number, leagueId: string): string | null {
  const base = (host ?? 'https://api.myfantasyleague.com').replace(/\/+$/, '');
  // The host came from MFL's `myleagues`, but it is still about to be
  // fetched server-side: only MFL's own hosts, only https.
  if (!/^https:\/\/[a-z0-9-]+\.myfantasyleague\.com$/i.test(base)) return null;
  if (!/^\d+$/.test(leagueId) || !Number.isInteger(year)) return null;
  return `${base}/fflnetdynamic${year}/${leagueId}_chat.xml`;
}

export type MflChatRead =
  | { ok: true; messages: MflChatMessage[] }
  | { ok: false; reason: 'unavailable' };

/**
 * A league's chat. A 404 is an empty chat, not an error: MFL only creates the
 * file at the first message. Anything else that isn't XML is `unavailable`,
 * so a throttled MFL (which answers with an HTML page) never reads as "no
 * messages".
 */
export async function readMflChat(league: {
  leagueId: string;
  year: number;
  host: string | null;
}): Promise<MflChatRead> {
  const url = mflChatFileUrl(league.host, league.year, league.leagueId);
  if (!url) return { ok: false, reason: 'unavailable' };
  try {
    // Fresh every time: this is a chat. The file needs no cookie.
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (res.status === 404) return { ok: true, messages: [] };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const body = await res.text();
    if (!/<messages[\s>/]/.test(body)) return { ok: false, reason: 'unavailable' };
    return { ok: true, messages: parseMflChatXml(body) };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** The longest message the app sends; MFL's own box is about this size. */
export const MFL_CHAT_MAX_LENGTH = 500;

export type MflChatPostOutcome =
  | ({ sent: true } & MflImportResult)
  /** Never reached MFL. `blocked`: a staging or preview build, on purpose. */
  | { sent: false; blocked: boolean; message: string };

/**
 * Post one public message as the owner, with the owner's OWN cookie. Never the
 * server's env credentials (tests/auth-league-scope.test.ts).
 *
 * MFL answers imports with HTTP 200 whatever happened, so the result is read
 * with `readMflImportResult`: `accepted`, `refused`, or neither. On neither,
 * the caller reads the chat back to learn whether the message landed.
 */
export async function postMflChat(
  mflUserCookie: string,
  league: { leagueId: string; year: number },
  text: string,
): Promise<MflChatPostOutcome> {
  const url = `https://api.myfantasyleague.com/${league.year}/chat_save?L=${encodeURIComponent(league.leagueId)}&JSON=1`;
  try {
    const res = await mflFetch({
      url,
      method: 'POST',
      mflUserCookie,
      body: new URLSearchParams({ MESSAGE: text }).toString(),
    });
    return { sent: true, ...readMflImportResult(await res.text(), res.status) };
  } catch (err) {
    const failure = describeMflFailure(err);
    return { sent: false, blocked: failure.blocked, message: failure.message };
  }
}

/**
 * How many messages arrived since `lastReadId`, not counting the owner's own
 * or anyone else's private ones. Oldest-first input.
 *
 * `lastReadId` no longer in the file (MFL trims it) falls back to time, and
 * with no time either, to nothing: a badge that is sometimes low beats one
 * that suddenly claims the whole file is new.
 */
export function countUnreadChat(
  messages: MflChatMessage[],
  me: string,
  lastRead: { id: string; at: string | null } | null,
): number {
  if (!lastRead) return 0;
  const visible = (m: MflChatMessage) => m.franchiseId !== me && (!m.toFranchiseId || m.toFranchiseId === me);
  const index = messages.findIndex((m) => m.id === lastRead.id);
  if (index >= 0) return messages.slice(index + 1).filter(visible).length;
  if (!lastRead.at) return 0;
  return messages.filter((m) => visible(m) && m.postedAt !== null && m.postedAt > lastRead.at!).length;
}

/** What one owner may see: everything public, plus private messages to or from them. */
export function visibleChatMessages(messages: MflChatMessage[], me: string): MflChatMessage[] {
  return messages.filter((m) => !m.toFranchiseId || m.toFranchiseId === me || m.franchiseId === me);
}
