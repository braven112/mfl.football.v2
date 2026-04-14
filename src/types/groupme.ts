// ── GroupMe Integration Types ──

/** A raw message from the GroupMe API */
export interface GroupMeApiMessage {
  id: string;
  group_id: string;
  user_id: string;
  name: string;
  text: string | null;
  avatar_url: string | null;
  created_at: number;
  sender_type: 'user' | 'bot' | 'system';
  favorited_by: string[];
  attachments: GroupMeApiAttachment[];
}

export interface GroupMeApiAttachment {
  type: 'image' | 'emoji' | 'mentions' | 'location';
  url?: string;
  placeholder?: string;
  charmap?: number[][];
  loci?: number[][];
  user_ids?: string[];
  lat?: string;
  lng?: string;
  name?: string;
}

/** Normalized message stored in Redis */
export interface GroupMeMessage {
  id: string;
  groupId: string;
  userId: string;
  name: string;
  text: string;
  avatarUrl: string | null;
  createdAt: number;
  senderType: 'user' | 'bot' | 'system';
  franchiseId?: string;
  likeCount: number;
  attachments: GroupMeAttachment[];
}

export interface GroupMeAttachment {
  type: 'image' | 'emoji' | 'mentions' | 'location';
  url?: string;
}

/** GroupMe API response for /groups/{id}/messages */
export interface GroupMeMessagesResponse {
  response: {
    count: number;
    messages: GroupMeApiMessage[];
  };
  meta: {
    code: number;
  };
}

/** GroupMe API response for /users/me */
export interface GroupMeUserResponse {
  response: {
    id: string;
    name: string;
    image_url: string | null;
  };
  meta: {
    code: number;
  };
}

/** A member of the GroupMe group */
export interface GroupMeMember {
  user_id: string;
  nickname: string;
  image_url: string | null;
  id: string;
  muted: boolean;
  autokicked: boolean;
  roles: string[];
}

/** GroupMe API response for /groups/{id} (group details with members) */
export interface GroupMeGroupResponse {
  response: {
    id: string;
    name: string;
    members: GroupMeMember[];
  };
  meta: {
    code: number;
  };
}

/** Normalize a raw GroupMe API message into our storage format */
export function normalizeGroupMeMessage(
  raw: GroupMeApiMessage,
  franchiseId?: string,
): GroupMeMessage {
  return {
    id: raw.id,
    groupId: raw.group_id,
    userId: raw.user_id,
    name: raw.name,
    text: raw.text ?? '',
    avatarUrl: raw.avatar_url,
    createdAt: raw.created_at,
    senderType: raw.sender_type,
    franchiseId,
    likeCount: raw.favorited_by?.length ?? 0,
    attachments: (raw.attachments ?? [])
      .filter(a => a.type === 'image')
      .map(a => ({ type: a.type, url: a.url })),
  };
}
