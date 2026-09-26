/**
 * TheLeague Rosters → the player sheet's opt-in payload.
 *
 * The roster page opens the shared PlayerDetailsModal from a player's name (and,
 * from PR B, from the whole row on a phone). This module turns that row into the
 * sheet's Summary / Salary / Game log payload — docs/plans/rosters-mobile-layout.md
 * § 4 and § 5 — so the page's inline script only has to call it.
 *
 * Three rules shape it:
 *
 * 1. **The row is the source.** Salary years are LIFTED from the row's own
 *    `year1`-`year5` cells (text + state class) and This week from its coach
 *    cells, the way #1217 lifted `acqUrl`. The sheet therefore cannot disagree
 *    with the row, simulation included — the tbody is re-rendered after every
 *    simulation, and the sheet re-reads it.
 * 2. **No cap math of its own.** Prices come from the page's config-bound
 *    wrappers over `salary-calculations` (`RosterSheetPricing`); which actions
 *    exist comes from `getCdmActionDescriptors`, the CDM's own list.
 * 3. **One implementation per action.** `onAction` only routes: simulations and
 *    undo go through the page's `applyContractAction` / `removeContractAction`;
 *    every write or multi-step action opens the CDM on that option, which keeps
 *    owning confirmation, year choice and the MFL write.
 */

import { CAP_INCLUSION } from '../salary-calculations';
import {
  CDM_CONTRACT_ACTION_IDS,
  type CdmActionDescriptor,
  type CdmActionEligibility,
  type CdmActionId,
} from '../cdm-action-descriptors';
import type {
  PlayerModalData,
  SalarySheetData,
  SalarySheetOption,
  SalarySheetYear,
  SheetAction,
  SheetActionApi,
  SheetFact,
  ThisWeekData,
} from '../player-modal-trigger';

// ─────────────────────────────────────────────────────────────── lifting ──

/** One `year<N>` cell as the row renders it. */
export interface LiftedYearCell {
  text: string;
  classes: string[];
}

/** Read the row's salary cells, in `salaryYears` order. Missing cells → null. */
export function liftYearCells(row: ParentNode, count: number): Array<LiftedYearCell | null> {
  const out: Array<LiftedYearCell | null> = [];
  for (let i = 0; i < count; i += 1) {
    const cell = row.querySelector<HTMLElement>(`[data-column="year${i + 1}"]`);
    out.push(cell ? { text: (cell.textContent ?? '').trim(), classes: Array.from(cell.classList) } : null);
  }
  return out;
}

