import PlayerDetailsModal from '../../src/components/theleague/PlayerDetailsModal.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The player profile modal, opened from any roster row in either league.
 *
 * Until now this had NO visual coverage at all. In production it ships as an
 * empty skeleton and the client script fills 47 elements on open, so every
 * populated state — the ones anyone actually looks at — required a live roster
 * and a click to see. The `preview` prop server-renders the same elements the
 * script targets, which is what makes these stories possible.
 *
 * What that does and does not buy:
 *
 *  - It DOES pin layout, styling, theme behaviour and the shape of each state:
 *    owner strip present or absent, contract column present or hidden, how a
 *    long name wraps in the hero band.
 *  - It does NOT exercise the client script's formatting. That logic runs on
 *    open and a story cannot reach it. Duplicating the formatting in fixtures
 *    would just let the story drift from production, so the fields are
 *    pre-formatted strings and the story is honest about testing presentation.
 *
 * `previewOpen` overrides the default `display: none`. Without it every one of
 * these would snapshot as a blank page.
 */
export default {
  title: 'Roster/PlayerDetailsModal',
  component: PlayerDetailsModal,
  parameters: {
    layout: 'fullscreen',
    // Theme only. The modal is not league-skinned — TheLeague and the AFL
    // differ here by the `hideContract` PROP, which AflNoContract covers.
    chromatic: { modes: themeModes },
  },
};

/**
 * THE PRODUCTION SHAPE — no `preview` prop at all.
 *
 * This is what actually ships: em dashes everywhere, owner strip hidden, news
 * and weekly-results sections collapsed. It is here as the regression guard on
 * the refactor itself. If adding the preview props ever changes the default
 * render, this story is what catches it.
 */
export const Skeleton = {
  args: { previewOpen: true },
};

/** A rostered starter with a full profile — the common case. */
export const RosteredStarter = {
  args: {
    previewOpen: true,
    preview: {
      name: 'Ja’Marr Chase',
      agePill: '25',
      metaText: 'WR · CIN · #1',
      subText: '6\'0" · 201 lb · 5th season',
      ownerName: 'Pacific Pigskins',
      points: '284.6',
      ppg: '20.3',
      contract: '$52 · 3yr',
      build: '6\'0" · 201 lb',
      status: 'Active',
      draft: '2021 · Rd 1, Pk 5',
      college: 'LSU',
      contractDetail: '$52 through 2028',
      bye: 'Week 10',
    },
  },
};

/**
 * Unrostered. The owner strip must stay hidden — it is the one section whose
 * absence is meaningful, and it is invisible on any roster page you happen to
 * be looking at, because there every player has an owner.
 */
export const FreeAgent = {
  args: {
    previewOpen: true,
    preview: {
      name: 'Marcus Freeman',
      agePill: '28',
      metaText: 'RB · FA',
      subText: 'Unrostered',
      points: '41.2',
      ppg: '5.9',
      contract: 'Free Agent',
      contractLabel: 'Status',
      build: '5\'11" · 214 lb',
      status: 'Free Agent',
      draft: 'Undrafted',
      college: 'Cincinnati',
      contractDetail: '—',
      bye: 'Week 7',
    },
  },
};

/** Injured — the status row is the whole point of opening the modal here. */
export const InjuredPlayer = {
  args: {
    previewOpen: true,
    preview: {
      name: 'Christian McCaffrey',
      agePill: '29',
      metaText: 'RB · SF · #23',
      subText: 'Questionable — knee',
      ownerName: 'Dead Cap Walking',
      points: '112.4',
      ppg: '16.1',
      contract: '$44 · 2yr',
      build: '5\'11" · 210 lb',
      status: 'Questionable (knee)',
      draft: '2017 · Rd 1, Pk 8',
      college: 'Stanford',
      contractDetail: '$44 through 2027',
      bye: 'Week 14',
    },
  },
};

/**
 * The AFL's rendering. `hideContract` drops both the contract metric card and
 * the contract detail row, because that league has no salaries — showing a
 * "Free Agent" fallback there is actively misleading. A structurally different
 * render from every story above.
 */
export const AflNoContract = {
  args: {
    previewOpen: true,
    hideContract: true,
    preview: {
      name: 'Puka Nacua',
      agePill: '24',
      metaText: 'WR · LAR · #12',
      subText: '6\'2" · 212 lb · 3rd season',
      ownerName: 'Gridiron Geeks',
      points: '198.7',
      ppg: '15.3',
      build: '6\'2" · 212 lb',
      status: 'Active',
      draft: '2023 · Rd 5, Pk 177',
      college: 'BYU',
      bye: 'Week 6',
    },
  },
};

/**
 * A long name against the hero band's fixed height. The band sizes its crest
 * off that height, so an overflowing name is the layout's most fragile point
 * and the one worth a standing snapshot.
 */
export const LongName = {
  args: {
    previewOpen: true,
    preview: {
      name: 'Christian Kirk-Rodriguez III',
      agePill: '27',
      metaText: 'WR · JAX · #13',
      subText: '6\'1" · 200 lb · 8th season',
      ownerName: 'The Mariachi Ninjas',
      points: '156.2',
      ppg: '11.2',
      contract: '$18 · 1yr',
      build: '6\'1" · 200 lb',
      status: 'Active',
      draft: '2018 · Rd 2, Pk 47',
      college: 'Texas A&M',
      contractDetail: '$18 expiring',
      bye: 'Week 12',
    },
  },
};

