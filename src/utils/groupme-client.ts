/**
 * GroupMe API Client
 *
 * Wraps the GroupMe REST API v3 for reading messages and posting.
 * Service token (for reading) comes from GROUPME_SERVICE_TOKEN env var.
 * Individual owner tokens are stored encrypted in Redis (Phase 2).
 */

import type { GroupMeApiMessage, GroupMeMessagesResponse, GroupMeUserResponse, GroupMeGroupResponse, GroupMeMember } from '../types/groupme';
import { stripLinkAdjacentPunctuation } from './link-punctuation.mjs';

const API_BASE = 'https://api.groupme.com/v3';

function getGroupId(): string {
  const id = process.env.GROUPME_GROUP_ID;
  if (!id) throw new Error('[groupme] GROUPME_GROUP_ID not configured');
  return id;
}

/** The env vars that can supply the service token, in precedence order. */
const SERVICE_TOKEN_VARS = ['GROUPME_SERVICE_TOKEN', 'GROUPME_ACCESS_TOKEN'] as const;
export type GroupMeTokenSource = (typeof SERVICE_TOKEN_VARS)[number];

/**
 * Resolve the service token AND say which variable supplied it. The source
 * matters to every operator-facing message: naming `GROUPME_SERVICE_TOKEN` at
 * a deployment that is actually running on the `GROUPME_ACCESS_TOKEN` fallback
 * sends an on-call admin to rotate the wrong secret.
 */
function readServiceToken(): { token: string; source: GroupMeTokenSource } | null {
  for (const source of SERVICE_TOKEN_VARS) {
    const token = process.env[source];
    if (token) return { token, source };
  }
  return null;
}

function getServiceToken(): string {
  const resolved = readServiceToken();
  if (!resolved) throw new Error(`[groupme] no service token — set ${SERVICE_TOKEN_VARS.join(' or ')}`);
  return resolved.token;
}

/**
 * Service-token health.
 *
 * `not-set` and `rejected` are DELIBERATELY different states. A revoked token
 * is still a truthy string, so `!!process.env.GROUPME_SERVICE_TOKEN` reports a
 * dead credential as healthy — which is exactly what the admin dashboard did
 * while every GroupMe read 401'd. Anything that surfaces token health to a
 * human must distinguish "never configured" from "configured and refused".
 *
 * `unreachable` means we could not get an answer (network error, timeout) —
 * it is NOT evidence the token is bad, so callers should not treat it as such.
 */
export type GroupMeTokenState = 'not-set' | 'rejected' | 'valid' | 'unreachable';

export interface GroupMeTokenHealth {
  state: GroupMeTokenState;
  /** true only when GroupMe accepted the token. */
  ok: boolean;
  /** Epoch ms of the probe this result came from (not of this call). */
  checkedAt: number;
  /** HTTP status GroupMe answered with, when we got that far. */
  httpStatus?: number;
  /** Short human-readable reason, safe to render. Never contains the token. */
  detail?: string;
  /** The account the token authenticates as, when valid. */
  userName?: string;
  /**
   * Which env var supplied the token. Absent only for `not-set`. Operator-
   * facing labels and rotation hints must use THIS, not a hardcoded name.
   */
  source?: GroupMeTokenSource;
}

/** How long a probe result stands before we ask GroupMe again. */
const TOKEN_PROBE_TTL_MS = 5 * 60 * 1000;
/** A failure to reach GroupMe is likely transient — retry sooner. */
const TOKEN_PROBE_ERROR_TTL_MS = 30 * 1000;
// Generous on purpose: a warm probe answers in ~300ms, but the first fetch out
// of a cold lambda paid >5s here during testing, and a timeout reads as
// `unreachable` — an honest "unchecked", but still a worse answer than waiting.
const TOKEN_PROBE_TIMEOUT_MS = 8000;

/**
 * Cached probe, keyed on the token itself so a rotation invalidates the cache
 * immediately rather than leaving a stale `rejected` on screen for the TTL.
 * `inFlight` collapses concurrent dashboard loads into one request.
 */