/** Collapse a cell's whitespace, and treat the table's placeholders as empty. */
function cellText(row: ParentNode, column: string): string {
  const cell = row.querySelector<HTMLElement>(`[data-column="${column}"]`);
  const text = (cell?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text === '-' || text === '—' ? '' : text;
}

/** A phone carrier span's value (phone-row.ts), or '' when the row has none. */
function phoneSpan(row: ParentNode, kind: string): string {
  return row.querySelector<HTMLElement>(`.rr-ph--${kind}`)?.dataset.t?.trim() ?? '';
}

/**
 * The Coach columns the row carries, as label/value pairs. Only what has a
 * value is returned; a bye (the Opponent cell says BYE) is its own state.
 *
 * Reads TheLeague's Coach cells first, then the AFL's equivalents: the AFL
 * table has no spread or L3 cell and a bare-temperature Weather cell, so those
 * come from its phone spans, and its season columns are `total` / `avg`.
 */
export function liftThisWeek(row: ParentNode): ThisWeekData | null {
  const opponentCell = row.querySelector<HTMLElement>('[data-column="opponent"]');
  if (!opponentCell) return null;
  const facts: SheetFact[] = [];
  const push = (label: string, value: string) => { if (value) facts.push({ label, value }); };

  if (opponentCell.querySelector('.opponent-bye')) {
    return { rows: [], empty: 'Bye week — no game this week.' };
  }
  const vsAt = opponentCell.querySelector('.vs-at')?.textContent?.trim() ?? '';
  const opp = opponentCell.querySelector<HTMLImageElement>('.opponent-logo')?.getAttribute('alt')?.trim() ?? '';
  push('Opponent', [vsAt, opp].filter(Boolean).join(' '));
  const spread = opponentCell.querySelector('.spread-badge')?.textContent?.replace(/\s+/g, '').trim()
    || phoneSpan(row, 'spread');
  push('Spread', spread === '-' ? '' : spread);
  push('Opp rank vs pos', cellText(row, 'oppRank'));
  push('Opp avg allowed', cellText(row, 'oppAvg'));
  push('O/U', cellText(row, 'ou'));

  const weatherCell = row.querySelector<HTMLElement>('[data-column="weather"]');
  const temp = weatherCell?.querySelector('.weather-temp')?.textContent?.trim() ?? '';
  const sky = weatherCell?.querySelector<HTMLElement>('.weather-icon')?.getAttribute('title')?.trim() ?? '';
  push('Weather', [temp, sky].filter(Boolean).join(' · ') || phoneSpan(row, 'wx'));

  const recentCell = row.querySelector<HTMLElement>('[data-column="avgRecent"]');
  const recent = recentCell?.querySelector('.avg-points')?.textContent?.trim() ?? '';
  const trend = recentCell?.querySelector('.trend-arrow--up') ? ' (trending up)'
    : recentCell?.querySelector('.trend-arrow--down') ? ' (trending down)' : '';
  push('Last 3 avg', recent && recent !== '-' ? recent + trend : phoneSpan(row, 'l3'));

  const weeks = Array.from(row.querySelectorAll<HTMLElement>('[data-column^="trend-"]'))
    .map((td) => {
      const wk = td.dataset.column?.replace('trend-', '') ?? '';
      const score = (td.textContent ?? '').replace(/[↑↓]/g, '').replace(/\s+/g, ' ').trim();
      return score ? `W${wk} ${score}` : '';
    })
    .filter(Boolean);
  push('Recent weeks', weeks.join(' · '));
  push('Season points', cellText(row, 'totalSeason') || cellText(row, 'total'));
  push('Season avg', cellText(row, 'avgSeason') || cellText(row, 'avg'));
  push('Projected', cellText(row, 'projected'));

  return facts.length ? { rows: facts } : null;
}

/** The row's My Rank cell ("QB 3"), when a rankings board filled it. */
export function liftMyRank(row: ParentNode): string | null {
  const text = cellText(row, 'rank');
  return text || null;
}

// ─────────────────────────────────────────────────────────────── building ──

/** The page's config-bound pricing wrappers (salary-calculations underneath). */
export interface RosterSheetPricing {
  cutPenalty: (salary: number, years: number) => { currentPenalty: number; futurePenalty: number };
  franchiseTag: (salary: number, position: string) => { newSalary: number; basis?: string };
  teamOption: (salary: number, position: string) => { newSalary: number };
  extension: (years: number, position: string, extensionYears: number, salary: number) => { newSalary: number };
  formatCurrency: (value: number) => string;
  formatCompact: (value: number) => string;
}

export interface RosterSheetFacts {
  player: {
    id: string;
    position: string;
    /** The ORIGINAL salary and years (before any simulation) — the ⋮ button's. */
    salary: number;
    years: number;
    contractInfo: string;
    tradeBait: boolean;
    displayTag: string;
  };
  salaryYears: number[];
  yearCells: Array<LiftedYearCell | null>;
  totalRemaining: number | null;
  thisWeek: ThisWeekData | null;
  myRank: string | null;
  mode: 'gm' | 'coach';
  viewer: { signedIn: boolean; isOwnTeam: boolean };
  /** The simulation active for this player (`contractActions[id]`), if any. */
  activeActionType: string | null;
  /** Current-year cap space as the table shows it now, for the preview. */
  capSpaceNow: number | null;
  /** `getCdmActionDescriptors` for this player — the CDM's own list. */
  descriptors: CdmActionDescriptor[];
  eligibility: CdmActionEligibility & { deadlineTimestamp?: number | null };
  /** Clock for the declaration countdown; injected so tests are stable. */
  now: number;
}

export const ACTION_TYPE_LABELS: Record<string, string> = {
  cut: 'cut',
  trade: 'trade',
  franchise: 'franchise tag',
  extension: 'extension',
  'team-option': 'team option',
  'rookie-extension': 'rookie extension',
};

const DESIGNATIONS: Record<string, string> = {
  '': 'Standard',
  RC: 'Rookie (RC)',
  TO: 'Team option (TO)',
  FT: 'Franchise tag (FT)',
};

function yearKind(classes: string[]): SalarySheetYear['kind'] {
  if (classes.includes('salary-cell--team-option-eligible')) return 'to-eligible';
  if (classes.includes('salary-cell--team-option-expired')) return 'to-expired';
  if (classes.includes('salary-cell--ufa')) return 'ufa';
  if (classes.includes('salary-cell--future-ufa')) return 'future-ufa';
  return 'salary';
}

/** "2d 4h" / "5h" / "<1h" — the years chip's deadline countdown, in words. */
export function formatDeadline(deadlineSeconds: number | null | undefined, now: number): string | null {
  if (!deadlineSeconds) return null;
  const remaining = deadlineSeconds * 1000 - now;
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / 3_600_000);
  if (hours < 1) return 'Deadline in under an hour';
  const days = Math.floor(hours / 24);
  return days > 0 ? `Deadline in ${days}d ${hours % 24}h` : `Deadline in ${hours}h`;
}

