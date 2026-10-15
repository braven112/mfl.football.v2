/**
 * The TV remote's closed command list (docs/plans/broadcast-handheld.md,
 * Phase 4), in a module with no server imports so the TV's island can parse
 * every command again on arrival. The server half is
 * `broadcast-tv-remote.ts`.
 */

export type RemoteCommand =
  | { kind: 'pin-league'; leagueId: string }
  | { kind: 'page'; dir: 'next' | 'prev' }
  | { kind: 'sound'; on: boolean }
  | { kind: 'reset' };

/** What the TV reads: is a remote active, and the latest command if any. */
export interface RemoteState {
  active: boolean;
  /** Increases with every command; the TV applies each seq once. */
  seq: number;
  /**
   * The command in its wire form (`'page:next'`), or null. A string, so the
   * TV runs it through `parseRemoteCommand` itself rather than trusting a
   * shape it was handed.
   */
  command: string | null;
}

/** League ids are MFL's, digits only. */
const LEAGUE_ID = /^\d{1,12}$/;

/** The closed list. Anything else, including any extra character, is null. */
export function parseRemoteCommand(raw: unknown): RemoteCommand | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  switch (raw) {
    case 'page:next':
      return { kind: 'page', dir: 'next' };
    case 'page:prev':
      return { kind: 'page', dir: 'prev' };
    case 'sound:on':
      return { kind: 'sound', on: true };
    case 'sound:off':
      return { kind: 'sound', on: false };
    case 'reset':
      return { kind: 'reset' };
  }
  const m = /^pin-league:(.+)$/.exec(raw);
  if (m && LEAGUE_ID.test(m[1])) return { kind: 'pin-league', leagueId: m[1] };
  return null;
}

export function formatRemoteCommand(command: RemoteCommand): string {
  switch (command.kind) {
    case 'pin-league':
      return `pin-league:${command.leagueId}`;
    case 'page':
      return `page:${command.dir}`;
    case 'sound':
      return `sound:${command.on ? 'on' : 'off'}`;
    case 'reset':
      return 'reset';
  }
}
