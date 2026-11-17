/**
 * Owner links — the browser half of both pages (OwnerLinksPage,
 * OwnerLinksReviewPage).
 *
 * Wired on `astro:page-load` (the ClientRouter swaps the DOM under a script
 * that runs once per session), and every element is re-read from the swapped
 * root each time. The root's `data-owner-links-root` node is replaced by every
 * swap, so `dataset.bound` is fresh per visit.
 *
 * The API decides the league from the session; this script never sends one.
 */

const POST_JSON = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

function fillYears(select: HTMLSelectElement, years: number[], selected: number) {
  select.replaceChildren(
    ...years.map((y) => {
      const o = document.createElement('option');
      o.value = String(y);
      o.textContent = String(y);
      o.selected = y === selected;
      return o;
    }),
  );
  select.disabled = years.length === 0;
}

function showError(form: HTMLElement, message: string | null) {
  const el = form.querySelector<HTMLElement>('[data-olk-error]');
  if (!el) return;
  el.textContent = message ?? '';
  el.hidden = !message;
}

function wireCancel(dialog: HTMLDialogElement) {
  dialog.querySelectorAll<HTMLButtonElement>('[data-olk-cancel]').forEach((b) =>
    b.addEventListener('click', () => dialog.close()),
  );
  // A tap on the backdrop closes, like every sheet on the site.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

async function submitLink(
  form: HTMLFormElement,
  submit: HTMLButtonElement,
  body: Record<string, unknown>,
): Promise<boolean> {
  showError(form, null);
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = 'Saving…';
  try {
    const res = await POST_JSON('/api/owner-links', body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(form, data.error ?? 'Could not save that link.');
      return false;
    }
    return true;
  } catch {
    showError(form, 'Could not reach the server. Try again.');
    return false;
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
}

function wireRange(from: HTMLSelectElement, to: HTMLSelectElement) {
  from.addEventListener('change', () => {
    if (Number(to.value) < Number(from.value)) to.value = from.value;
  });
  to.addEventListener('change', () => {
    if (Number(from.value) > Number(to.value)) from.value = to.value;
  });
}

function initOwnerMode(root: HTMLElement) {
  const dialog = root.querySelector<HTMLDialogElement>('[data-olk-modal]');
  const form = root.querySelector<HTMLFormElement>('[data-olk-form]');
  const from = root.querySelector<HTMLSelectElement>('[data-olk-from]');
  const to = root.querySelector<HTMLSelectElement>('[data-olk-to]');
  const submit = root.querySelector<HTMLButtonElement>('[data-olk-submit]');
  if (!dialog || !form || !from || !to || !submit) return;
  const targetSelect = root.querySelector<HTMLSelectElement>('[data-olk-target]');
  const search = root.querySelector<HTMLInputElement>('[data-olk-search]');
  const noResults = root.querySelector<HTMLElement>('[data-olk-noresults]');
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-olk-tenure]'));
  wireCancel(dialog);
  wireRange(from, to);

  const target = () => targetSelect?.value ?? null;
  const applyFilter = () => {
    const q = (search?.value ?? '').trim().toLowerCase();
    const me = target();
    let shown = 0;
    for (const card of cards) {
      const visible = (!me || card.dataset.holder !== me) && (!q || (card.dataset.search ?? '').includes(q));
      card.hidden = !visible;
      if (visible) shown++;
    }
    if (noResults) noResults.hidden = shown > 0;
  };
  search?.addEventListener('input', applyFilter);
  targetSelect?.addEventListener('change', applyFilter);

  let current: { franchiseId: string } | null = null;
  root.querySelectorAll<HTMLButtonElement>('[data-olk-open]').forEach((button) =>
    button.addEventListener('click', () => {
      const years = (button.dataset.years ?? '').split(',').map(Number).filter(Number.isFinite);
      if (years.length === 0) return;
      current = { franchiseId: button.dataset.franchise ?? '' };
      root.querySelector('[data-olk-modal-name]')!.textContent = button.dataset.names || `Franchise ${current.franchiseId}`;
      root.querySelector('[data-olk-modal-meta]')!.textContent =
        `Franchise ${current.franchiseId} · on record under ${button.dataset.holderTitle ?? 'another owner'}. Trim the seasons if you only ran part of it.`;
      fillYears(from, years, years[0]);
      fillYears(to, years, years[years.length - 1]);
      const note = root.querySelector<HTMLTextAreaElement>('[data-olk-note]');
      if (note) note.value = '';
      showError(form, null);
      dialog.showModal();
    }),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current) return;
    const ok = await submitLink(form, submit, {
      franchiseId: current.franchiseId,
      yearStart: Number(from.value),
      yearEnd: Number(to.value),
      targetOwnerId: target() ?? undefined,
      note: root.querySelector<HTMLTextAreaElement>('[data-olk-note]')?.value ?? '',
    });
    if (ok) {
      dialog.close();
      window.location.reload();
    }
  });
}

interface ReviewData {
  owners: Array<{ ownerId: string; title: string }>;
  tenures: Array<{ holderOwnerId: string; holderTitle: string; franchiseId: string; years: number[]; names: string[]; yearStart: number; yearEnd: number }>;
}