/** Why a contract action is not offered, in the owner's terms. */
function ineligibleReason(id: CdmActionId, facts: RosterSheetFacts): string {
  const years = facts.player.years;
  const isTO = facts.player.contractInfo === 'TO';
  const isRookie = !!facts.eligibility.isRookieContract || isTO;
  const firstYear = facts.salaryYears[0];
  switch (id) {
    case 'franchise':
      if (isTO) return 'Team-option contracts take the Team Option instead';
      if (years > 1) return `Opens in his final year (${firstYear + years - 1})`;
      return 'Needs a contract year left';
    case 'team-option':
      if (!isTO) return 'Only on team-option (TO) rookie contracts';
      return 'The option window has closed';
    case 'extension':
      if (isRookie) return 'Rookie contracts take the Rookie Extension';
      return 'Needs 2 or more years left';
    case 'rookie-extension':
      if (!isRookie) return 'Only on rookie (RC / TO) contracts';
      return 'Needs 2 or more years left';
    default:
      return 'Not available for him';
  }
}

function contractOption(
  d: CdmActionDescriptor | undefined,
  id: CdmActionId,
  facts: RosterSheetFacts,
  pricing: RosterSheetPricing,
): SalarySheetOption | null {
  const { salary, years, position } = facts.player;
  const firstYear = facts.salaryYears[0];
  const fmt = pricing.formatCurrency;
  if (!d) {
    // Declare Contract exists only inside its window; it is not an option a
    // player "lacks", so it is not listed disabled.
    if (id === 'declare-contract') return null;
    const labels: Partial<Record<CdmActionId, [string, string]>> = {
      franchise: ['Franchise Tag', 'icon-franchise-tag'],
      'team-option': ['Team Option', 'icon-franchise-tag'],
      extension: ['Veteran Extension', 'icon-coin'],
      'rookie-extension': ['Rookie Extension', 'icon-coin-r'],
    };
    const [label, icon] = labels[id] ?? [id, 'icon-coin'];
    return { id, label, icon, disabled: true, detail: ineligibleReason(id, facts) };
  }
  const option: SalarySheetOption = { id, label: d.label, icon: d.icon, detail: d.desc };
  if (id === 'franchise') {
    const r = pricing.franchiseTag(salary, position);
    option.cost = `${fmt(r.newSalary)} for ${firstYear + years}`;
    option.detail = r.basis === 'top 3 average' ? 'Top-3 position average (above 120% of his salary)' : '120% of his salary';
  } else if (id === 'team-option') {
    const r = pricing.teamOption(salary, position);
    option.cost = `${fmt(r.newSalary)} for ${firstYear + years}`;
  } else if (id === 'extension') {
    const one = pricing.extension(years, position, 1, salary);
    const two = pricing.extension(years, position, 2, salary);
    option.cost = `+1 yr ${fmt(one.newSalary)} · +2 yrs ${fmt(two.newSalary)}`;
    option.detail = `New ${firstYear} salary, then +10% a year`;
  } else if (id === 'rookie-extension') {
    const r = pricing.extension(years, position, 2, salary);
    option.cost = `+2 yrs ${fmt(r.newSalary)}`;
    option.detail = `New ${firstYear} salary, then +10% a year`;
  } else if (id === 'declare-contract') {
    const deadline = formatDeadline(facts.eligibility.deadlineTimestamp, facts.now);
    if (deadline) option.detail = `${d.desc} · ${deadline}`;
  }
  return option;
}

