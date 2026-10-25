/**
 * Owner Map — the hometown picker.
 *
 * Every "Pick"/"Change" button on the page opens one dialog. Typing searches
 * the bundled place list (src/data/owner-map-places.json: US towns, US
 * states, countries and large cities abroad), loaded only when the dialog
 * first opens. Choosing a place saves it through /api/owner-map/hometown and
 * reloads, so the map, the list and every filter redraw from the saved data.
 *
 * Independent of the map on purpose: a phone that cannot run WebGL can still
 * set a hometown.
 */
import placesUrl from '../../../data/owner-map-places.json?url';

type PlaceRow = [string, string, number, number, 'city' | 'state' | 'country'];

const MAX_RESULTS = 12;

let placesPromise: Promise<PlaceRow[]> | null = null;
const loadPlaces = () => {
  placesPromise ??= fetch(placesUrl).then((r) => {
    if (!r.ok) throw new Error(`Could not load the place list (${r.status}).`);
    return r.json() as Promise<PlaceRow[]>;
  });
  return placesPromise;
};

/** "São Paulo" → "sao paulo", so a search typed without accents still finds it. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const placeLabel = (row: PlaceRow) =>
  row[4] === 'state'
    ? `${row[0]} (the whole state, pinned at its middle)`
    : row[4] === 'country'
      ? `${row[0]} (the whole country, pinned at its middle)`
      : `${row[0]}, ${row[1]}`;

/**
 * Places whose name starts with the query come first, then "Name, Region"
 * matches ("ames, ia"), then names that merely contain it. The list is in
 * population order, so within each group the bigger place leads.
 */
export function searchPlaces(places: PlaceRow[], query: string): PlaceRow[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const [namePart, regionPart] = q.split(',').map((part) => part.trim());
  const starts: PlaceRow[] = [];
  const contains: PlaceRow[] = [];
  for (const row of places) {
    const name = fold(row[0]);
    if (regionPart !== undefined) {
      if (name.startsWith(namePart) && fold(row[1]).startsWith(regionPart)) starts.push(row);
    } else if (name.startsWith(q)) starts.push(row);
    else if (q.length >= 3 && name.includes(q)) contains.push(row);
    if (starts.length >= MAX_RESULTS) break;
  }
  return [...starts, ...contains].slice(0, MAX_RESULTS);
}

export function mountHometownPicker(root: HTMLElement): () => void {
  const dialog = root.querySelector<HTMLDialogElement>('[data-owner-map-picker]');
  if (!dialog) return () => {};
  const title = dialog.querySelector<HTMLElement>('[data-picker-title]');
  const input = dialog.querySelector<HTMLInputElement>('[data-picker-input]');
  const results = dialog.querySelector<HTMLElement>('[data-picker-results]');
  const status = dialog.querySelector<HTMLElement>('[data-picker-status]');
  const clear = dialog.querySelector<HTMLButtonElement>('[data-picker-clear]');
  const close = dialog.querySelector<HTMLButtonElement>('[data-picker-close]');
  const league = root.dataset.league ?? '';
  let franchiseId = '';
  let places: PlaceRow[] = [];
  let saving = false;

  const say = (text: string) => {
    if (status) status.textContent = text;
  };

  async function save(payload: Record<string, unknown>) {
    if (saving) return;
    saving = true;
    say('Saving…');
    try {
      const res = await fetch(`/api/owner-map/hometown?league=${encodeURIComponent(league)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseId, ...payload }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
      if (!res.ok || !data.success) throw new Error(data.message || `Could not save (${res.status}).`);
      say('Saved.');
      window.location.reload();
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      saving = false;
    }
  }

  function render() {
    if (!results || !input) return;
    const matches = searchPlaces(places, input.value);
    results.replaceChildren(
      ...matches.map((row) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'owner-map-picker__result';
        button.textContent = placeLabel(row);
        button.addEventListener('click', () => save({ name: row[0], region: row[1] }));
        li.appendChild(button);
        return li;
      }),
    );
    if (input.value.trim().length >= 2 && !matches.length) say('No match. Try the nearest bigger city, or the state.');
    else say('');
  }

  const open = async (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    franchiseId = button.dataset.franchise ?? '';
    if (title) title.textContent = `Hometown for ${button.dataset.team ?? 'this team'}`;
    if (clear) clear.hidden = button.dataset.hasHometown !== '1';
    if (input) input.value = '';
    results?.replaceChildren();
    say('');
    dialog.showModal();
    input?.focus();
    try {
      places = await loadPlaces();
      render();
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    }
  };

  const openers = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-owner-map-pick]'));
  openers.forEach((button) => button.addEventListener('click', open));
  input?.addEventListener('input', render);
  clear?.addEventListener('click', () => save({ clear: true }));
  close?.addEventListener('click', () => dialog.close());

  return () => {
    openers.forEach((button) => button.removeEventListener('click', open));
    if (dialog.open) dialog.close();
  };
}

/**
 * The commissioner's paste-in import: many teams in one save. The server
 * parses and checks every line (all or nothing) and lists the bad ones, so
 * this only posts the text and shows the answer.
 */
export function mountHometownImport(root: HTMLElement): void {
  const box = root.querySelector<HTMLElement>('[data-owner-map-import]');
  const text = box?.querySelector<HTMLTextAreaElement>('[data-import-text]');
  const save = box?.querySelector<HTMLButtonElement>('[data-import-save]');
  const status = box?.querySelector<HTMLElement>('[data-import-status]');
  if (!box || !text || !save || !status) return;
  const league = root.dataset.league ?? '';
  const franchiseIds = (text.dataset.franchiseIds ?? '').split(',').filter(Boolean);

  save.addEventListener('click', async () => {
    save.disabled = true;
    status.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/owner-map/hometown-import?league=${encodeURIComponent(league)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.value, franchiseIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        saved?: number;
        message?: string;
        errors?: { line: number; text: string; message: string }[];
      };
      if (res.ok && data.success) {
        status.textContent = `Saved ${data.saved} ${data.saved === 1 ? 'team' : 'teams'}.`;
        window.location.reload();
        return;
      }
      status.replaceChildren(document.createTextNode(data.message || `Could not save (${res.status}).`));
      if (data.errors?.length) {
        const list = document.createElement('ul');
        for (const error of data.errors) {
          const li = document.createElement('li');
          li.textContent = `Line ${error.line}: ${error.message}`;
          list.appendChild(li);
        }
        status.appendChild(list);
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
    save.disabled = false;
  });
}
