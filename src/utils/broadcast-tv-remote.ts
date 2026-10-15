/**
 * The phone as a remote for a paired TV (docs/plans/broadcast-handheld.md,
 * Phase 4).
 *
 * DISPLAY-ONLY, and a closed list. A command is one of a handful of fixed
 * strings — focus one league, turn the strip a page, sound on or off, back to
 * normal — parsed on the server when it is sent and again on the TV when it
 * arrives. It never carries free text, a URL or markup, so nothing sent here
 * can make a TV show someone else's content or navigate anywhere.
 *
 * Who may send: the owner's SESSION, never a pass. A TV's pass is watch-only;
 * it can read the command addressed to it and nothing else. The phone names a
 * TV by its public pass id, and `passHashForOwner` resolves that id ONLY in
 * the session owner's own index, so there is no id one owner can send that
 * reaches another owner's television.
 *
 * Stored per TV, under the pass's HASH, one record, last write wins:
 *   bctv:remote:<sha(token)>   { activeUntil, seq, command }   REMOTE_TTL_S
 *
 * `activeUntil` is what keeps a TV's Redis reads cheap. Its normal 8-second
 * poll reads this one key; only while a phone has had the remote open in the
 * last few minutes does the TV also check it every second, then drop back.
 *
 * PURE over the pairing store, so it is unit-tested against a Map.
 */
import { passHashForOwner, type PairingStore } from './broadcast-tv-pairing';
import {
  formatRemoteCommand,
  parseRemoteCommand,
  type RemoteState,
} from './broadcast-remote-commands';

export { formatRemoteCommand, parseRemoteCommand, type RemoteCommand, type RemoteState } from './broadcast-remote-commands';

/** How long after the phone last touched the remote the TV keeps listening fast. */
export const REMOTE_ACTIVE_MS = 3 * 60 * 1000;
/** The record outlives the active window only by a little; nothing reads it after. */
export const REMOTE_TTL_S = 4 * 60;

interface StoredRemote {
  activeUntil: number;
  seq: number;
  command: string | null;
}

const remoteKey = (passHash: string) => `bctv:remote:${passHash}`;

/**
 * `'open'` is not a command: it is the phone saying "the remote is up", which
 * moves the TV to its fast check before the first button is pressed.
 */
export const REMOTE_OPEN = 'open';

export type SendResult = 'sent' | 'not-found' | 'invalid';

/** The owner's phone sending one command (or `'open'`) to one of their TVs. */
export async function sendRemoteCommand(
  store: PairingStore,
  owner: string,
  passId: string,
  raw: string,
  now: number = Date.now(),
): Promise<SendResult> {
  const command = raw === REMOTE_OPEN ? null : parseRemoteCommand(raw);
  if (raw !== REMOTE_OPEN && !command) return 'invalid';
  const hash = await passHashForOwner(store, owner, passId);
  if (!hash) return 'not-found';

  const prev = await store.get<StoredRemote>(remoteKey(hash));
  const next: StoredRemote = command
    ? {
        activeUntil: now + REMOTE_ACTIVE_MS,
        // Strictly increasing even within one millisecond, so the TV never
        // mistakes a second press for the first one it already applied.
        seq: Math.max(now, (prev?.seq ?? 0) + 1),
        command: formatRemoteCommand(command),
      }
    : { activeUntil: now + REMOTE_ACTIVE_MS, seq: prev?.seq ?? 0, command: prev?.command ?? null };
  await store.set(remoteKey(hash), next, { ex: REMOTE_TTL_S });
  return 'sent';
}

/** The TV reading the record addressed to its own pass. */
export async function readRemoteState(
  store: PairingStore,
  passHash: string,
  now: number = Date.now(),
): Promise<RemoteState> {
  const stored = await store.get<StoredRemote>(remoteKey(passHash));
  if (!stored) return { active: false, seq: 0, command: null };
  return {
    active: typeof stored.activeUntil === 'number' && stored.activeUntil > now,
    seq: typeof stored.seq === 'number' ? stored.seq : 0,
    // Validated again on the way out: a record is only ever a closed-list string.
    command: parseRemoteCommand(stored.command) ? stored.command : null,
  };
}