/** The current-year cap effect of removing him: his charge back, less dead money. */
export function simulatedCapDelta(
  type: 'cut' | 'trade',
  facts: Pick<RosterSheetFacts, 'player'>,
  pricing: Pick<RosterSheetPricing, 'cutPenalty'>,
): number {
  const { salary, years, displayTag } = facts.player;
  const inclusion = displayTag === 'practice' ? CAP_INCLUSION.PRACTICE.current : CAP_INCLUSION.ACTIVE.current;
  const charge = salary * inclusion;
  if (type === 'trade') return charge;
  return charge - pricing.cutPenalty(salary, years).currentPenalty;
}

function simulationPreview(
  type: 'cut' | 'trade',
  facts: RosterSheetFacts,
  pricing: RosterSheetPricing,
): string {
  const delta = simulatedCapDelta(type, facts, pricing);
  const year = facts.salaryYears[0];
  const sign = delta >= 0 ? '+' : '−';
  const change = `${sign}${pricing.formatCurrency(Math.abs(delta))}`;
  if (facts.capSpaceNow == null) return `${year} cap space ${change}`;
  return `${year} space ${pricing.formatCompact(facts.capSpaceNow)} → ${pricing.formatCompact(facts.capSpaceNow + delta)} · ${change}`;
}

/** "$5,500,000" → 5500000; null when any contracted year does not parse. */
export function sumContractedYears(years: SalarySheetYear[]): number | null {
  if (!years.length) return null;
  let total = 0;
  for (const y of years) {
    const n = Number(y.text.replace(/[^0-9.]/g, ''));
    if (!y.text || !Number.isFinite(n)) return null;
    total += n;
  }
  return total;
}

