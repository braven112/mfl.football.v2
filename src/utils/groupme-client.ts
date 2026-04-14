/**
 * GroupMe API Client
 *
 * Wraps the GroupMe REST API v3 for reading messages and posting.
 * Service token (for reading) comes from GROUPME_SERVICE_TOKEN env var.
 * Individual owner tokens are stored encrypted in Redis (Phase 2).
 */

import type { GroupMeApiMessage, GroupMeMessagesResponse, GroupMeUserResponse, GroupMeGroupResponse, GroupMeMember } from '../types/groupme';

const API_BASE = 'https://api.groupme.com/v3';

function getGroupId(): string {
  const id = process.env.GROUPME_GROUP_ID;
  if (!id) throw new Error('[groupme] GROUPME_GROUP_ID not configured');
  return id;
}

function getServiceToken(): string {
  const token = process.env.GROUPME_SERVICE_TOKEN || process.env.GROUPME_ACCESS_TOKEN;
  if (!token) throw new Error('[groupme] GROUPME_SERVICE_TOKEN not configured');
  return token;
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

  const res = await fetch(`${API_BASE}/bots/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bot_id: botId, text }),
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
