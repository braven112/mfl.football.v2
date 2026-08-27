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
 */

import { useCallback, useEffect, useState } from 'react';
import { activeRankingsScope } from '../../../utils/rankings-scope';

interface Snapshot {
  playerIds: string[];
  takenAt: string;
}

interface Props {
  /** Current board order, as MFL player ids. */
  rankings: string[];
  /** Resolver for a display name; returns null for an id we can't identify. */
  resolveName: (id: string) => string | null;
  /** Called with MFL's list when a pull succeeds. */
  onPulled: (playerIds: string[]) => void;
}

type Phase = 'idle' | 'pulling' | 'pushing' | 'restoring';

const apiUrl = (extra = '') =>
  `/api/draft-list?league=${encodeURIComponent(activeRankingsScope())}${extra}`;

export default function DraftListSync({ rankings, resolveName, onPulled }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const busy = phase !== 'idle';

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
      say('Your board is empty — there is nothing to push.', true);
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

    const confirmed = confirm(
      `Overwrite your My Draft List on MFL with these ${rankings.length} players, in this order?\n\n` +
        'This completely replaces whatever MFL currently has. Your previous list is saved ' +
        'so you can undo it.',
    );
    if (!confirmed) return;

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
  }, [busy, rankings, resolveName, say]);

  const handleRestore = useCallback(async () => {
    if (busy || !snapshot) return;
    const confirmed = confirm(
      `Put back the ${snapshot.playerIds.length}-player list MFL had before your last push?\n\n` +
        'This overwrites what is on MFL right now.',
    );
    if (!confirmed) return;

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
  }, [busy, snapshot, say]);

  return (
    <div className="cr-sync">
      <div className="cr-sync__actions">
        <button className="cr-btn cr-btn--sm" onClick={handlePull} disabled={busy} type="button">
          {phase === 'pulling' ? 'Pulling…' : 'Pull from MFL'}
        </button>
        <button className="cr-btn cr-btn--sm" onClick={handlePush} disabled={busy} type="button">
          {phase === 'pushing' ? 'Pushing…' : 'Push to MFL'}
        </button>
        {snapshot && snapshot.playerIds.length > 0 && (
          <button className="cr-btn cr-btn--sm" onClick={handleRestore} disabled={busy} type="button">
            {phase === 'restoring' ? 'Restoring…' : 'Undo last push'}
          </button>
        )}
      </div>
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
