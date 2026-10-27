/**
 * The MFL sign-in the alert checker reads MFL with, one per app account.
 *
 * The owner chose (2026-10-27) a server checker that reads MFL every minute,
 * so a trade, waiver run, chat message or draft pick made on MFL's own site
 * alerts the app within about a minute, in ANY MFL league. MFL has no
 * webhooks and serves those reads only to a member of the league, so the
 * checker needs the owner's own MFL cookie — the same one the app already
 * sends inside its session JWT on every request.
 *
 * It is a credential, so it is stored ENCRYPTED (AES-256-GCM) and never
 * logged. The key is `PUSH_CREDENTIAL_KEY` (32 bytes, base64) when set, else
 * derived from `JWT_SECRET` with HKDF under its own label — a stolen Redis
 * snapshot alone does not yield a single MFL sign-in, and the JWT secret
 * already guards everything this cookie can do through the site.
 *
 *   push:cred:{account} → { v: 1, iv, tag, ct } (base64), TTL CREDENTIAL_TTL_SECONDS
 *
 * The TTL is refreshed on every app launch (registration), so an owner who
 * stops opening the app stops being read on their behalf. Removed outright
 * when the account's last phone signs out, or when MFL refuses the cookie.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getRedis } from './redis-client';

/** Thirty days without opening the app and the checker stops reading for you. */
export const CREDENTIAL_TTL_SECONDS = 30 * 24 * 60 * 60;

export function credentialKey(account: string): string {
  return `push:cred:${account}`;
}

interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

/** The 32-byte encryption key, or null when the server has no secret at all. */
export function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const explicit = env.PUSH_CREDENTIAL_KEY;
  if (explicit) {
    const key = Buffer.from(explicit, 'base64');
    if (key.length === 32) return key;
    console.warn('[push-credentials] PUSH_CREDENTIAL_KEY is not 32 bytes of base64 — ignored.');
  }
  const secret = env.JWT_SECRET;
  if (!secret) return null;
  return Buffer.from(hkdfSync('sha256', secret, 'mfl-football-push', 'push-credential-v1', 32));
}

/** Encrypt. Pure apart from the random IV. */
export function seal(plain: string, key: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Decrypt, or null for anything tampered, truncated or sealed under another key. */
export function unseal(value: unknown, key: Buffer): string | null {
  let sealed: unknown = value;
  if (typeof value === 'string') {
    try {
      sealed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const s = sealed as Partial<Sealed> | null;
  if (!s || s.v !== 1 || typeof s.iv !== 'string' || typeof s.tag !== 'string' || typeof s.ct !== 'string') {
    return null;
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(s.ct, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Store (or refresh) an account's MFL cookie. False when it could not be stored. */
export async function saveCredential(account: string, mflCookie: string): Promise<boolean> {
  const key = encryptionKey();
  if (!key || !mflCookie) return false;
  const redis = await getRedis();
  if (!redis) return false;
  await redis.set(credentialKey(account), JSON.stringify(seal(mflCookie, key)), {
    ex: CREDENTIAL_TTL_SECONDS,
  });
  return true;
}

/** The account's MFL cookie, or null when none is stored or it cannot be opened. */
export async function readCredential(account: string): Promise<string | null> {
  const key = encryptionKey();
  if (!key) return null;
  const redis = await getRedis();
  if (!redis) return null;
  return unseal(await redis.get(credentialKey(account)), key);
}

/** Forget an account's MFL cookie. Best-effort. */
export async function removeCredential(account: string): Promise<void> {
  try {
    const redis = await getRedis();
    await redis?.del(credentialKey(account));
  } catch (e) {
    console.warn('[push-credentials] remove failed:', e);
  }
}
