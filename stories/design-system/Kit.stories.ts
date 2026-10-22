import KitGallery from './KitGallery.astro';
import { allModes } from '../../.storybook/modes';

/**
 * The component kit — `ui-badge` (src/styles/badge.css), `ui-card`
 * (src/styles/card.css) and `ui-modal` / `ui-scrim` (src/styles/modal.css). Plan and rules: docs/plans/component-kit.md,
 * docs/claude/rules/theming-and-assets.md § "Component kit".
 *
 * Snapshotted across leagues: the info and accent tones read league-themed
 * tokens, and the card surface reads the site style's --style-card-*, so a
 * league diff here is the theme working, not a regression.
 */
export default {
  title: 'Design System/Component kit',
  component: KitGallery,
};

export const Badge = {
  args: { part: 'badge' },
  parameters: { chromatic: { modes: allModes } },
};

export const Card = {
  args: { part: 'card' },
  parameters: { chromatic: { modes: allModes } },
};

export const Modal = {
  args: { part: 'modal' },
  parameters: { chromatic: { modes: allModes } },
};

export const Tabs = {
  args: { part: 'tabs' },
  parameters: { chromatic: { modes: allModes } },
};

export const Table = {
  args: { part: 'table' },
  parameters: { chromatic: { modes: allModes } },
};

export const Pill = {
  args: { part: 'pill' },
  parameters: { chromatic: { modes: allModes } },
};
