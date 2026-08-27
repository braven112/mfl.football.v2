/**
 * DraftListSync — pull the owner's My Draft List down from MFL, or push the
 * current board back up to it.
 *
 * Deliberately two explicit buttons and no autosync. MFL's import is a
 * complete overwrite with no timestamps and no partial ops, so a background
 * reconciler has no safe way to decide who won; a push happens when an owner
 * asks for it and at no other time. (It could not run on a timer anyway —
 * MFL only accepts this write from a logged-in owner's own cookie.)
 *
 * Push is gated on a confirmation that states the count being written and
 * names any player the board carries that MFL cannot be sent — an id we can't
 * resolve in the league's player feed is BLOCKED rather than dropped, because
 * silently shipping a shorter list is how an owner discovers on draft night
 * that twelve players are missing.
 *
 * That confirmation is IN-PAGE, never `window.confirm`. The first version used
 * the native dialog and the push silently did nothing on mobile: DuckDuckGo
 * suppresses `confirm()`, which returns false, and `if (!confirmed) return`
 * was the one path out of the handler that reported nothing. Vercel logs
 * showed page loads and GETs and not a single POST. A destructive action must
 * never depend on a modal the browser is free to refuse to show.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { activeRankingsScope } from '../../../utils/rankings-scope';

interface Snapshot {
  playerIds: string[];
  takenAt: string;
}

interface Props {
  /**
   * Exactly what a push sends: the board in its own order, already narrowed
   * by the availability filter when that is on. Not narrowed by the position
   * filter — see the note on pushableRankings in the board island.
   */
  rankings: string[];
  /** Size of the unfiltered board, so the UI can say what is being left out. */
  boardTotal?: number;
  /** Name of the active availability filter, or null when it is off. */
  filterLabel?: string | null;
  /** Resolver for a display name; returns null for an id we can't identify. */
  resolveName: (id: string) => string | null;
  /** Called with MFL's list when a pull succeeds. */
  onPulled: (playerIds: string[]) => void;
  /**
   * Ids this franchise can actually draft, or null when unknown.
   *
   * Used only to WARN, never to silently trim the push. TheLeague drafts
   * rookies only, so a board seeded from a full-league composite is mostly
   * players its draft cannot take — worth saying out loud before overwriting,
   * since MFL accepts the write either way and what it keeps is its business.
   */
  availableIds?: Set<string> | null;
  /** MFL's draftPlayerPool, for naming the limit in that warning. */
  draftPool?: string | null;
}

type Phase = 'idle' | 'pulling' | 'pushing' | 'restoring';

/** Which destructive action is awaiting in-page confirmation. */
type Pending = null | { kind: 'push'; count: number } | { kind: 'restore'; count: number };

const apiUrl = (extra = '') =>
  `/api/draft-list?league=${encodeURIComponent(activeRankingsScope())}${extra}`;

