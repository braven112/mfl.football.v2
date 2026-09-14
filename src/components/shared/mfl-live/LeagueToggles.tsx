import { useCallback, useRef, useState } from 'react';
import { toggleMflLiveLeague } from '../../../utils/mfl-live-selection';

/**
 * The league switches on `/live/settings`.
 *
 * OPTIMISTIC, deliberately. The first cut made each switch a link that carried
 * the resulting `?leagues=` and let the route write the cookie — no JavaScript,
 * correct, and it felt like a page refresh on every tap, because that is
 * exactly what it was. A switch has to move under your thumb.
 *
 * So the state lives here, the knob slides on a CSS transition because the
 * element survives the change rather than being replaced by a fresh render,
 * and the write goes to `/api/live-leagues` afterwards. The board re-reads the
 * cookie on its next load; nothing here needs the server to answer first.
 *
 * A failed write is SHOWN rather than swallowed. Silently keeping a switch
 * that did not persist is how a setting comes back wrong tomorrow with no
 * explanation, so the row reverts and says so.
 */

export interface ToggleLeague {
  id: string;
  name: string;
  franchiseName: string;
  registered: boolean;
  icon: string;
  initials: string;
}

interface Props {
  leagues: ToggleLeague[];
  initialEnabled: string[];
}

type SaveState = 'idle' | 'saving' | 'failed';

export default function LeagueToggles({ leagues, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState<string[]>(initialEnabled);
  const [save, setSave] = useState<SaveState>('idle');
  /** The newest intent wins — an older in-flight write must not undo a newer tap. */
  const seq = useRef(0);

  const persist = useCallback(async (next: string[], previous: string[]) => {
    const mine = ++seq.current;
    setSave('saving');
    // Everything on is stored as "default", so a league joined next month
    // appears by itself rather than being excluded by a pinned list.
    const value = next.length === leagues.length ? 'default' : next.join(',');
    try {
      const res = await fetch('/api/live-leagues', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues: value }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (mine !== seq.current) return; // superseded by a later tap
      if (!res.ok || !data?.ok) throw new Error('rejected');
      setSave('idle');
    } catch {
      if (mine !== seq.current) return;
      // Put it back. A switch that stayed on without being saved is a lie the
      // owner only finds out about later.
      setEnabled(previous);
      setSave('failed');
    }
  }, [leagues.length]);

  const toggle = useCallback(
    (id: string) => {
      setEnabled((current) => {
        const allIds = leagues.map((l) => l.id);
        // The SHARED rule, imported rather than reimplemented. It is what
        // refuses to switch off the last league on — an empty selection reads
        // as "the default", and the default here is EVERY league, so the tap
        // would switch them all back on. `mfl-live-selection` is pure and
        // dependency-free, so the client can hold the same copy the server
        // does instead of a second one that drifts.
        const { selection, refused } = toggleMflLiveLeague(current, allIds, id);
        if (refused) return current;
        // `null` means "the default", which is everything.
        const next = selection ?? allIds;
        void persist(next, current);
        return next;
      });
    },
    [leagues, persist],
  );

  return (
    <>
      <ul className="mls__list">
        {leagues.map((league) => {
          const on = enabled.includes(league.id);
          const locked = on && enabled.length <= 1;
          return (
            <li className="mls__row" key={league.id}>
              <span className={`mls__mark${league.icon ? '' : ' mls__mark--text'}`} aria-hidden="true">
                {league.icon ? <img src={league.icon} alt="" loading="lazy" decoding="async" /> : league.initials}
              </span>

              <span className="mls__id">
                <span className="mls__name">{league.name}</span>
                <span className="mls__sub">
                  {league.franchiseName && <span>{league.franchiseName}</span>}
                  {!league.registered && <span className="mls__tag">Not on this site</span>}
                </span>
              </span>

              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={league.name}
                disabled={locked}
                title={locked ? 'At least one league has to stay on' : undefined}
                className={`mls__switch${on ? ' is-on' : ' is-off'}${locked ? ' is-locked' : ''}`}
                onClick={() => toggle(league.id)}
              >
                <span className="mls__knob" />
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mls__note" role="status">
        {save === 'failed' ? (
          <span className="mls__failed">
            Couldn&rsquo;t save that — put it back. Check your connection and try again.
          </span>
        ) : (
          <>
            {enabled.length} of {leagues.length} on. Switching a league off stops the board
            fetching it at all — which is what keeps a Sunday quick when you are in a lot of
            them. Choices are remembered on this device.
          </>
        )}
      </p>
    </>
  );
}
