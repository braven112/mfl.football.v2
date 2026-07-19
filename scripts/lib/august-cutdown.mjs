/**
 * August cutdown date + credential-envelope helpers for node scripts.
 *
 * Script-side twin of two app utils:
 *  - src/utils/contract-eligibility.ts#getAugustCutdownDate — the 3rd Sunday
 *    of August at 8:45 PM Pacific. tests/august-cutdown-date.test.ts
 *    cross-checks the two implementations for 2024–2032; keep them in
 *    lockstep.
 *  - src/utils/autocut-storage.ts — the AES-256-GCM credential envelope
 *    (key derivation + decrypt only; scripts never ENCRYPT credentials,
 *    capture happens in the app).
 *
 * All date math here resolves Pacific time via Intl regardless of the
 * runner's local timezone, so behavior is identical on a developer laptop
 * and a UTC GitHub Actions runner (same convention as scripts/lib/pt-date.mjs).
 */

import { createDecipheriv, scryptSync } from 'node:crypto';
import { normalizeFranchiseId } from '../../src/utils/franchise-id.mjs';

export const AUGUST_CUTDOWN_TIME_ZONE = 'America/Los_Angeles';

/**
 * Day-of-month of the 3rd Sunday of August. Pure calendar math via UTC so
 * the result is independent of the runner's timezone. When Aug 1 is itself
 * a Sunday, the first Sunday IS Aug 1 (day = 15 — e.g. 2027, 2032).
 *
 * @param {number} year
 * @returns {number} day of month (15–21)
 */
export function getAugustCutdownDay(year) {
  const aug1DayOfWeek = new Date(Date.UTC(year, 7, 1)).getUTCDay();
  const daysToFirstSunday = (7 - aug1DayOfWeek) % 7;
  return 1 + daysToFirstSunday + 14;
}

/**
 * The cutdown deadline as Pacific wall-clock components (month is 1-indexed).
 *
 * @param {number} year
 * @returns {{ year: number, month: 8, day: number, hour: 20, minute: 45 }}
 */
export function getAugustCutdownWallClock(year) {
  return { year, month: 8, day: getAugustCutdownDay(year), hour: 20, minute: 45 };
}

/** Offset of America/Los_Angeles from UTC, in minutes, at `date` (negative west). */
function ptOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AUGUST_CUTDOWN_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(
    parts.filter((x) => x.type !== 'literal').map((x) => [x.type, parseInt(x.value, 10)]),
  );
  const hour = p.hour === 24 ? 0 : p.hour; // some ICU versions emit 24 for midnight
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second);
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * Convert a Pacific wall-clock time to the absolute Date instant, regardless
 * of the runner's timezone. (August is always PDT, but the two-pass offset
 * probe keeps this correct for any date.)
 *
 * @param {number} year
 * @param {number} month 1-indexed
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @returns {Date}
 */
export function ptWallClockToDate(year, month, day, hour, minute) {
  let ts = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i += 1) {
    const offset = ptOffsetMinutes(new Date(ts));
    ts = Date.UTC(year, month - 1, day, hour, minute) - offset * 60_000;
  }
  return new Date(ts);
}

/**
 * The August cutdown deadline (3rd Sunday of August, 8:45 PM PT) as an
 * absolute instant. Twin of contract-eligibility.ts#getAugustCutdownDate.
 *
 * @param {number} year
 * @returns {Date}
 */
export function getAugustCutdownDate(year) {
  const wc = getAugustCutdownWallClock(year);
  return ptWallClockToDate(wc.year, wc.month, wc.day, wc.hour, wc.minute);
}

/**
 * Current Pacific calendar date components.
 *
 * @param {Date} [now]
 * @returns {{ year: number, month: number, day: number }}
 */
export function ptDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AUGUST_CUTDOWN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const p = Object.fromEntries(
    parts.filter((x) => x.type !== 'literal').map((x) => [x.type, parseInt(x.value, 10)]),
  );
  return { year: p.year, month: p.month, day: p.day };
}

