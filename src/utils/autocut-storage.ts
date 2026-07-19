/**
 * August Roster Cuts — cut-list + credential storage (Upstash Redis)
 *
 * Keys:
 *   autocut:{franchiseId}       → AutocutList { year, playerIds, updatedAt }
 *   autocut:cred:{franchiseId}  → EncryptedCredential (AES-256-GCM envelope)
 *
 * Credential custody rules (see the feature plan — DO NOT WEAKEN):
 *  - The MFL_USER_ID cookie value is encrypted at rest with AES-256-GCM.
 *    The key comes from the dedicated env secret AUTOCUT_CRED_KEY (NOT
 *    JWT_SECRET, so rotating one doesn't torch the other). If the env value
 *    base64-decodes to exactly 32 bytes it is used directly as the AES key;
 *    any other value is stretched to 32 bytes with
 *    scryptSync(AUTOCUT_CRED_KEY, 'autocut:cred:v1', 32).
 *  - Missing AUTOCUT_CRED_KEY (or missing Redis) → every credential function
 *    no-ops gracefully (returns null / false) and NEVER throws, so login and
 *    cut-list saves keep working in degraded environments.
 *  - NEVER log cookie values or decrypted material. Error logs here are
 *    message-free on purpose.
 *  - readCredential is for server-side execution contexts only (the deadline
 *    job / admin tooling). It must never be exposed through an HTTP response.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { getRedis } from './redis-client';

/** Stale threshold for stored credentials (tunable league decision #7). */
export const CREDENTIAL_MAX_AGE_DAYS = 30;

const KEY_DERIVATION_SALT = 'autocut:cred:v1';

export interface AutocutList {
  /** League year the list applies to — stale lists from last August are ignored. */
  year: number;
  /** Marked player ids in cut-priority order. */
  playerIds: string[];
  /** ISO timestamp of the last save. */
  updatedAt: string;
}

interface EncryptedCredential {
  v: 1;
  alg: 'aes-256-gcm';
  /** base64 12-byte IV */
  iv: string;
  /** base64 16-byte GCM auth tag */
  tag: string;
  /** base64 ciphertext of the raw MFL_USER_ID cookie value */
  data: string;
  /** ISO timestamp of capture (plaintext — needed for freshness checks). */
  capturedAt: string;
}

export interface StoredCredential {
  /** Raw decrypted MFL_USER_ID cookie value. NEVER log or return over HTTP. */
  cookie: string;
  capturedAt: string;
}

/** Match auth.ts's franchise normalization so '1' and '0001' share a key. */
function normalizeFranchiseId(franchiseId: string): string {
  const trimmed = `${franchiseId ?? ''}`.trim();
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
}

export function cutListKey(franchiseId: string): string {
  return `autocut:${normalizeFranchiseId(franchiseId)}`;
}

export function credentialKey(franchiseId: string): string {
  return `autocut:cred:${normalizeFranchiseId(franchiseId)}`;
}

// Derived-key cache — scrypt is deliberately slow, so don't re-derive on
// every call. Keyed by the env value so tests (and key rotation within a
// process) pick up changes.
let cachedKey: { env: string; key: Buffer } | null = null;

function getEncryptionKey(): Buffer | null {
  const env = process.env.AUTOCUT_CRED_KEY;
  if (!env) return null;
  if (cachedKey && cachedKey.env === env) return cachedKey.key;

  let key: Buffer;
  const decoded = Buffer.from(env, 'base64');
  if (decoded.length === 32) {
    key = decoded;
  } else {
    key = scryptSync(env, KEY_DERIVATION_SALT, 32);
  }
  cachedKey = { env, key };
  return key;
}

// ---------------------------------------------------------------------------
// Cut list
// ---------------------------------------------------------------------------

export async function getCutList(franchiseId: string): Promise<AutocutList | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const value = await redis.get<AutocutList>(cutListKey(franchiseId));
    if (!value || typeof value !== 'object') return null;
    if (typeof value.year !== 'number' || !Array.isArray(value.playerIds)) return null;
    return value;
  } catch (err) {
    console.error('[autocut-storage] cut list read failed:', err);
    return null;
  }
}

export async function saveCutList(
  franchiseId: string,
  list: { year: number; playerIds: string[] },
): Promise<AutocutList | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const record: AutocutList = {
    year: list.year,
    playerIds: [...list.playerIds],
    updatedAt: new Date().toISOString(),
  };
  try {
    await redis.set(cutListKey(franchiseId), record);
    return record;
  } catch (err) {
    console.error('[autocut-storage] cut list write failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Encrypt and store an owner's MFL cookie. Returns the capturedAt ISO
 * timestamp when stored, or null when capture was skipped (missing
 * AUTOCUT_CRED_KEY, missing Redis, empty cookie, or a storage error).
 * Never throws — callers (login, cut-list save) must not fail because of it.
 */
export async function captureCredential(
  franchiseId: string,
  mflUserCookie: string,
): Promise<string | null> {
  try {
    if (!mflUserCookie) return null;
    const key = getEncryptionKey();
    if (!key) return null;
    const redis = await getRedis();
    if (!redis) return null;

    const capturedAt = new Date().toISOString();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(mflUserCookie, 'utf8'), cipher.final()]);
    const record: EncryptedCredential = {
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: ciphertext.toString('base64'),
      capturedAt,
    };
    await redis.set(credentialKey(franchiseId), record);
    return capturedAt;
  } catch {
    // Deliberately message-free: nothing derived from the cookie may leak.
    console.error('[autocut-storage] credential capture failed');
    return null;
  }
}

/**
 * Decrypt a stored credential. Server-side execution contexts only — the
 * return value must NEVER cross an HTTP response boundary. Returns null on
 * any failure (missing env/Redis/record, tamper, wrong key) — never throws.
 */
export async function readCredential(franchiseId: string): Promise<StoredCredential | null> {
  try {
    const key = getEncryptionKey();
    if (!key) return null;
    const redis = await getRedis();
    if (!redis) return null;

    const record = await redis.get<EncryptedCredential>(credentialKey(franchiseId));
    if (!record || typeof record !== 'object' || record.v !== 1 || record.alg !== 'aes-256-gcm') {
      return null;
    }

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const cookie = Buffer.concat([
      decipher.update(Buffer.from(record.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');

    return { cookie, capturedAt: record.capturedAt };
  } catch {
    // Wrong key / tampered ciphertext / parse failure — treat as absent.
    return null;
  }
}

/** Read only the capture timestamp (no decryption) — freshness checks. */
export async function getCredentialCapturedAt(franchiseId: string): Promise<string | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const record = await redis.get<EncryptedCredential>(credentialKey(franchiseId));
    return record && typeof record === 'object' && typeof record.capturedAt === 'string'
      ? record.capturedAt
      : null;
  } catch {
    return null;
  }
}

export async function deleteCredential(franchiseId: string): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.del(credentialKey(franchiseId));
  } catch {
    console.error('[autocut-storage] credential delete failed');
  }
}

/**
 * Whether a credential captured at `capturedAt` is still fresh.
 * Pure — safe for scripts and UI copy. Invalid/absent timestamps are stale.
 */
export function isCredentialFresh(
  capturedAt: string | null | undefined,
  maxAgeDays: number = CREDENTIAL_MAX_AGE_DAYS,
  now: Date = new Date(),
): boolean {
  if (!capturedAt) return false;
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured)) return false;
  const ageMs = now.getTime() - captured;
  if (ageMs < 0) return false; // future timestamps are corrupt, not fresh
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}
