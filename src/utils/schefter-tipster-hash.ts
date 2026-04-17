/**
 * Schefter Tipster Identity Hash
 *
 * One-way hash of a user id + server-side salt. Used to rate-limit anonymous
 * tip submissions per owner without ever persisting (or being able to recover)
 * the tipster's identity. Stable for the same user, so "this owner has tipped
 * 3 times today" is enforceable; but not reversible.
 *
 * Throws if SCHEFTER_TIPSTER_SALT is unset — we never want to degrade silently
 * into a non-salted hash.
 */

import { createHash } from 'node:crypto';

export function hashTipsterId(userId: string): string {
  if (!userId) {
    throw new Error('hashTipsterId: userId is required');
  }
  const salt = process.env.SCHEFTER_TIPSTER_SALT;
  if (!salt) {
    throw new Error('hashTipsterId: SCHEFTER_TIPSTER_SALT environment variable is not set');
  }
  return createHash('sha256').update(`${userId}${salt}`).digest('hex');
}