export default function DraftListSync({
  rankings,
  boardTotal,
  filterLabel = null,
  resolveName,
  onPulled,
  availableIds = null,
  draftPool = null,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const busy = phase !== 'idle';

  const outOfPool = useMemo(
    () => (availableIds ? rankings.filter((id) => !availableIds.has(id)).length : 0),
    [availableIds, rankings],
  );

  const say = useCallback((text: string, error = false) => {
    setMessage(text);
    setIsError(error);
  }, []);

  // Surface an existing snapshot on mount so "Undo last push" is available
  // across a reload — the undo buffer lives in KV, not in this component.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl());
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.snapshot) setSnapshot(data.snapshot);
      } catch {
        /* a missing snapshot is not worth reporting on load */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePull = useCallback(async () => {
    if (busy) return;
    setPhase('pulling');
    say('Reading your draft list from MFL…');
    try {
      const res = await fetch(apiUrl());
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        say(data?.error ?? 'Could not read your MFL draft list.', true);
        return;
      }
      if (data.snapshot) setSnapshot(data.snapshot);
      const ids: string[] = data.playerIds ?? [];
      if (ids.length === 0) {
        say('MFL has no draft list for your franchise yet — nothing to pull.');
        return;
      }
      // Keep only ids this league's player feed can name. An unnameable id
      // would land on the board invisibly (the list renders by lookup) and
      // then block every later push — so drop it here and say so, rather
      // than leaving the owner with a board they cannot push and cannot see.
      const known = ids.filter((id) => resolveName(id));
      const skipped = ids.length - known.length;
      if (known.length === 0) {
        say('MFL returned a list, but none of its players are in this league\u2019s player feed.', true);
        return;
      }
      onPulled(known);
      say(
        `Pulled ${known.length} player${known.length === 1 ? '' : 's'} from MFL.` +
          (skipped > 0 ? ` Skipped ${skipped} not in this league\u2019s player feed.` : ''),
      );
    } catch (err) {
      say(`Could not reach the server: ${(err as Error).message}`, true);
    } finally {
      setPhase('idle');
    }
  }, [busy, onPulled, resolveName, say]);

  const handlePush = useCallback(async () => {
    if (busy) return;

    if (rankings.length === 0) {
      say(
        filterLabel
          ? `No players on your board pass the "${filterLabel}" filter, so there is nothing to push. ` +
              'Turn the filter off to push your whole board.'
          : 'Your board is empty, so there is nothing to push. Pull your list from MFL, ' +
              'or set up Import Rankings to build one.',
        true,
      );
      return;
    }

    // Block, don't drop. An id with no name is one MFL would silently omit.
    const unresolved = rankings.filter((id) => !resolveName(id));
    if (unresolved.length > 0) {
      say(
        `${unresolved.length} player${unresolved.length === 1 ? '' : 's'} on your board ` +
          `${unresolved.length === 1 ? 'is' : 'are'} not in this league's player list ` +
          `(${unresolved.slice(0, 5).join(', ')}${unresolved.length > 5 ? '…' : ''}). ` +
          'Remove them before pushing, or MFL will drop them without telling you.',
        true,
      );
      return;
    }

    setPending({ kind: 'push', count: rankings.length });
    say(`Ready to overwrite your MFL draft list with ${rankings.length} players. Confirm below.`);
  }, [busy, rankings, resolveName, filterLabel, say]);

  const runPush = useCallback(async () => {
    setPending(null);

    // Re-validate against the CURRENT list. The panel's count is frozen at arm
    // time, but the board behind it stays interactive — toggling the
    // availability filter while the confirmation is open would otherwise have
    // an owner confirm "Overwrite 250" and write 40. Same for the unresolved-id
    // block: it has to hold at the moment of the write, not when it was armed.
    if (rankings.length === 0) {
      say('That list is now empty — nothing was sent to MFL.', true);
      return;
    }
    const stillUnresolved = rankings.filter((id) => !resolveName(id));
    if (stillUnresolved.length > 0) {
      say(
        `The board changed while that was open — ${stillUnresolved.length} player` +
          `${stillUnresolved.length === 1 ? '' : 's'} cannot be sent to MFL. Nothing was written.`,
        true,
      );
      return;
    }

    setPhase('pushing');
    say('Writing your board to MFL…');
    try {
      const res = await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerIds: rankings }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        say(data?.error ?? 'MFL rejected the draft list.', true);
        return;
      }
      say(
        `Pushed ${data.count} player${data.count === 1 ? '' : 's'} to MFL.` +
          (data.snapshotSaved ? '' : ' (Your previous list could not be saved — no undo available.)'),
      );
      // Re-read so the undo buffer shown matches what the server actually kept.
      try {
        const after = await fetch(apiUrl());
        const afterData = await after.json();
        if (afterData?.snapshot) setSnapshot(afterData.snapshot);
      } catch { /* the push already succeeded; undo state can lag */ }
    } catch (err) {
      say(`Could not reach the server: ${(err as Error).message}`, true);
    } finally {
      setPhase('idle');
    }
  }, [rankings, resolveName, say]);

  const handleRestore = useCallback(() => {
    if (busy || !snapshot) return;
    setPending({ kind: 'restore', count: snapshot.playerIds.length });
    say(`Ready to put back the ${snapshot.playerIds.length}-player list MFL had before your last push. Confirm below.`);
  }, [busy, snapshot, say]);

  const runRestore = useCallback(async () => {
    setPending(null);
    setPhase('restoring');
    say('Restoring your previous MFL list…');
    try {
      const res = await fetch(apiUrl('&restore=1'), { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        say(data?.error ?? 'Could not restore your previous list.', true);
        return;
      }
      say(`Restored ${data.count} player${data.count === 1 ? '' : 's'} to MFL.`);
    } catch (err) {
      say(`Could not reach the server: ${(err as Error).message}`, true);
    } finally {
      setPhase('idle');
    }
  }, [say]);

  const cancelPending = useCallback(() => {
    setPending(null);
    say('Cancelled — nothing was sent to MFL.');
  }, [say]);

  return (
    <div className="cr-sync">
      <div className="cr-sync__actions">
        <button className="cr-btn cr-btn--sm" onClick={handlePull} disabled={busy} type="button">
          {phase === 'pulling' ? 'Pulling…' : 'Pull from MFL'}
        </button>
        <button className="cr-btn cr-btn--sm" onClick={handlePush} disabled={busy || pending !== null} type="button">
          {phase === 'pushing'
            ? 'Pushing…'
            : filterLabel
              ? `Push ${rankings.length} to MFL`
              : 'Push to MFL'}
        </button>
        {snapshot && snapshot.playerIds.length > 0 && (
          <button className="cr-btn cr-btn--sm" onClick={handleRestore} disabled={busy || pending !== null} type="button">
            {phase === 'restoring' ? 'Restoring…' : 'Undo last push'}
          </button>
        )}
      </div>
      {pending && (
        <div className="cr-sync__confirm" role="group" aria-label="Confirm writing to MFL">
          <p className="cr-sync__confirm-text">
            {pending.kind === 'push'
              ? `This completely replaces your My Draft List on MFL with these ${pending.count} players, in this order. Your current list is saved first so you can undo it.` +
                (filterLabel && boardTotal && boardTotal > pending.count
                  ? ` The "${filterLabel}" filter is on, so ${boardTotal - pending.count} of your ${boardTotal} board players are being left off.`
                  : '') +
                (outOfPool > 0
                  ? ` ${outOfPool} of them are outside this league's draft pool${draftPool === 'Rookie' ? ' (it drafts rookies only)' : ''} — MFL decides what it keeps.`
                  : '')
              : `This overwrites what is on MFL right now with the ${pending.count} players it held before your last push.`}
          </p>
          <div className="cr-sync__confirm-actions">
            <button
              className="cr-btn cr-btn--sm cr-btn--danger"
              onClick={pending.kind === 'push' ? runPush : runRestore}
              type="button"
            >
              {pending.kind === 'push' ? `Overwrite ${pending.count} on MFL` : 'Restore on MFL'}
            </button>
            <button className="cr-btn cr-btn--sm" onClick={cancelPending} type="button">
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && (
        <p
          className={`cr-sync__status${isError ? ' cr-sync__status--error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      )}
    </div>
  );
}