/**
 * Pacific calendar-day difference from `now` to the cutdown date
 * (midnight-to-midnight, same semantics as roger-reminder-window.mjs's
 * calendarDaysUntil but pinned to America/Los_Angeles). "Tomorrow" is
 * always 1 regardless of the hour; deadline day is 0; past is negative.
 *
 * @param {number} year
 * @param {Date} [now]
 * @returns {number}
 */
export function calendarDaysUntilCutdown(year, now = new Date()) {
  const today = ptDateParts(now);
  const wc = getAugustCutdownWallClock(year);
  const a = Date.UTC(today.year, today.month - 1, today.day);
  const b = Date.UTC(wc.year, wc.month - 1, wc.day);
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Credential envelope (decrypt side of src/utils/autocut-storage.ts)
// ---------------------------------------------------------------------------

/** Stale threshold for stored credentials — mirror of autocut-storage.ts. */
export const CREDENTIAL_MAX_AGE_DAYS = 30;

const KEY_DERIVATION_SALT = 'autocut:cred:v1';

/**
 * Derive the AES-256 key from the AUTOCUT_CRED_KEY env value, exactly as
 * autocut-storage.ts does: a value that base64-decodes to exactly 32 bytes
 * is used directly; anything else is stretched with
 * scryptSync(value, 'autocut:cred:v1', 32).
 *
 * @param {string | undefined} [envValue]
 * @returns {Buffer | null}
 */
export function deriveCredentialKey(envValue = process.env.AUTOCUT_CRED_KEY) {
  if (!envValue) return null;
  const decoded = Buffer.from(envValue, 'base64');
  if (decoded.length === 32) return decoded;
  return scryptSync(envValue, KEY_DERIVATION_SALT, 32);
}

/**
 * Decrypt a stored credential envelope ({ v:2, alg:'aes-256-gcm', iv, tag,
 * data, capturedAt } with base64 fields). Returns null on any failure
 * (missing key, wrong version, tamper, wrong key, franchise mismatch) — never
 * throws. The decrypted cookie must NEVER be logged or leave the execution
 * context.
 *
 * v2 binds the ciphertext to its franchise via GCM AAD (= normalized franchise
 * id), so an envelope stored under franchise A cannot be decrypted as
 * franchise B. `franchiseId` MUST be the id the envelope was stored under.
 * Any non-v2 envelope fails closed (treated as missing).
 *
 * @param {unknown} record
 * @param {Buffer | null} key
 * @param {string} franchiseId the franchise the envelope belongs to (AAD)
 * @returns {{ cookie: string, capturedAt: string } | null}
 */
export function decryptCredentialRecord(record, key, franchiseId) {
  try {
    if (!key) return null;
    if (!record || typeof record !== 'object') return null;
    if (record.v !== 2 || record.alg !== 'aes-256-gcm') return null;

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAAD(Buffer.from(normalizeFranchiseId(franchiseId), 'utf8'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const cookie = Buffer.concat([
      decipher.update(Buffer.from(record.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');

    return { cookie, capturedAt: record.capturedAt };
  } catch {
    // Wrong key / tampered ciphertext / parse failure — treat as absent.
    // Deliberately message-free: nothing derived from the cookie may leak.
    return null;
  }
}

/**
 * Whether a credential captured at `capturedAt` is still fresh — mirror of
 * autocut-storage.ts#isCredentialFresh (parity locked by tests).
 *
 * @param {string | null | undefined} capturedAt
 * @param {number} [maxAgeDays]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isCredentialFresh(capturedAt, maxAgeDays = CREDENTIAL_MAX_AGE_DAYS, now = new Date()) {
  if (!capturedAt) return false;
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured)) return false;
  const ageMs = now.getTime() - captured;
  if (ageMs < 0) return false; // future timestamps are corrupt, not fresh
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}
