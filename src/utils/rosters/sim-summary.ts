/**
 * Simulated roster moves, summarised for the phone surfaces
 * (docs/plans/rosters-mobile-layout.md § 6): the cap card under the header,
 * the sticky sim bar, and the Cap by year review sheet.
 *
 * ONE COMPUTATION. `updateView` in `theleague/rosters.astro` already computes
 * the simulated cap charges, dead money and space that the table footer
 * prints; it hands those same numbers here, plus a baseline computed in the
 * same pass with no actions applied. Nothing here reads a DOM value back as an
 * input — a cached cell would be a second, drifting copy of the cap math.
 *
 * The row transform (`applySimActionsToRows`) and the cut dead-money add
 * (`addSimDeadMoney`) are the exact rules `updateView` used inline; it now
 * calls these, so the baseline, each per-move effect and the table are all
 * produced by one implementation.
 */

import { escapeHtml } from '../player-cell-html';

export interface SimAction {
  type?: string;
  playerId?: string | number;
  playerName?: string;
  playerPosition?: string;
  newSalary?: unknown;
  newYears?: unknown;
  currentPenalty?: unknown;
  futurePenalty?: unknown;
  ufaYearIndex?: number;
  [key: string]: unknown;
}

export type SimActions = Record<string, SimAction>;

/** The fields of a roster row these rules read — a `CapPlayer` with an id. */
export interface SimRow {
  id?: string | number;
  salary?: number | string;
  contractYears?: number | string;
  displayTag?: string;
}

/**
 * The roster rows as a simulation shows them. Cut and traded players stay
 * (the table greys them out), franchise tags and team options leave the row
 * alone (they price a FUTURE year, at `ufaYearIndex`), and an extension
 * rewrites salary and years.
 */
export function applySimActionsToRows<T extends SimRow>(rows: readonly T[], actions: SimActions): T[] {
  return rows.map((player) => {
    const action = actions[String(player.id ?? '')];
    if (!action) return player;
    if (action.type === 'cut' || action.type === 'trade') return player;
    if (action.type === 'franchise' || action.type === 'team-option') return player;
    return {
      ...player,
      salary: (action.newSalary ?? player.salary) as T['salary'],
      contractYears: (action.newYears ?? player.contractYears) as T['contractYears'],
    };
  });
}

/** The rows still on the roster once simulated cuts and trades have left it. */
export function withoutSimRemoved<T extends SimRow>(rows: readonly T[], actions: SimActions): T[] {
  return rows.filter((row) => {
    const type = actions[String(row.id ?? '')]?.type;
    return type !== 'cut' && type !== 'trade';
  });
}

/** Dead money with every simulated cut's penalty added: 50% now, the rest next year. */
export function addSimDeadMoney(dead: readonly number[], actions: SimActions): number[] {
  const out = [...dead];
  Object.values(actions).forEach((action) => {
    if (action.type !== 'cut') return;
    out[0] = (out[0] || 0) + (Number(action.currentPenalty) || 0);
    out[1] = (out[1] || 0) + (Number(action.futurePenalty) || 0);
  });
  return out;
}

export interface CapYear {
  year: string;
  /** Player salary counted against the cap (no dead money). */
  salary: number;
  dead: number;
  cap: number;
  space: number;
  /** Space minus the baseline's space: positive means the moves freed room. */
  change: number;
}

/** One row per salary year: the footer's four numbers plus the change vs. baseline. */
export function buildCapByYear(input: {
  years: readonly (string | number)[];
  capLimit: number;
  charges: readonly number[];
  dead: readonly number[];
  baseCharges: readonly number[];
  baseDead: readonly number[];
}): CapYear[] {
  return input.years.map((year, i) => {
    const salary = input.charges[i] ?? 0;
    const dead = input.dead[i] ?? 0;
    const space = input.capLimit - (salary + dead);
    const baseSpace = input.capLimit - ((input.baseCharges[i] ?? 0) + (input.baseDead[i] ?? 0));
    return { year: String(year), salary, dead, cap: input.capLimit, space, change: space - baseSpace };
  });
}

const MOVE_LABELS: Record<string, string> = {
  cut: 'Simulated cut',
  trade: 'Simulated trade',
  franchise: 'Franchise tag',
  extension: 'Extension',
  'rookie-extension': 'Rookie extension',
  'team-option': 'Team option',
};

export interface SimMove {
  playerId: string;
  name: string;
  position: string;
  type: string;
  label: string;
  /** Whether the player is on the roster being viewed. */
  onRoster: boolean;
  /** The year the move's effect is quoted in (the current year when it moves at all). */
  effectYear: string;
  /** Cap space change in `effectYear`: positive frees room. */
  effect: number;
}