function initReviewMode(root: HTMLElement) {
  let data: ReviewData = { owners: [], tenures: [] };
  try {
    data = JSON.parse(root.querySelector('[data-olk-data]')?.textContent ?? '{}');
  } catch {
    /* the decide buttons still work without it */
  }

  // ── Approve / decline / take back ──
  const decideDialog = root.querySelector<HTMLDialogElement>('[data-olk-decide-modal]');
  const decideForm = root.querySelector<HTMLFormElement>('[data-olk-decide-form]');
  const decideSubmit = root.querySelector<HTMLButtonElement>('[data-olk-decide-submit]');
  if (decideDialog && decideForm && decideSubmit) {
    wireCancel(decideDialog);
    let pending: { id: string; decision: string } | null = null;
    root.querySelectorAll<HTMLButtonElement>('[data-olk-decide]').forEach((button) =>
      button.addEventListener('click', () => {
        const row = button.closest<HTMLElement>('[data-olk-link]');
        const decision = button.dataset.olkDecide ?? '';
        pending = { id: button.dataset.id ?? '', decision };
        const approving = decision === 'approved';
        const takingBack = !approving && button.textContent?.trim() === 'Take back';
        root.querySelector('[data-olk-decide-eyebrow]')!.textContent = approving ? 'Approve' : takingBack ? 'Take back' : 'Decline';
        root.querySelector('[data-olk-decide-title]')!.textContent =
          row?.querySelector('.olk-row__title')?.textContent?.trim() ?? 'This link';
        root.querySelector('[data-olk-decide-meta]')!.textContent = approving
          ? 'These seasons move to the owner’s career on their page and in Ask the History right away.'
          : takingBack
            ? 'The seasons go back to whoever held them before the link.'
            : 'The owner sees it was declined, with your note.';
        decideSubmit.textContent = approving ? 'Approve' : takingBack ? 'Take back' : 'Decline';
        const note = root.querySelector<HTMLTextAreaElement>('[data-olk-decide-note]');
        if (note) note.value = '';
        showError(decideForm, null);
        decideDialog.showModal();
      }),
    );
    decideForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pending) return;
      showError(decideForm, null);
      decideSubmit.disabled = true;
      try {
        const res = await POST_JSON('/api/owner-links/decide', {
          id: pending.id,
          decision: pending.decision,
          note: root.querySelector<HTMLTextAreaElement>('[data-olk-decide-note]')?.value ?? '',
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(decideForm, body.error ?? 'Could not save that decision.');
          return;
        }
        decideDialog.close();
        window.location.reload();
      } catch {
        showError(decideForm, 'Could not reach the server. Try again.');
      } finally {
        decideSubmit.disabled = false;
      }
    });
  }

  // ── Link directly ──
  const dialog = root.querySelector<HTMLDialogElement>('[data-olk-modal]');
  const form = root.querySelector<HTMLFormElement>('[data-olk-form]');
  const owner = root.querySelector<HTMLSelectElement>('[data-olk-direct-owner]');
  const tenure = root.querySelector<HTMLSelectElement>('[data-olk-direct-tenure]');
  const from = root.querySelector<HTMLSelectElement>('[data-olk-from]');
  const to = root.querySelector<HTMLSelectElement>('[data-olk-to]');
  const submit = root.querySelector<HTMLButtonElement>('[data-olk-submit]');
  const open = root.querySelector<HTMLButtonElement>('[data-olk-direct]');
  if (!dialog || !form || !owner || !tenure || !from || !to || !submit || !open) return;
  wireCancel(dialog);
  wireRange(from, to);

  let options: ReviewData['tenures'] = [];
  const pickTenure = () => {
    const t = options[Number(tenure.value)];
    if (!t) {
      fillYears(from, [], 0);
      fillYears(to, [], 0);
      return;
    }
    fillYears(from, t.years, t.years[0]);
    fillYears(to, t.years, t.years[t.years.length - 1]);
  };
  owner.addEventListener('change', () => {
    options = data.tenures.filter((t) => t.holderOwnerId !== owner.value);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = owner.value ? 'Choose a team…' : 'Choose the owner first';
    tenure.replaceChildren(
      placeholder,
      ...options.map((t, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        const span = t.yearStart === t.yearEnd ? `${t.yearStart}` : `${t.yearStart}–${t.yearEnd}`;
        o.textContent = `${t.names.join(' / ') || `Franchise ${t.franchiseId}`} · ${span} · #${t.franchiseId} (${t.holderTitle})`;
        return o;
      }),
    );
    tenure.disabled = !owner.value;
    pickTenure();
  });
  tenure.addEventListener('change', pickTenure);
  open.addEventListener('click', () => {
    showError(form, null);
    dialog.showModal();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = options[Number(tenure.value)];
    if (!owner.value || !t) {
      showError(form, 'Choose the owner and the team they ran.');
      return;
    }
    const ok = await submitLink(form, submit, {
      targetOwnerId: owner.value,
      franchiseId: t.franchiseId,
      yearStart: Number(from.value),
      yearEnd: Number(to.value),
      note: root.querySelector<HTMLTextAreaElement>('[data-olk-modal] [data-olk-note]')?.value ?? '',
    });
    if (ok) {
      dialog.close();
      window.location.reload();
    }
  });
}

export function initOwnerLinks() {
  const root = document.querySelector<HTMLElement>('[data-owner-links-root]');
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  if (root.dataset.mode === 'review') initReviewMode(root);
  else initOwnerMode(root);
}
