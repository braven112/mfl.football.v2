/**
 * Which leagues and teams the MFL Football app can act in — the wire contract
 * for `GET /api/mfl-live/my-teams` (package F2,
 * /mnt/project-files/mfl-live-app/parallel-work-packages.md, round 2).
 *
 * Every "manage your team" screen (lineups, players, waivers, trades, chat,
 * the team page) acts in ONE league as ONE team at a time. This is the list
 * the app's league switcher offers, and `leagueId` is what each of those
 * screens sends back as `?league=`. The server never trusts it: every
 * `/api/mfl-live/*` endpoint re-checks it against the owner's own MFL account
 * (`resolveOwnerLeague`).
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-teams-contract.ts` asserts the server's view stays
 * assignable to it.
 */

/** One team the signed-in account owns, in one MFL league. */
export interface MflLiveAppMyTeam {
  /** MFL league id, e.g. '13522'. Send it back as `?league=`. */
  leagueId: string;
  leagueName: string;
  /** 4-digit, zero-padded. Both of our leagues have a 0001, so never key on this alone. */
  franchiseId: string;
  /** '' when MFL did not name it. */
  franchiseName: string;
  /** The MFL league year the team belongs to. */
  year: number;
}

export type MflLiveAppMyTeamsResponse =
  | { ok: true; teams: MflLiveAppMyTeam[] }
  /** `teams-unavailable`: MFL did not answer; the app keeps what it had. */
  | { ok: false; error: 'teams-unavailable' };