export function buildSalarySheet(facts: RosterSheetFacts, pricing: RosterSheetPricing): SalarySheetData {
  const { salaryYears, yearCells } = facts;
  const years: SalarySheetYear[] = [];
  const cut = pricing.cutPenalty(facts.player.salary, facts.player.years);
  salaryYears.forEach((year, i) => {
    const cell = yearCells[i];
    if (!cell) return;
    const kind = yearKind(cell.classes);
    const simulated = cell.classes.includes('salary-cell--simulated');
    const prev = years[years.length - 1];
    const ifCutAmount = i === 0 ? cut.currentPenalty : i === 1 ? cut.futurePenalty : 0;
    years.push({
      year: String(year),
      text: cell.text,
      kind,
      declared: cell.classes.includes('salary-cell--declared') || undefined,
      simulated: simulated || undefined,
      escalated: (!!prev && prev.kind === 'salary' && kind === 'salary' && !!prev.simulated === simulated) || undefined,
      ifCut: ifCutAmount > 0 ? pricing.formatCurrency(ifCutAmount) : null,
    });
  });

  const tiles: SheetFact[] = [];
  const current = years[0];
  // Compact in the tile (four share a row); the exact figure is the first
  // row of the table right under it.
  const currentAmount = current && current.kind === 'salary' ? sumContractedYears([current]) : null;
  tiles.push({
    label: `${salaryYears[0]} salary`,
    value: pricing.formatCompact(currentAmount ?? facts.player.salary),
  });
  const contracted = years.filter((y) => y.kind === 'salary');
  const last = contracted[contracted.length - 1];
  tiles.push({
    label: last ? `Thru ${last.year}` : 'Contract',
    value: `${contracted.length} yr${contracted.length === 1 ? '' : 's'}`,
  });
  const info = facts.player.contractInfo || '';
  tiles.push({ label: 'Designation', value: DESIGNATIONS[info] ?? info });
  // Remaining = the year table's own total, so the tile cannot contradict
  // the rows under it. The payload's `totalRemaining` is salary x years
  // (scripts/lib/roster-season-payload.mjs), which drops the league's +10%
  // escalation; it is only the fallback when a cell does not parse.
  const remaining = sumContractedYears(contracted) ?? facts.totalRemaining;
  if (remaining != null && remaining > 0) {
    tiles.push({ label: 'Remaining', value: pricing.formatCompact(remaining) });
  }

  const byId = new Map(facts.descriptors.map((d) => [d.id, d] as const));
  const options = CDM_CONTRACT_ACTION_IDS
    .map((id) => contractOption(byId.get(id), id, facts, pricing))
    .filter((o): o is SalarySheetOption => o !== null);

  const active = facts.activeActionType;
  const simulations: SalarySheetOption[] = active
    ? [{
        id: 'undo-simulation',
        label: 'Undo',
        detail: `Remove the simulated ${ACTION_TYPE_LABELS[active] ?? active}`,
        icon: 'icon-arrow-left',
        state: 'on',
      }]
    : [
        { id: 'cut-simulate', label: 'Simulate Cut', icon: 'icon-bar-chart', detail: simulationPreview('cut', facts, pricing) },
        { id: 'trade-simulate', label: 'Simulate Trade', icon: 'icon-bar-chart', detail: simulationPreview('trade', facts, pricing) },
      ];

  return {
    tiles,
    years,
    ifCutLabel: 'If cut',
    options,
    simulations,
    simulated: active ? `Simulated ${ACTION_TYPE_LABELS[active] ?? active}` : null,
  };
}

/** The ids of Summary › More actions, in order. */
const MORE_ACTION_IDS: ReadonlyArray<CdmActionId> = [
  'move-to-ir',
  'activate-from-ir',
  'move-to-practice',
  'promote-from-practice',
  'autocut-toggle',
];

export function buildQuickActions(facts: RosterSheetFacts): SheetAction[] {
  const out: SheetAction[] = [];
  if (facts.viewer.isOwnTeam) {
    const active = facts.activeActionType;
    out.push(active
      ? {
          id: 'undo-simulation',
          label: active === 'cut' ? 'Simulated · Undo' : `Simulated ${ACTION_TYPE_LABELS[active] ?? active} · Undo`,
          icon: 'icon-bar-chart',
          state: 'on',
          desc: 'Remove this simulation',
        }
      : { id: 'cut-simulate', label: 'Simulate cut', icon: 'icon-bar-chart', desc: 'Track the cap impact locally — no roster change' });
    out.push({
      id: 'trade-block',
      label: facts.player.tradeBait ? 'On trade block' : 'Trade block',
      icon: 'icon-bookmark',
      state: facts.player.tradeBait ? 'on' : undefined,
      desc: facts.player.tradeBait ? 'Take him off your trade block' : 'Tell other owners he is available',
    });
  }
  // The kebab: the table's ⋮ list, as a menu. The ONE overflow entry point in
  // the hero (it replaced a "More" button that reopened the CDM on top).
  const menu = buildContractMenu(facts);
  if (menu.length) {
    out.push({ id: 'contract-menu', label: 'Contract options', icon: 'icon-menu', menu });
  }
  return out;
}

