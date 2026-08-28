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
