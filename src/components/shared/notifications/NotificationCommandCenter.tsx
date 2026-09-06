/**
 * Notification command center — per-category push preferences.
 *
 * Loaded from /api/push/preferences rather than rendered into the page: the
 * category list is per-league and the values are per-owner, and a settings
 * page is exactly the sort of thing that gets cached.
 *
 * Saves are OPTIMISTIC. Toggling a switch and then waiting on a round trip
 * makes a page of switches feel broken; the row flips immediately and rolls
 * back to the last server-confirmed state if the save fails.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Group {
  id: string;
  label: string;
  description: string;
}

interface Category {
  id: string;
  group: string;
  label: string;
  description: string;
  cadence: string;
  defaultOn: boolean;
}

type Prefs = Record<string, boolean>;
type Load = 'loading' | 'ready' | 'error';

export default function NotificationCommandCenter() {
  const [load, setLoad] = useState<Load>('loading');
  const [groups, setGroups] = useState<Group[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  // The last state the SERVER confirmed, so a failed save rolls back to truth
  // rather than to whatever the UI happened to be showing a moment earlier.
  const confirmed = useRef<Prefs>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/push/preferences', { credentials: 'same-origin' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        setGroups(data.groups ?? []);
        setCategories(data.categories ?? []);
        setPrefs(data.preferences ?? {});
        confirmed.current = data.preferences ?? {};
        setLoad('ready');
      } catch {
        if (!cancelled) setLoad('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Send only the choices that DIFFER from the category's default.
   *
   * The GET hands back effective values — the owner's choice or the default
   * for every visible category — so posting the map back wholesale would
   * write ~13 explicit rows the first time anyone flips one switch. Storage
   * is supposed to hold explicit choices only (see push-preferences.ts), and
   * the property that buys is that a default we later CHANGE still reaches
   * everyone who never disagreed with it. Post the whole map and that
   * property is gone for every owner who has ever touched this page.
   *
   * Dropping a choice that happens to equal the default is safe: it resolves
   * to the same value on read, and if the default later moves, following it
   * is the intended behavior for someone who never expressed a preference.
   */
  const explicitOnly = useCallback(
    (next: Prefs): Prefs => {
      const out: Prefs = {};
      for (const category of categories) {
        const value = next[category.id];
        if (typeof value === 'boolean' && value !== category.defaultOn) {
          out[category.id] = value;
        }
      }
      return out;
    },
    [categories],
  );

  const save = useCallback(async (next: Prefs) => {
    setError(null);
    try {
      const res = await fetch('/api/push/preferences', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: explicitOnly(next) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        setPrefs(confirmed.current);
        setError(data?.error ?? 'Could not save that change.');
        return;
      }
      confirmed.current = data.preferences ?? next;
      setPrefs(data.preferences ?? next);
      setSavedAt(Date.now());
    } catch {
      setPrefs(confirmed.current);
      setError('Could not reach the server.');
    }
  }, [explicitOnly]);

  const toggle = useCallback(
    (id: string) => {
      setPrefs((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        void save(next);
        return next;
      });
    },
    [save],
  );

  const setGroupAll = useCallback(
    (groupId: string, on: boolean) => {
      setPrefs((prev) => {
        const next = { ...prev };
        for (const c of categories) if (c.group === groupId) next[c.id] = on;
        void save(next);
        return next;
      });
    },
    [categories, save],
  );

  const byGroup = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    return map;
  }, [categories]);

  const onCount = useMemo(() => categories.filter((c) => prefs[c.id]).length, [categories, prefs]);

  if (load === 'loading') return <p className="ncc__note">Loading your alerts…</p>;
  if (load === 'error') {
    return (
      <div className="ncc__callout" role="alert">
        <strong>Couldn’t load your alert settings.</strong>
        <p>That’s a problem on our end, not a setting you changed. Refresh to try again.</p>
      </div>
    );
  }

  return (
    <section className="ncc" aria-labelledby="ncc-title">
      <header className="ncc__head">
        <div>
          <h2 id="ncc-title" className="ncc__title">Choose your alerts</h2>
          <p className="ncc__sub">
            Deadlines come here first now. The group chat still posts them, but
            only for the owners we could not reach — and it names them. Turn the
            ones you care about on and you stop being one of them.
          </p>
        </div>
        <p className="ncc__count" aria-live="polite">
          <strong>{onCount}</strong> of {categories.length} on
          {savedAt > 0 && <span className="ncc__saved"> · saved</span>}
        </p>
      </header>

      {error && (
        <p className="ncc__error" role="alert">
          {error}
        </p>
      )}

      {groups
        .filter((g) => (byGroup.get(g.id) ?? []).length > 0)
        .map((group) => {
          const rows = byGroup.get(group.id)!;
          const allOn = rows.every((c) => prefs[c.id]);
          return (
            <section className="ncc__group" key={group.id} aria-labelledby={`ncc-g-${group.id}`}>
              <div className="ncc__group-head">
                <div>
                  <h3 id={`ncc-g-${group.id}`} className="ncc__group-title">
                    {group.label}
                  </h3>
                  <p className="ncc__group-desc">{group.description}</p>
                </div>
                <button
                  type="button"
                  className="ncc__all"
                  onClick={() => setGroupAll(group.id, !allOn)}
                >
                  {allOn ? 'Turn all off' : 'Turn all on'}
                </button>
              </div>

              <ul className="ncc__list">
                {rows.map((c) => (
                  <li className="ncc__row" key={c.id}>
                    {/* A real checkbox, visually restyled — keyboard-reachable
                        and announced correctly without reimplementing either. */}
                    <label className="ncc__label">
                      <input
                        type="checkbox"
                        className="ncc__input"
                        checked={Boolean(prefs[c.id])}
                        onChange={() => toggle(c.id)}
                      />
                      <span className="ncc__switch" aria-hidden="true" />
                      <span className="ncc__text">
                        <span className="ncc__name">
                          {c.label}
                          {c.defaultOn && <span className="ncc__badge">On by default</span>}
                        </span>
                        <span className="ncc__desc">{c.description}</span>
                        <span className="ncc__cadence">{c.cadence}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </section>
  );
}