/**
 * The hero kebab's menu: the table's ⋮ list, in the CDM's order, from
 * `getCdmActionDescriptors`. The CDM's two sub-steps are flattened into the
 * entries they lead to, so one tap does the thing:
 *
 *   - Cut Player   → Simulate cut (or Undo while one is active) · Release…
 *                    (own team; the CDM's cut REVIEW, never the bare button)
 *   - Trade Player → Simulate trade (or Undo) · Trade block (own team) ·
 *                    Add to Trade Builder
 *
 * Watch is left out: the hero already carries the sheet's built-in Watch, and
 * one control per action is the rule the hero was built on. Every entry routes
 * through `onAction` — CDM_ROUTES or the local simulate / undo / trade-block
 * handlers — exactly as the Salary tab and More actions do.
 */
export function buildContractMenu(facts: RosterSheetFacts): SheetAction[] {
  const out: SheetAction[] = [];
  const active = facts.activeActionType;
  let undoOffered = false;
  const simulateOrUndo = (type: 'cut' | 'trade') => {
    if (active) {
      if (undoOffered) return;
      undoOffered = true;
      out.push({
        id: 'undo-simulation',
        label: `Undo simulated ${ACTION_TYPE_LABELS[active] ?? active}`,
        desc: 'Remove this simulation',
        icon: 'icon-arrow-left',
        state: 'on',
      });
      return;
    }
    out.push(type === 'cut'
      ? { id: 'cut-simulate', label: 'Simulate cut', desc: 'Track the cap impact locally — no roster change', icon: 'icon-bar-chart' }
      : { id: 'trade-simulate', label: 'Simulate trade', desc: 'Track the cap impact locally — no roster change', icon: 'icon-bar-chart' });
  };

  for (const d of facts.descriptors) {
    if (d.id === 'watch') continue;
    if (d.id === 'cut') {
      simulateOrUndo('cut');
      if (facts.viewer.isOwnTeam) {
        out.push({ id: 'release', label: 'Release…', desc: 'Cut him for real — review the cap hit first', icon: 'icon-user-times', tone: 'danger' });
      }
      continue;
    }
    if (d.id === 'trade') {
      simulateOrUndo('trade');
      if (facts.viewer.isOwnTeam) {
        out.push({
          id: 'trade-block',
          label: facts.player.tradeBait ? 'Remove from trade block' : 'Add to trade block',
          desc: facts.player.tradeBait ? 'Take him off your trade block' : 'Tell other owners he is available',
          icon: 'icon-bookmark',
          state: facts.player.tradeBait ? 'on' : undefined,
        });
      }
      out.push({ id: 'trade-builder', label: 'Add to Trade Builder', desc: 'Open the Trade Builder with him pre-loaded', icon: 'icon-transactions-2' });
      continue;
    }
    out.push({ id: d.id, label: d.label, desc: d.desc, icon: d.icon, disabled: d.disabled, state: d.state });
  }
  return out;
}

export function buildMoreActions(facts: RosterSheetFacts): SheetAction[] {
  const byId = new Map(facts.descriptors.map((d) => [d.id, d] as const));
  const out: SheetAction[] = [];
  for (const id of MORE_ACTION_IDS) {
    const d = byId.get(id);
    if (d) out.push({ id, label: d.label, desc: d.desc, icon: d.icon, disabled: d.disabled });
  }
  out.push({
    id: 'trade-builder',
    label: 'Add to Trade Builder',
    desc: 'Open the Trade Builder with him pre-loaded',
    icon: 'icon-transactions-2',
  });
  if (facts.viewer.isOwnTeam) {
    out.push({
      id: 'release',
      label: 'Release…',
      desc: 'Cut him for real — review the cap hit first',
      icon: 'icon-user-times',
      tone: 'danger',
    });
  }
  return out;
}

