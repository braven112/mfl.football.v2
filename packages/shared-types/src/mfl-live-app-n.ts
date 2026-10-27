/**
 * League chat in the MFL Football app — the wire contract for
 * `/api/mfl-live/chat?league=<MFL id>` (package N,
 * /mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 *
 * By default this is MFL's own league chat, the one on the league's MFL home
 * page, so a message posted here shows on MFL and the reverse. A league that
 * talks in GroupMe gets its GroupMe group instead (`source: 'groupme'`):
 * messages come from the group, and an owner posts as themself: the first
 * post answers `groupme-sign-in` with a `signInUrl` to open in the browser,
 * and once signed in every post goes to GroupMe under their own name.
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
  /**
   * GroupMe only. For a message from a person rather than a team,
   * `franchiseId` is '' and `franchiseName` is their GroupMe name.
   */
  avatarUrl?: string | null;
  /** GroupMe only: photos attached to the message. */
  imageUrls?: string[];
}

/** Where the league's chat lives. */
export type MflLiveAppChatSource = 'mfl' | 'groupme';

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
      /** Absent from servers older than the GroupMe step: read it as 'mfl'. */
      source?: MflLiveAppChatSource;
    }
  /** `chat-unavailable`: MFL (or GroupMe) did not answer; the app keeps what it had. */
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
       * `groupme-sign-in`: the league's chat is GroupMe, and posting needs
       * the owner's own GroupMe sign-in: open `signInUrl` in the browser, then
       * send again.
       */
      error: 'empty' | 'too-long' | 'refused' | 'blocked' | 'unconfirmed' | 'chat-unavailable' | 'groupme-sign-in';
      message: string;
      /** `groupme-sign-in` only; absent when the server cannot start one. */
      signInUrl?: string;
    };

/**
 * `/api/mfl-live/chat-source?league=` — which chat a league's Chat tab shows,
 * and switching it (outside chat, step 3). Any owner in the league may
 * connect a GroupMe group they belong to, or switch back to MFL chat; leagues
 * whose GroupMe our server already runs are `fixed`.
 *
 *   GET                       → the current source and this owner's GroupMe groups.
 *   POST { signIn: true }     → a GroupMe sign-in link to open in the browser.
 *   POST { groupId: '123' }   → show that GroupMe group.
 *   POST { groupId: null }    → back to MFL chat.
 */
export interface MflLiveAppChatSourceGroup {
  id: string;
  name: string;
  members: number;
}

export type MflLiveAppChatSourceResponse =
  | {
      ok: true;
      leagueId: string;
      source: MflLiveAppChatSource;
      /** Set by our server for this league; the app cannot change it. */
      fixed: boolean;
      /** Who connected the group (connected leagues only). */
      connectedBy: { franchiseId: string; name: string; mine: boolean } | null;
      groupName: string | null;
      /** This owner's own GroupMe sign-in; their groups once signed in. */
      groupMe: { signedIn: false } | { signedIn: true; name: string; groups: MflLiveAppChatSourceGroup[] };
    }
  | { ok: false; error: 'chat-unavailable' };

export type MflLiveAppChatSourceRequest = { signIn: true } | { groupId: string | null };

export type MflLiveAppChatSourcePostResponse =
  | { ok: true; signInUrl?: string }
  | {
      ok: false;
      /**
       * `fixed`: this league's chat is set by our server. `not-your-group`:
       * that group is not one of yours. `groupme-sign-in`: sign in first
       * (`signInUrl`). `unavailable`: try again shortly.
       */
      error: 'fixed' | 'not-your-group' | 'groupme-sign-in' | 'unavailable';
      message: string;
      signInUrl?: string;
    };
