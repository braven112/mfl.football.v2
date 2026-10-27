/**
 * An owner's own GroupMe sign-in, so the MFL Football app posts to a league's
 * GroupMe AS THEM (the owner, 2026-10-27: "when someone tries to post they'll
 * be prompted to log in at that point, and from then on they're logged in as
 * themselves").
 *
 * GroupMe's sign-in is an implicit grant: we send the browser to
 * `oauth.groupme.com/oauth/authorize?client_id=…`, and GroupMe sends it back
 * to the callback URL registered on our GroupMe application with
 * `?access_token=…`. The callback is ONE fixed URL and GroupMe carries no
 * `state` through it, so the owner is tied to the sign-in like this:
 *
 *   1. The app, signed in, asks to post. With no stored token the chat POST
 *      mints a one-time `state` in Redis naming the account, and answers
 *      `groupme-sign-in` with a start URL carrying it.
 *   2. The phone opens the start URL in its browser. That route checks the
 *      state is live, sets it as a short-lived cookie on mfl.football, and
 *      redirects to GroupMe.
 *   3. GroupMe redirects to the callback on the same host, so the cookie comes
 *      back with the token. The callback consumes the state (single use),
 *      checks the token with GroupMe, and stores it for that account.
 *
 * The token is a credential: stored ENCRYPTED with the push credentials'
 * AES-256-GCM key (src/utils/push-credentials.ts), keyed on the hashed MFL
 * username (`pushAccountKey`), never logged. One sign-in covers every league
 * the owner plays in, since a GroupMe account is a person, not a team.
 */

import { randomBytes } from 'node:crypto';
import { getRedis } from '../redis-client';
import { encryptionKey, seal, unseal } from '../push-credentials';

/**
 * Our GroupMe application (created by the owner at dev.groupme.com,
 * 2026-10-27). A client id is public by design: it rides in the sign-in URL
 * every owner's browser opens.
 */
export const GROUPME_OAUTH_CLIENT_ID = 'gt1eIq7GxpzbrOALrnpz89ybR87LfAwKWZiFkthHrokZNY4D';

/**
 * The host the GroupMe application's callback is registered on
 * (`https://mfl.football/api/mfl-live/groupme/callback`). The start route must
 * be on the SAME host, or the state cookie it sets never reaches the callback.
 */
export const GROUPME_SIGN_IN_ORIGIN = 'https://mfl.football';

export const GROUPME_STATE_COOKIE = 'mfl_gm_state';
export const GROUPME_COOKIE_PATH = '/api/mfl-live/groupme';

/** Ten minutes to finish signing in. */
export const STATE_TTL_SECONDS = 10 * 60;

const stateKey = (state: string) => `mfl-live:groupme-state:${state}`;
const tokenKey = (account: string) => `mfl-live:groupme-token:${account}`;

/** A state is 32 hex characters; anything else is refused before Redis. */
export function isWellFormedState(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/** The GroupMe sign-in page this browser is sent to. */
export function groupMeAuthorizeUrl(): string {
  return `https://oauth.groupme.com/oauth/authorize?client_id=${encodeURIComponent(GROUPME_OAUTH_CLIENT_ID)}`;
}

/** Mint a one-time sign-in for `account`; the URL the phone should open, or null. */
export async function startGroupMeSignIn(account: string): Promise<string | null> {
  try {
    const redis = await getRedis();
    if (!redis || !encryptionKey()) return null;
    const state = randomBytes(16).toString('hex');
    await redis.set(stateKey(state), account, { ex: STATE_TTL_SECONDS });
    return `${GROUPME_SIGN_IN_ORIGIN}${GROUPME_COOKIE_PATH}/start?s=${state}`;
  } catch {
    return null;
  }
}

/** True while a state can still be used. Does not consume it. */
export async function isLiveState(state: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    return Boolean(redis && (await redis.get(stateKey(state))) != null);
  } catch {
    return false;
  }
}

/** The account a state was minted for, consuming it. */
export async function consumeState(state: string): Promise<string | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const account = await redis.get(stateKey(state));
    if (account == null) return null;
    // Single use: only the request whose delete removed the key may proceed,
    // so two callbacks racing on one state cannot both sign in.
    const removed = await redis.del(stateKey(state));
    return removed === 1 ? `${account}` : null;
  } catch {
    return null;
  }
}

export interface GroupMeOwnerLink {
  token: string;
  /** The GroupMe user the token signs in as. */
  userId: string;
  name: string;
}

export async function saveGroupMeLink(account: string, link: GroupMeOwnerLink): Promise<boolean> {
  const key = encryptionKey();
  if (!key) return false;
  try {
    const redis = await getRedis();
    if (!redis) return false;
    await redis.set(tokenKey(account), JSON.stringify(seal(JSON.stringify(link), key)));
    return true;
  } catch {
    return false;
  }
}

export async function readGroupMeLink(account: string): Promise<GroupMeOwnerLink | null> {
  const key = encryptionKey();
  if (!key) return null;
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const plain = unseal(await redis.get(tokenKey(account)), key);
    if (!plain) return null;
    const link = JSON.parse(plain) as Partial<GroupMeOwnerLink>;
    return typeof link.token === 'string' && typeof link.userId === 'string'
      ? { token: link.token, userId: link.userId, name: typeof link.name === 'string' ? link.name : '' }
      : null;
  } catch {
    return null;
  }
}

/** Forget it — GroupMe stopped accepting the token. */
export async function removeGroupMeLink(account: string): Promise<void> {
  try {
    const redis = await getRedis();
    await redis?.del(tokenKey(account));
  } catch {
    // Best-effort: the next post finds it dead again.
  }
}
