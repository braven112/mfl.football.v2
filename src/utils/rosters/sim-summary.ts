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

import { buildPlayerCellHTML, escapeHtml } from '../player-cell-html';
import { PLAN_MOVE_LABELS, isSubmittableType, submitOutcome } from './gm-plan';

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
  /** Player-cell fields, read only to draw the review sheet's player cell. */
  headshot?: string;
  nflTeam?: string;
  espnId?: string | number;
  contractInfo?: string;
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

/**
 * Dead money with every simulated cut's penalty added: 50% now, the rest next
 * year. `onRoster` limits it to the viewed club's players: `contractActions`
 * is page-wide and survives a team switch, so an unscoped sum charged one
 * club's simulated cut to whichever club was viewed next (hotfix #1201).
 */
export function addSimDeadMoney(
  dead: readonly number[],
  actions: SimActions,
  onRoster?: ReadonlySet<string>,
): number[] {
  const out = [...dead];
  Object.entries(actions).forEach(([id, action]) => {
    if (action.type !== 'cut') return;
    if (onRoster && !onRoster.has(String(id))) return;
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
  /** The new terms in one line ("$2.5M → $5.76M · 2 → 4 yrs"), or '' when there are none. */
  terms: string;
  /** What Submit does with it (src/utils/rosters/gm-plan.ts). */
  outcome: string;
  /** 'final' marks the move that cannot be undone. */
  outcomeTone: 'final' | 'pending' | 'none';
  /** The roster's player-cell fields, so the review draws the same cell the table does. */
  headshot?: string;
  nflTeam?: string;
  espnId?: string;
  contractInfo?: string;
  /**
   * The player's own cap hit in each salary year once this move applies:
   * their salary (re-priced by an extension, a tag or an option) plus any
   * dead money a cut leaves. All zeros for a player not on this roster.
   */
  yearly: number[];
}

const compact = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
};

/** The move's new terms, in one line. */
export function moveTerms(action: SimAction): string {
  const type = String(action.type ?? '');
  const yrs = (n: unknown) => `${n} ${Number(n) === 1 ? 'yr' : 'yrs'}`;
  if (type === 'cut') {
    const now = Number(action.currentPenalty) || 0;
    const later = Number(action.futurePenalty) || 0;
    return later > 0 ? `${compact(now)} dead money now, ${compact(later)} later` : `${compact(now)} dead money`;
  }
  if (type === 'franchise') return `${compact(action.newSalary)} for 1 year`;
  if (type === 'extension' || type === 'rookie-extension' || type === 'team-option') {
    return `${compact(action.originalSalary)} → ${compact(action.newSalary)} · ${action.originalYears} → ${yrs(action.newYears)}`;
  }
  return '';
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
  /** The signed-in owner's franchise: only their own moves can be submitted. */
  ownFranchiseId?: string | null;
}): SimMove[] {
  const baseCharges = input.chargesFor([...input.baseRows], {});
  const baseTotal = input.years.map((_, i) => (baseCharges[i] ?? 0) + (input.baseDead[i] ?? 0));
  const onRosterIds = new Set(input.baseRows.map((r) => String(r.id ?? '')));
  const rowById = new Map(input.baseRows.map((r) => [String(r.id ?? ''), r]));

  return Object.entries(input.actions).map(([id, action]) => {
    const one: SimActions = { [id]: action };
    const rows = applySimActionsToRows(input.baseRows, one);
    const charges = input.chargesFor(rows, one);
    const dead = addSimDeadMoney(input.baseDead, one, onRosterIds);
    const effects = input.years.map((_, i) => baseTotal[i] - ((charges[i] ?? 0) + (dead[i] ?? 0)));
    const nonZero = effects.findIndex((v) => Math.round(v) !== 0);
    const at = nonZero < 0 ? 0 : nonZero;
    const baseRow = input.baseRows.find((r) => String(r.id ?? '') === id);
    const onThisRoster = onRosterIds.has(id);
    const ownCharges = baseRow ? input.chargesFor(applySimActionsToRows([baseRow], one), one) : [];
    const ownDead = addSimDeadMoney(input.years.map(() => 0), one, onRosterIds);
    const yearly = input.years.map((_, i) =>
      onThisRoster ? (ownCharges[i] ?? 0) + (ownDead[i] ?? 0) : 0,
    );
    const type = String(action.type ?? '');
    const own =
      Boolean(input.ownFranchiseId) &&
      String(action.franchiseId ?? '') === String(input.ownFranchiseId) &&
      isSubmittableType(type);
    const outcome = own
      ? submitOutcome(type)
      : type === 'trade'
        ? submitOutcome('trade')
        : { text: 'Stays a simulation. Only your own team’s moves can be submitted.', tone: 'none' as const };
    return {
      playerId: id,
      name: String(action.playerName ?? 'Player'),
      position: String(action.playerPosition ?? ''),
      type,
      label: own ? (PLAN_MOVE_LABELS[type] ?? type) : (MOVE_LABELS[type] ?? type),
      onRoster: onRosterIds.has(id),
      effectYear: String(input.years[at] ?? ''),
      effect: effects[at] ?? 0,
      terms: moveTerms(action),
      outcome: outcome.text,
      outcomeTone: outcome.tone,
      headshot: rowById.get(id)?.headshot || undefined,
      nflTeam: rowById.get(id)?.nflTeam || (typeof action.nflTeam === 'string' ? action.nflTeam : undefined),
      espnId: rowById.get(id)?.espnId ? String(rowById.get(id)?.espnId) : undefined,
      contractInfo: rowById.get(id)?.contractInfo || undefined,
      yearly,
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
  /**
   * Which `capByYear` entry the cap card shows: 0 (this year) unless the
   * roster is sorted by a later salary year, when the card follows it and
   * `buckets` must be that year's. The sim bar always reads this year.
   */
  cardYearIndex?: number;
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
  // The card is one button named by its own visible text (the year, the
  // space) plus this hint, so only the hint needs painting: it carries what
  // the card no longer shows as a chip — how many moves are simulated.
  const hint = card.querySelector<HTMLElement>('[data-rcap-hint]');
  if (hint) {
    const sims = count > 0 ? ` ${count} simulated ${count === 1 ? 'move' : 'moves'}.` : '';
    hint.textContent = `, ${formatMoney(used)} used.${sims} Open cap by year`;
  }
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
  set('[data-rsim-count]', `${count} ${count === 1 ? 'move' : 'moves'}`);
  set('[data-rsim-year]', current.year);
  set('[data-rsim-space]', formatMoney(current.space));
  // Negative space means the plan puts the team over the cap: paint it red.
  bar.querySelector<HTMLElement>('[data-rsim-space]')?.classList.toggle('is-over', current.space < 0);
  // No signed change under the figure: owners read "-$2,172,667" under
  // "-$620,782" as a second balance (Brandon, 2026-11-22). The Review sheet
  // still shows each move's effect.

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
        : `${count} simulated ${count === 1 ? 'move' : 'moves'}. ${current.year} cap space ${formatMoney(current.space)}.`;
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
        // The year on its own line, so a narrow sheet never breaks "2026 −" from its amount.
        const effect = m.effect === 0
          ? 'No cap change'
          : `<span class="rsim-move__effect-year">${escapeHtml(m.effectYear)}</span> ${formatSignedMoney(m.effect)}`;
        const tone = m.effect > 0 ? ' is-up' : m.effect < 0 ? ' is-down' : '';
        return `<li class="rsim-move">
  <div class="rsim-move__who">
    ${buildPlayerCellHTML({
      name: m.name,
      headshot: m.headshot,
      position: m.position || undefined,
      nflTeam: m.nflTeam,
      mflId: m.playerId,
      espnId: m.espnId,
      contractStatus: m.contractInfo,
      size: 'compact',
      className: 'rsim-move__cell',
    })}
    <span class="rsim-move__what">${escapeHtml(m.label)}${m.onRoster ? '' : ' · another roster'}</span>
    ${m.terms ? `<span class="rsim-move__terms">${escapeHtml(m.terms)}</span>` : ''}
    <span class="rsim-move__outcome${m.outcomeTone === 'final' ? ' is-final' : ''}">${escapeHtml(m.outcome)}</span>
  </div>
  <span class="rsim-move__effect${tone}">${effect}</span>
  <button type="button" class="rsim-move__undo" data-sim-undo="${escapeHtml(m.playerId)}" aria-label="Undo ${escapeHtml(m.label.toLowerCase())} for ${name}">Undo</button>
</li>`;
      })
      .join('');
  }
  if (empty) empty.hidden = state.moves.length > 0;

  // Payroll = salary + dead money in one column; the freed column shows the
  // moved player's own cap hit each year (Brandon, 2026-11-15).
  const movesCol = movesColumn(state.moves);
  const head = sheet.querySelector<HTMLElement>('[data-rsim-moves-col]');
  if (head) {
    head.hidden = !movesCol;
    head.textContent = movesCol?.label ?? '';
  }
  const body = sheet.querySelector<HTMLElement>('[data-rsim-years]');
  if (body) {
    body.innerHTML = state.capByYear
      .map((y, i) => {
        // Space before the plan, as "was $X" — a bare signed delta under the
        // space read as a second, unexplained number (Brandon, 2026-11-15).
        const change = Math.round(y.change) === 0
          ? ''
          : `<span class="rsim-years__change">was ${formatMoney(y.space - y.change)}</span>`;
        const moved = movesCol ? `<td class="rsim-years__moved">${formatMoney(movesCol.values[i] ?? 0)}</td>` : '';
        return `<tr>
  <th scope="row">${escapeHtml(y.year)}</th>
  <td>${formatMoney(y.salary + y.dead)}</td>
  ${moved}
  <td class="rsim-years__space${y.space < 0 ? ' is-negative' : ''}">${formatMoney(y.space)}${change}</td>
</tr>`;
      })
      .join('');
  }
}

/**
 * The Cap by year table's moved-player column: one player's last name and
 * cap hit by year, or "Moves" and the sum when the plan moves several.
 * Null when no move touches this roster.
 */
/** "Jared Goff" or MFL's "Goff, Jared" → "Goff". */
function lastName(name: string): string {
  const n = name.trim();
  if (n.includes(',')) return n.split(',')[0].trim() || n;
  return n.split(/\s+/).pop() || n;
}

export function movesColumn(moves: readonly SimMove[]): { label: string; values: number[] } | null {
  const mine = moves.filter((m) => m.onRoster);
  if (!mine.length) return null;
  const values = mine[0].yearly.map((_, i) => mine.reduce((sum, m) => sum + (m.yearly[i] ?? 0), 0));
  const label = mine.length === 1 ? lastName(mine[0].name) : 'Moves';
  return { label, values };
}

/** Paint the cap card, the sim bar and the review sheet from one state. */
export function renderSimSurfaces(state: SimSurfaceState): void {
  const count = Object.keys(state.actions).length;
  const current = state.capByYear[0];
  renderCapCard(state, state.capByYear[state.cardYearIndex ?? 0] ?? current, count);
  renderSimBar(state, current, count);
  renderReview(state);
}
