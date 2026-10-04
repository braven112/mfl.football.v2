import ProductShot from '../../src/components/shared/products/ProductShot.astro';
import { FEATURES, PRODUCTS } from '../../src/data/products';
import { allModes } from '../../.storybook/modes';

/**
 * A product-page screenshot (/products). Reads its captures from the product
 * data itself, so a renamed asset fails tests/product-pages.test.ts before it
 * can blank a snapshot here. Snapshotted in both themes: the light and dark
 * captures swap through ThemeImage.
 */
const feature = FEATURES.find((f) => f.screenshot)!;
const phoneShot = PRODUCTS.find((p) => p.slug === 'large-league')!.screenshot!;

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