/** Everything the roster adds to the sheet payload, minus `onAction`. */
export function buildRosterSheetFields(
  facts: RosterSheetFacts,
  pricing: RosterSheetPricing,
): Pick<PlayerModalData, 'salarySheet' | 'sheetTab' | 'thisWeek' | 'quickActions' | 'moreActions' | 'myRank' | 'hideOwnerStrip'> {
  return {
    salarySheet: buildSalarySheet(facts, pricing),
    // Q3: reset on every open, by mode — GM owners are in cap mode.
    sheetTab: facts.mode === 'coach' ? 'summary' : 'salary',
    thisWeek: facts.thisWeek,
    quickActions: buildQuickActions(facts),
    moreActions: buildMoreActions(facts),
    myRank: facts.myRank,
    // The roster page's header already names the team, and the hero band
    // wears its art and crest (user, 2026-09-26) — the strip only repeated it.
    hideOwnerStrip: true,
  };
}

// ─────────────────────────────────────────────────────────────── routing ──

/**
 * Sheet action id → the CDM options to press, in order, after opening the
 * row's ⋮. An empty path opens the action sheet and stops there.
 */
export const CDM_ROUTES: Readonly<Record<string, readonly string[]>> = {
  'declare-contract': ['declare-contract'],
  franchise: ['franchise'],
  'team-option': ['team-option'],
  extension: ['extension'],
  'rookie-extension': ['rookie-extension'],
  'move-to-ir': ['move-to-ir'],
  'activate-from-ir': ['activate-from-ir'],
  'move-to-practice': ['move-to-practice'],
  'promote-from-practice': ['promote-from-practice'],
  'autocut-toggle': ['autocut-toggle'],
  // The CDM's cut REVIEW (dead money, then its own two-tap confirm) — never
  // straight to the irreversible button.
  release: ['cut'],
  'trade-builder': ['trade', 'trade-builder'],
};

/** What the page lends the router. Every call re-reads page state. */
export interface RosterSheetActionDeps {
  simulate: (type: 'cut' | 'trade') => void;
  undo: () => void;
  toggleTradeBlock: () => Promise<{ ok: boolean; onBlock?: boolean; error?: string }>;
  /** Open the CDM from the row's ⋮ and press `path` in order. */
  openCdm: (path: readonly string[]) => void;
  /** A fresh payload for the same player, read from the re-rendered row. */
  rebuild: () => PlayerModalData | null;
}

export type RosterSheetActionHandler = (id: string, sheet: SheetActionApi) => Promise<void>;

export function createRosterSheetActionHandler(deps: RosterSheetActionDeps): RosterSheetActionHandler {
  const refresh = (sheet: SheetActionApi) => {
    const next = deps.rebuild();
    if (next) sheet.rerender(next);
  };
  return async (id, sheet) => {
    if (id === 'cut-simulate' || id === 'trade-simulate') {
      deps.simulate(id === 'cut-simulate' ? 'cut' : 'trade');
      refresh(sheet);
      sheet.announce(id === 'cut-simulate' ? 'Cut simulated. Undo is available.' : 'Trade simulated. Undo is available.');
      return;
    }
    if (id === 'undo-simulation') {
      deps.undo();
      refresh(sheet);
      sheet.announce('Simulation removed.');
      return;
    }
    if (id === 'trade-block') {
      const res = await deps.toggleTradeBlock();
      refresh(sheet);
      sheet.announce(res.ok
        ? (res.onBlock ? 'Added to your trade block.' : 'Removed from your trade block.')
        : (res.error || 'Could not update the trade block.'));
      return;
    }
    const path = CDM_ROUTES[id];
    if (path) {
      sheet.close();
      deps.openCdm(path);
    }
  };
}
