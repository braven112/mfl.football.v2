import Breadcrumbs from '../../src/components/theleague/Breadcrumbs.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The most-reused component in the repo — 34 importers, and until now no
 * visual coverage at all. One break shows up on 34 pages at once, which is
 * exactly the profile a snapshot suite exists for.
 *
 * Pure presentation: `items` in, a linked trail out, no data reads and no
 * auth. The only interesting logic is positional — the LAST item is the
 * current page and must render as a non-link `aria-current="page"` regardless
 * of whether it was given an `href` — so the stories below are mostly about
 * trail SHAPE rather than content.
 *
 * Theme only. `resolveLeaguePath` rewrites hrefs per league, but that changes
 * link targets, not a single pixel, so an AFL snapshot would be identical.
 */
export default {
  title: 'Nav/Breadcrumbs',
  component: Breadcrumbs,
  parameters: {
    chromatic: { modes: themeModes },
  },
};

/** The common case: one parent, then the current page. */
export const TwoLevel = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Standings' },
    ],
  },
};

/** A deeper trail — separators between every pair, none trailing. */
export const ThreeLevel = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Reports', href: '/reports' },
      { label: 'Division Strength' },
    ],
  },
};

/**
 * THE POSITIONAL RULE. The last item HAS an `href` and must still render as
 * the plain current-page span, never a link. This is the one behaviour a
 * careless refactor of the `isLast` check would silently invert, and reading
 * the DOM is the only way to see it — both renders look similar at a glance.
 */
export const LastItemWithHrefIsNotALink = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Franchises', href: '/franchises' },
      { label: 'Pacific Pigskins', href: '/franchises/0001' },
    ],
  },
};

/** A single item — no separators at all. The degenerate trail. */
export const SingleItem = {
  args: {
    items: [{ label: 'Home' }],
  },
};

/**
 * Long labels against a narrow column. The list is `flex-wrap: wrap`, so this
 * pins how a trail breaks across lines rather than overflowing — the only
 * layout failure this component can actually have.
 */
export const WrappingLongLabels = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Historical Season Archive', href: '/archive' },
      { label: 'Projected Free Agents and Contract Expirations' },
    ],
  },
};
