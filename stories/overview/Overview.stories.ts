import WorkbenchOverview from './WorkbenchOverview.astro';

/**
 * The Storybook landing page: what this workbench is.
 *
 * Pinned to the top of the sidebar by the `storySort` order in preview.ts.
 */
export default {
  title: 'Overview',
  component: WorkbenchOverview,
  parameters: {
    layout: 'fullscreen',
  },
};

export const Home = {};
