/**
 * League chat in the MFL Football app — the wire contract for
 * `/api/mfl-live/chat?league=<MFL id>` (package N,
 * /mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 *
 * This is MFL's own league chat, the one on the league's MFL home page, so a
 * message posted here shows on MFL and the reverse.
 *
 *   GET            → the chat, oldest first, and marks it read.
 *   GET &count=1   → only the unread count, for the tab badge. Marks nothing.
 *   POST { text }  → posts as the account's own team in that league.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-n-contract.ts` asserts the server's view stays
 * assignable to it.
 */

export interface MflLiveAppChatMessage {
  /** MFL's own id for the message. */
  id: string;
  /** 4-digit franchise id; '0000' is the commissioner. */
  franchiseId: string;
  /** The team's name, or '' when MFL did not name it. */
  franchiseName: string;
  text: string;
  /** ISO time, or null when MFL's label could not be placed in time. */
  postedAt: string | null;
  /** MFL's own time label, for when `postedAt` is null. */
  postedLabel: string;
  /** True for the account's own team. */
  mine: boolean;
}

export type MflLiveAppChatResponse =
  | {
      ok: true;
      leagueId: string;
      /** The team the account posts as. */
      franchiseId: string;
      messages: MflLiveAppChatMessage[];
      /** Unread before this read; the read itself clears it. */
      unread: number;
      /** Longest message the server accepts. */
      maxLength: number;
    }
  /** `chat-unavailable`: MFL did not answer; the app keeps what it had. */
  | { ok: false; error: 'chat-unavailable' };

export type MflLiveAppChatCountResponse =
  | { ok: true; leagueId: string; unread: number }
  | { ok: false; error: 'chat-unavailable' };

export interface MflLiveAppChatPostRequest {
  text: string;
}

export type MflLiveAppChatPostResponse =
  | {
      ok: true;
      /** The chat after the post, oldest first. */
      messages: MflLiveAppChatMessage[];
    }
  | {
      ok: false;
      /**
       * `empty` / `too-long`: fix the text. `refused`: MFL said no, `message`
       * is why. `blocked`: a test build that never writes to real leagues.
       * `unconfirmed`: MFL gave no answer and the message is not in the chat.
       */
      error: 'empty' | 'too-long' | 'refused' | 'blocked' | 'unconfirmed' | 'chat-unavailable';
      message: string;
    };
