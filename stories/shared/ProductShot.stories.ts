import ProductShot from '../../src/components/shared/products/ProductShot.astro';
import { FEATURES, type Screenshot } from '../../src/data/products';
import { allModes } from '../../.storybook/modes';

/**
 * A product-page screenshot (/products). Reads its captures from the product
 * data itself, so a renamed asset fails tests/product-pages.test.ts before it
 * can blank a snapshot here. Snapshotted in both themes: the light and dark
 * captures swap through ThemeImage.
 */
const feature = FEATURES.find((f) => f.screenshot)!;
// The lineup no longer carries a light-only portrait capture (the products it
// belonged to were folded into the custom site), so this one is named here.
const phoneShot: Screenshot = {
  src: '/assets/whats-new/standings-mobile-no-sideways-scroll.webp',
  alt: 'Standings for a large league on a phone screen, with no sideways scrolling.',
};

export default {
  title: 'Shared/ProductShot',
  component: ProductShot,
  parameters: { chromatic: { modes: allModes } },
};

export const Catalog = {
  args: { shot: feature.screenshot, variant: 'catalog' },
};

export const Thumb = {
  args: { shot: feature.screenshot, variant: 'thumb' },
};

/** A light-only, phone-shaped capture: contained, never cropped. */
export const LightOnlyPortrait = {
  args: { shot: phoneShot, variant: 'card' },
};
