/**
 * The phone side of the TV remote: which of the owner's paired TVs it talks
 * to, sending a command, and keeping the TV listening while a remote is open.
 * Shared by the board's TV remote button and the full-screen remote page
 * (`/live/broadcast/remote`), so both speak to `/api/broadcast-tv/remote` the
 * same way.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatRemoteCommand, type RemoteCommand } from '../../../utils/broadcast-remote-commands';

export interface PairedTv {
  id: string;
  device: string;
  createdAt: number;
}

/** Re-announce an open remote well inside the TV's 3-minute listening window. */
const KEEPALIVE_MS = 90_000;
const NOTE_MS = 2500;

/**
 * The owner's paired TVs; `null` until the first answer arrives. `known`
 * skips the fetch (a story, which has no server to ask).
 */
export function usePairedTvs(known?: PairedTv[]): PairedTv[] | null {
  const [tvs, setTvs] = useState<PairedTv[] | null>(known ?? null);
  useEffect(() => {
    if (known) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/broadcast-tv/remote', { headers: { accept: 'application/json' } });
        const body = res.ok ? ((await res.json()) as { tvs?: PairedTv[] }) : {};
        if (!cancelled) setTvs(Array.isArray(body.tvs) ? body.tvs : []);
      } catch (_err) {
        if (!cancelled) setTvs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [known]);
  return tvs;
}

/**
 * Two TVs of one kind ("Android TV", "Android TV") read as a choice between
 * nothing, so a repeated name says when it was paired: the newest pairing is
 * the one a re-paired TV is listening on. Two paired the same day fall back
 * to a number in pairing order.
 */
export function tvLabel(tvs: readonly PairedTv[], tv: PairedTv): string {
  const same = tvs.filter((t) => t.device === tv.device);
  if (same.length < 2) return tv.device;
  const day = (t: PairedTv) =>
    new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sameDay = same.filter((t) => day(t) === day(tv));
  const when = `paired ${day(tv)}`;
  return sameDay.length > 1 ? `${tv.device} ${same.indexOf(tv) + 1}, ${when}` : `${tv.device}, ${when}`;
}

const CHOSEN_TV_KEY = 'mfl.tvRemote.tv';

/**
 * Which TV the remote talks to before anyone picks: the one this phone last
 * chose, if it is still paired, else the NEWEST pairing. The list is oldest
 * first, and defaulting to its head sent every press to a pass left behind
 * when a TV was paired again without its old cookie (Brandon, Nov 2026).
 */
export function defaultTvId(tvs: readonly PairedTv[], remembered: string | null): string | null {
  if (remembered && tvs.some((t) => t.id === remembered)) return remembered;
  return tvs.length ? tvs[tvs.length - 1].id : null;
}

export function readChosenTv(): string | null {
  try {
    return window.localStorage.getItem(CHOSEN_TV_KEY);
  } catch (_err) {
    return null;
  }
}

export function rememberChosenTv(id: string): void {
  try {
    window.localStorage.setItem(CHOSEN_TV_KEY, id);
  } catch (_err) {
    /* a per-phone convenience only */
  }
}

export function useTvRemote(tvId: string | null, open: boolean) {
  const [note, setNote] = useState('');

  const post = useCallback(
    async (command: string): Promise<number> => {
      if (!tvId) return 0;
      try {
        const res = await fetch('/api/broadcast-tv/remote', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ passId: tvId, command }),
        });
        return res.status;
      } catch (_err) {
        return 0;
      }
    },
    [tvId],
  );

  /** Send each command in order; the note reports the last one. */
  const send = useCallback(
    async (commands: RemoteCommand | RemoteCommand[], label: string) => {
      let status = 0;
      for (const command of Array.isArray(commands) ? commands : [commands]) {
        status = await post(formatRemoteCommand(command));
        if (status !== 200) break;
      }
      setNote(
        status === 200
          ? `${label} — sent`
          : status === 404
            ? 'That TV is no longer paired'
            : status === 429
              ? 'Too many presses, try again in a moment'
              : 'Could not reach the TV',
      );
    },
    [post],
  );

  // An open remote wakes the TV's fast check, and keeps it awake.
  useEffect(() => {
    if (!open || !tvId) return;
    void post('open');
    const id = window.setInterval(() => void post('open'), KEEPALIVE_MS);
    return () => window.clearInterval(id);
  }, [open, tvId, post]);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(''), NOTE_MS);
    return () => window.clearTimeout(id);
  }, [note]);

  return { send, note };
}