/**
 * Each move's own effect on cap space, measured as baseline + that move alone.
 * `chargesFor` is the page's config-bound `calculateCapChargesWithActions`,
 * so this cannot price a move differently from the table.
 */
export function summarizeSimMoves(input: {
  actions: SimActions;
  baseRows: readonly SimRow[];
  baseDead: readonly number[];
  years: readonly (string | number)[];
  chargesFor: (rows: SimRow[], actions: SimActions) => number[];
}): SimMove[] {
  const baseCharges = input.chargesFor([...input.baseRows], {});
  const baseTotal = input.years.map((_, i) => (baseCharges[i] ?? 0) + (input.baseDead[i] ?? 0));
  const onRosterIds = new Set(input.baseRows.map((r) => String(r.id ?? '')));

  return Object.entries(input.actions).map(([id, action]) => {
    const one: SimActions = { [id]: action };
    const rows = applySimActionsToRows(input.baseRows, one);
    const charges = input.chargesFor(rows, one);
    const dead = addSimDeadMoney(input.baseDead, one);
    const effects = input.years.map((_, i) => baseTotal[i] - ((charges[i] ?? 0) + (dead[i] ?? 0)));
    const nonZero = effects.findIndex((v) => Math.round(v) !== 0);
    const at = nonZero < 0 ? 0 : nonZero;
    const type = String(action.type ?? '');
    return {
      playerId: id,
      name: String(action.playerName ?? 'Player'),
      position: String(action.playerPosition ?? ''),
      type,
      label: MOVE_LABELS[type] ?? type,
      onRoster: onRosterIds.has(id),
      effectYear: String(input.years[at] ?? ''),
      effect: effects[at] ?? 0,
    };
  });
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** "$2,825,075" / "-$120,000". */
export function formatMoney(n: number): string {
  return money.format(Math.round(n) || 0);
}

/** "+$847,000" / "−$120,000" / "$0" — a change, so it always carries its sign. */
export function formatSignedMoney(n: number): string {
  const r = Math.round(n) || 0;
  if (r === 0) return '$0';
  return `${r > 0 ? '+' : '−'}${money.format(Math.abs(r))}`;
}

// ── Rendering ──────────────────────────────────────────────────────────────
//
// Every surface is found by a data attribute inside the page root it is given,
// never by a module-level capture: under the ClientRouter this module outlives
// the DOM it would have captured.

export interface CapBuckets {
  active: number;
  practice: number;
  injured: number;
}

export interface SimSurfaceState {
  root: ParentNode;
  actions: SimActions;
  moves: SimMove[];
  capByYear: CapYear[];
  buckets: CapBuckets;
  /** The team being viewed, for the Trade chip's link. */
  teamId: string;
  /** The signed-in owner's franchise, or null. */
  viewerTeamId: string | null;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

function renderCapCard(state: SimSurfaceState, current: CapYear | undefined, count: number): void {
  const card = state.root.querySelector<HTMLElement>('[data-rcap]');
  if (!card || !current) return;
  const set = (sel: string, text: string) => {
    const el = card.querySelector<HTMLElement>(sel);
    if (el) el.textContent = text;
  };
  set('[data-rcap-year]', current.year);
  set('[data-rcap-space]', formatMoney(current.space));
  card.querySelector('[data-rcap-space]')?.classList.toggle('is-negative', current.space < 0);
  set('[data-rcap-sims]', String(count));

  // The bar: what the cap is spent on, then the room left. A simulation that
  // freed room shows that slice hatched inside the space.
  const used = current.salary + current.dead;
  const whole = Math.max(current.cap, used);
  const freed = Math.max(0, current.change);
  const segments: Record<string, number> = {
    active: state.buckets.active,
    practice: state.buckets.practice,
    injured: state.buckets.injured,
    dead: current.dead,
    sim: Math.min(freed, Math.max(0, current.space)),
    space: Math.max(0, current.space - freed),
  };
  Object.entries(segments).forEach(([key, value]) => {
    const seg = card.querySelector<HTMLElement>(`[data-rcap-seg="${key}"]`);
    if (seg) seg.style.width = `${pct(value, whole)}%`;
  });
  const bar = card.querySelector<HTMLElement>('[data-rcap-bar]');
  if (bar) {
    bar.setAttribute(
      'aria-label',
      `${current.year} cap: ${formatMoney(used)} used, ${formatMoney(current.space)} space. Open cap by year`,
    );
  }

  const trade = card.querySelector<HTMLAnchorElement>('[data-rcap-trade]');
  if (trade) {
    const base = trade.dataset.base ?? trade.getAttribute('href') ?? '';
    if (!trade.dataset.base) trade.dataset.base = base;
    const other = state.teamId && state.teamId !== state.viewerTeamId;
    trade.href = other ? `${base}${base.includes('?') ? '&' : '?'}b=${encodeURIComponent(state.teamId)}` : base;
  }

  const pendingTags = Object.values(state.actions).some((a) => a.type === 'franchise' || a.type === 'extension');
  const tagsLink = card.querySelector<HTMLElement>('[data-rcap-tags-link]');
  const tagsReview = card.querySelector<HTMLElement>('[data-rcap-tags-review]');
  if (tagsLink) tagsLink.hidden = pendingTags;
  if (tagsReview) tagsReview.hidden = !pendingTags;
}

function renderSimBar(state: SimSurfaceState, current: CapYear | undefined, count: number): void {
  const bar = state.root.querySelector<HTMLElement>('[data-rsim-bar]');
  if (!bar) return;
  bar.hidden = count === 0;
  if (!current) return;
  const set = (sel: string, text: string) => {
    const el = bar.querySelector<HTMLElement>(sel);
    if (el) el.textContent = text;
  };
  set('[data-rsim-count]', `${count} ${count === 1 ? 'sim' : 'sims'}`);
  set('[data-rsim-year]', current.year);
  set('[data-rsim-space]', formatMoney(current.space));
  set('[data-rsim-change]', formatSignedMoney(current.change));
  const change = bar.querySelector<HTMLElement>('[data-rsim-change]');
  if (change) {
    change.classList.toggle('is-up', current.change > 0);
    change.classList.toggle('is-down', current.change < 0);
  }

  // Announce the new figure once per change, then clear it so a later focus
  // move does not re-read it (accessibility.md, 2026-01-18).
  const live = bar.querySelector<HTMLElement>('[data-rsim-live]');
  const signature = `${count}|${Math.round(current.space)}`;
  if (live && bar.dataset.announced !== signature) {
    const first = bar.dataset.announced === undefined;
    bar.dataset.announced = signature;
    if (!first || count > 0) {
      live.textContent = count === 0
        ? 'All simulated moves cleared.'
        : `${count} simulated ${count === 1 ? 'move' : 'moves'}. ${current.year} cap space ${formatMoney(current.space)}, ${formatSignedMoney(current.change)}.`;
      window.setTimeout(() => {
        if (live.isConnected) live.textContent = '';
      }, 1200);
    }
  }
}

function renderReview(state: SimSurfaceState): void {
  const sheet = state.root.querySelector<HTMLElement>('[data-rsim-sheet]');
  if (!sheet) return;
  const list = sheet.querySelector<HTMLElement>('[data-rsim-moves]');
  const empty = sheet.querySelector<HTMLElement>('[data-rsim-empty]');
  if (list) {
    list.innerHTML = state.moves
      .map((m) => {
        const name = escapeHtml(m.name);
        const effect = m.effect === 0 ? 'No cap change' : `${escapeHtml(m.effectYear)} ${formatSignedMoney(m.effect)}`;
        const tone = m.effect > 0 ? ' is-up' : m.effect < 0 ? ' is-down' : '';
        return `<li class="rsim-move">
  <div class="rsim-move__who">
    <span class="rsim-move__name">${name}${m.position ? ` <span class="rsim-move__pos">${escapeHtml(m.position)}</span>` : ''}</span>
    <span class="rsim-move__what">${escapeHtml(m.label)}${m.onRoster ? '' : ' · another roster'}</span>
  </div>
  <span class="rsim-move__effect${tone}">${effect}</span>
  <button type="button" class="rsim-move__undo" data-sim-undo="${escapeHtml(m.playerId)}" aria-label="Undo ${escapeHtml(m.label.toLowerCase())} for ${name}">Undo</button>
</li>`;
      })
      .join('');
  }
  if (empty) empty.hidden = state.moves.length > 0;

  const body = sheet.querySelector<HTMLElement>('[data-rsim-years]');
  if (body) {
    body.innerHTML = state.capByYear
      .map((y) => {
        const change = Math.round(y.change) === 0
          ? ''
          : `<span class="rsim-years__change${y.change > 0 ? ' is-up' : ' is-down'}">${formatSignedMoney(y.change)}</span>`;
        return `<tr>
  <th scope="row">${escapeHtml(y.year)}</th>
  <td>${formatMoney(y.salary)}</td>
  <td>${formatMoney(y.dead)}</td>
  <td class="rsim-years__space${y.space < 0 ? ' is-negative' : ''}">${formatMoney(y.space)}${change}</td>
</tr>`;
      })
      .join('');
  }
}

/** Paint the cap card, the sim bar and the review sheet from one state. */
export function renderSimSurfaces(state: SimSurfaceState): void {
  const count = Object.keys(state.actions).length;
  const current = state.capByYear[0];
  renderCapCard(state, current, count);
  renderSimBar(state, current, count);
  renderReview(state);
}
