/**
 * Pairing a TV from the MFL Live phone app — the wire contract between
 * `POST /api/broadcast-tv/approve` and `apps/mobile`'s Pair a TV screen.
 *
 * The TV (`/tv`, or the Google TV app) shows a six-character code and a QR
 * code for `/live/broadcast/pair?code=<CODE>`. The app reads the code out of
 * that QR (or the owner types it) and posts it here with its Bearer token.
 * Approval mints a WATCH-ONLY pass for the signed-in owner; nothing in the
 * body can name anyone else (see `src/utils/broadcast-tv-pairing.ts`).
 *
 * Types only, no runtime code: the app imports it with `import type`.
 * `src/types/mfl-live-app-pair-tv-contract.ts` asserts the server's answers
 * stay inside `MflLiveAppPairTvResult`.
 */

/** The body the app posts. The server upper-cases and strips spaces/dashes. */
export interface MflLiveAppPairTvRequest {
  code: string;
}

/**
 * Every answer the endpoint gives, with its HTTP status:
 *  - `approved` (200): the TV picks up its pass on its next poll.
 *  - `expired` (410): no live pairing for that code (they last 5 minutes).
 *  - `already-used` (410): another phone, or this one, already approved it.
 *  - `invalid` (400): not six characters off the TV's alphabet.
 *  - `signed-out` (401): the Bearer token is missing or no longer valid.
 *  - `slow-down` (429): too many approvals from this owner in 10 minutes.
 *  - `unavailable` (503): the pairing store is down.
 */
export type MflLiveAppPairTvResult =
  | 'approved'
  | 'expired'
  | 'already-used'
  | 'invalid'
  | 'signed-out'
  | 'slow-down'
  | 'unavailable';

export interface MflLiveAppPairTvResponse {
  result: MflLiveAppPairTvResult;
}