let tokenProbeCache: { key: string; result: GroupMeTokenHealth; expiresAt: number } | null = null;
let tokenProbeInFlight: { key: string; promise: Promise<GroupMeTokenHealth> } | null = null;
/**
 * Monotonic id of the newest probe started. A slow probe that resolves after a
 * newer one has already landed must NOT overwrite the fresher verdict — with a
 * re-check button on the dashboard that is a live race, and losing it pins the
 * stale answer for the whole TTL.
 */
let tokenProbeGeneration = 0;

async function probeServiceToken(token: string): Promise<GroupMeTokenHealth> {
  const checkedAt = Date.now();
  try {
    // Header auth, not `?token=`: a fetch rejection can carry the request URL
    // in its message (`Failed to parse URL from …?token=SECRET`), and that
    // message goes into `detail`, which is returned as JSON and rendered on the
    // dashboard. Keeping the credential out of the URL removes the leak at the
    // source rather than scrubbing it downstream.
    const res = await fetch(`${API_BASE}/users/me`, {
      headers: { 'X-Access-Token': token },
      signal: AbortSignal.timeout(TOKEN_PROBE_TIMEOUT_MS),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        state: 'rejected',
        ok: false,
        checkedAt,
        httpStatus: res.status,
        detail: 'GroupMe rejected the token — it has been revoked or regenerated.',
      };
    }

    if (!res.ok) {
      return {
        state: 'unreachable',
        ok: false,
        checkedAt,
        httpStatus: res.status,
        detail: `GroupMe returned HTTP ${res.status}.`,
      };
    }

    const data = (await res.json().catch(() => null)) as GroupMeUserResponse | null;
    if (!data?.response?.id) {
      return {
        state: 'unreachable',
        ok: false,
        checkedAt,
        httpStatus: res.status,
        detail: 'GroupMe answered 200 with an unrecognized body.',
      };
    }

    return {
      state: 'valid',
      ok: true,
      checkedAt,
      httpStatus: res.status,
      userName: data.response.name,
    };
  } catch (err) {
    return {
      state: 'unreachable',
      ok: false,
      checkedAt,
      // Belt and braces alongside the header auth above: `detail` is documented
      // as never containing the token, so redact rather than trust the shape of
      // an error message we do not author.
      detail: `Could not reach GroupMe: ${redactToken((err as Error)?.message ?? String(err), token)}`,
    };
  }
}

/** Remove the token from text bound for a response body or the DOM. */
function redactToken(text: string, token: string): string {
  return token ? text.split(token).join('[redacted]') : text;
}

/**
 * Probe the service token against `GET /v3/users/me` and report what GroupMe
 * actually said. Cached briefly (see TTLs above) so an admin page that polls
 * does not hammer the API; pass `{ force: true }` for an explicit re-check.
 */
export async function checkServiceTokenHealth(opts?: { force?: boolean }): Promise<GroupMeTokenHealth> {
  const resolved = readServiceToken();
  if (!resolved) {
    return {
      state: 'not-set',
      ok: false,
      checkedAt: Date.now(),
      detail: `Neither ${SERVICE_TOKEN_VARS.join(' nor ')} is set in this environment.`,
    };
  }
  const { token, source } = resolved;

  const now = Date.now();
  if (!opts?.force && tokenProbeCache?.key === token && tokenProbeCache.expiresAt > now) {
    return tokenProbeCache.result;
  }
  if (!opts?.force && tokenProbeInFlight?.key === token) {
    return tokenProbeInFlight.promise;
  }

  // Claim a generation BEFORE starting, so a probe that resolves out of order
  // can tell it has been superseded. A `force` re-check overlapping an in-flight
  // poll is the case that makes this reachable.
  const generation = ++tokenProbeGeneration;

  const promise = probeServiceToken(token).then((probed) => {
    // Stamped here rather than inside the probe so every state carries it.
    const result: GroupMeTokenHealth = { ...probed, source };
    if (generation === tokenProbeGeneration) {
      const ttl = result.state === 'unreachable' ? TOKEN_PROBE_ERROR_TTL_MS : TOKEN_PROBE_TTL_MS;
      tokenProbeCache = { key: token, result, expiresAt: Date.now() + ttl };
    }
    // The caller still gets the answer to the probe IT asked for; only the
    // shared cache is reserved for the newest one.
    return result;
  }).finally(() => {
    if (tokenProbeInFlight?.promise === promise) tokenProbeInFlight = null;
  });

  tokenProbeInFlight = { key: token, promise };
  return promise;
}