// ── The tabbed sheet (roster pages only) ────────────────────────────────────
// docs/plans/rosters-mobile-layout.md § 4. These go through `preview.sheet`,
// which the component renders with the SAME pure functions the client script
// calls on open (src/utils/player-sheet.ts) — so unlike the strings above,
// the Salary tab's markup here IS production's.

const rosteredQb = {
  name: 'Lamar Jackson',
  agePill: '29 yrs',
  metaText: 'Baltimore · QB · #8',
  subText: 'Louisville · 8 yrs · 2018 Round 1, Pick 32',
  ownerName: 'Pacific Pigskins',
  points: '284.6',
  ppg: '20.3',
  contract: '$5.0M',
  contractLabel: '3 yrs',
  build: '6\'2" · 205 lbs',
  status: 'Healthy · Starter',
  draft: '2018 Round 1, Pick 32',
  college: 'Louisville',
  contractDetail: '$5,000,000 · 3 yrs · $16,550,000 remaining',
  bye: 'Week 7',
};

const heroActions = [
  { id: 'cut-simulate', label: 'Simulate cut', icon: 'icon-bar-chart' },
  { id: 'trade-block', label: 'Trade block', icon: 'icon-bookmark' },
  { id: 'more', label: 'More', icon: 'icon-menu' },
];

const salarySheet = {
  tiles: [
    { label: '2026 salary', value: '$5,000,000' },
    { label: 'Thru 2028', value: '3 yrs' },
    { label: 'Designation', value: 'Standard' },
    { label: 'Remaining', value: '$16.55M' },
  ],
  years: [
    { year: '2026', text: '$5,000,000', kind: 'salary', ifCut: '$2,500,000' },
    { year: '2027', text: '$5,500,000', kind: 'salary', escalated: true, ifCut: '$1,250,000' },
    { year: '2028', text: '$6,050,000', kind: 'salary', escalated: true },
    { year: '2029', text: 'UFA', kind: 'ufa' },
    { year: '2030', text: '—', kind: 'future-ufa' },
  ],
  ifCutLabel: 'If cut',
  options: [
    { id: 'franchise', label: 'Franchise Tag', icon: 'icon-franchise-tag', disabled: true, detail: 'Opens in his final year (2028)' },
    { id: 'team-option', label: 'Team Option', icon: 'icon-franchise-tag', disabled: true, detail: 'Only on team-option (TO) rookie contracts' },
    { id: 'extension', label: 'Veteran Extension', icon: 'icon-coin', cost: '+1 yr $8,420,000 · +2 yrs $10,160,000', detail: 'New 2026 salary, then +10% a year' },
    { id: 'rookie-extension', label: 'Rookie Extension', icon: 'icon-coin-r', disabled: true, detail: 'Only on rookie (RC / TO) contracts' },
  ],
  simulations: [
    { id: 'cut-simulate', label: 'Simulate Cut', icon: 'icon-bar-chart', detail: '2026 space $1.98M → $4.48M · +$2,500,000' },
    { id: 'trade-simulate', label: 'Simulate Trade', icon: 'icon-bar-chart', detail: '2026 space $1.98M → $6.98M · +$5,000,000' },
  ],
};

/** TheLeague Rosters in GM mode: the sheet opens on Salary (Q3). */
export const RosterSalaryTab = {
  args: {
    previewOpen: true,
    preview: {
      ...rosteredQb,
      sheet: { salarySheet, sheetTab: 'salary', quickActions: heroActions, myRank: 'QB 3' },
    },
  },
};

/** After Simulate cut: the sheet stays open and offers Undo (Q5). */
export const RosterSalaryTabSimulated = {
  args: {
    previewOpen: true,
    preview: {
      ...rosteredQb,
      sheet: {
        salarySheet: {
          ...salarySheet,
          simulated: 'Simulated cut',
          simulations: [{ id: 'undo-simulation', label: 'Undo', icon: 'icon-arrow-left', state: 'on', detail: 'Remove the simulated cut' }],
        },
        sheetTab: 'salary',
        quickActions: [
          { id: 'undo-simulation', label: 'Simulated · Undo', icon: 'icon-bar-chart', state: 'on' },
          ...heroActions.slice(1),
        ],
      },
    },
  },
};

/** Coach mode opens on Summary: This week, My Rank and More actions. */
export const RosterSummaryTab = {
  args: {
    previewOpen: true,
    preview: {
      ...rosteredQb,
      sheet: {
        salarySheet,
        sheetTab: 'summary',
        quickActions: heroActions,
        myRank: 'QB 3',
        thisWeek: {
          rows: [
            { label: 'Opponent', value: 'vs CLE' },
            { label: 'Spread', value: '+3.5' },
            { label: 'Opp rank vs pos', value: '#27' },
            { label: 'O/U', value: '44.5' },
            { label: 'Weather', value: '61° · Clear' },
            { label: 'Projected', value: '22.4' },
          ],
        },
        moreActions: [
          { id: 'move-to-ir', label: 'Move to IR', desc: 'Pause participation — cap charge unchanged', icon: 'icon-ambulance' },
          { id: 'trade-builder', label: 'Add to Trade Builder', desc: 'Open the Trade Builder with him pre-loaded', icon: 'icon-transactions-2' },
          { id: 'release', label: 'Release…', desc: 'Cut him for real — review the cap hit first', icon: 'icon-user-times', tone: 'danger' },
        ],
      },
    },
  },
};

/** The AFL shape (Q4): Summary / Game log tabs, no Salary, no contract. */
export const AflTabbedNoSalary = {
  args: {
    previewOpen: true,
    hideContract: true,
    preview: {
      ...rosteredQb,
      sheet: { tabbed: true, sheetTab: 'summary' },
    },
  },
};
