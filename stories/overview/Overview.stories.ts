import ChromaticReport from './ChromaticReport.astro';

/**
 * The Storybook landing page: what this workbench is, plus the current
 * Chromatic build's snapshot cost.
 *
 * Pinned to the top of the sidebar by the `storySort` order in preview.ts.
 */
export default {
  title: 'Overview',
  component: ChromaticReport,
  parameters: {
    layout: 'fullscreen',

    // NEVER snapshot this. It renders live build data fetched at runtime, so
    // the numbers change on literally every build — capturing it would produce
    // a guaranteed visual diff every time and train everyone to click "accept"
    // without looking, which is how a visual test suite stops working.
    chromatic: { disableSnapshot: true },
  },
};

export const Home = {
  args: { monthlyQuota: 5000 },
};
