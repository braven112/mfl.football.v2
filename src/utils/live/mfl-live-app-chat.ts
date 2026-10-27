/**
 * The app's view of a league chat (package N): MFL's messages, with team
 * names, as the account's own team sees them.
 */

import type { MflChatMessage } from '../mfl-chat';
import { visibleChatMessages } from '../mfl-chat';

export interface ChatMessageView {
  id: string;
  franchiseId: string;
  franchiseName: string;
  text: string;
  postedAt: string | null;
  postedLabel: string;
  mine: boolean;
}

/** Oldest first; private messages for other teams are left out. */
export function buildChatView(
  messages: MflChatMessage[],
  me: string,
  names: Record<string, string>,
): ChatMessageView[] {
  return visibleChatMessages(messages, me).map((m) => ({
    id: m.id,
    franchiseId: m.franchiseId,
    franchiseName: m.franchiseId === '0000' ? 'Commissioner' : (names[m.franchiseId] ?? ''),
    text: m.text,
    postedAt: m.postedAt,
    postedLabel: m.postedLabel,
    mine: m.franchiseId === me,
  }));
}