/** Test seam — drops the cached probe so a suite can re-probe deterministically. */
export function resetServiceTokenHealthCache(): void {
  tokenProbeCache = null;
  tokenProbeInFlight = null;
  tokenProbeGeneration++;
}

/**
 * Fetch messages from the group chat.
 * Uses since_id for forward pagination (get messages after a known ID).
 */
export async function fetchMessages(opts?: {
  sinceId?: string;
  beforeId?: string;
  limit?: number;
  token?: string;
}): Promise<GroupMeApiMessage[]> {
  const groupId = getGroupId();
  const token = opts?.token ?? getServiceToken();
  const limit = Math.min(opts?.limit ?? 100, 100);

  const url = new URL(`${API_BASE}/groups/${groupId}/messages`);
  url.searchParams.set('token', token);
  url.searchParams.set('limit', String(limit));
  if (opts?.sinceId) url.searchParams.set('since_id', opts.sinceId);
  if (opts?.beforeId) url.searchParams.set('before_id', opts.beforeId);

  const res = await fetch(url.toString());

  if (res.status === 304) return []; // No new messages
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[groupme] fetchMessages failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as GroupMeMessagesResponse;
  return data.response?.messages ?? [];
}

/**
 * Post a message to the group chat as a specific user.
 * Requires that user's personal GroupMe access token.
 */
export async function sendMessage(text: string, token: string): Promise<boolean> {
  const groupId = getGroupId();
  const url = `${API_BASE}/groups/${groupId}/messages?token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        source_guid: `site_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[groupme] sendMessage failed (${res.status}):`, errText);
    return false;
  }

  return true;
}

/**
 * Post a message as a bot (for Schefter auto-posts).
 * Uses GROUPME_BOT_ID env var.
 */
export async function postAsBot(text: string): Promise<boolean> {
  const botId = process.env.GROUPME_BOT_ID;
  if (!botId) {
    console.warn('[groupme] GROUPME_BOT_ID not configured, skipping bot post');
    return false;
  }

  // Keep a sentence-ending period out of GroupMe's autolinked URL — see
  // link-punctuation.mjs. This is the live bot lane for BOTH Schefter's posts
  // and the owner-compose route (/api/groupme/send), so owner-written text
  // gets tidied too; sendMessage() above is not a carve-out, it simply has no
  // callers.
  const res = await fetch(`${API_BASE}/bots/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bot_id: botId, text: stripLinkAdjacentPunctuation(text) }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[groupme] postAsBot failed (${res.status}):`, errText);
    return false;
  }

  return true;
}

/**
 * Get the authenticated user's GroupMe profile.
 * Used during OAuth callback to map GroupMe userId to franchiseId.
 */
export async function getGroupMeUser(token: string): Promise<{ id: string; name: string } | null> {
  const res = await fetch(`${API_BASE}/users/me?token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;

  const data = (await res.json()) as GroupMeUserResponse;
  return data.response ? { id: data.response.id, name: data.response.name } : null;
}

/**
 * Fetch all members of the group chat.
 * Used for the linking flow — owners pick "that's me" from the member list.
 */
export async function fetchGroupMembers(): Promise<GroupMeMember[]> {
  const groupId = getGroupId();
  const token = getServiceToken();

  const res = await fetch(`${API_BASE}/groups/${groupId}?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[groupme] fetchGroupMembers failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as GroupMeGroupResponse;
  return data.response?.members ?? [];
}
