import BrandFranchiseTiles from '../../src/components/shared/brand/BrandFranchiseTiles.astro';
import { allFranchiseBrands } from '../../src/utils/franchise-marks';
import { allModes } from '../../.storybook/modes';

/**
 * Franchise tiles: the franchise's own colour wearing the cut that ground
 * takes. The Brand Book index and every conference and division page draw
 * their clubs with this grid. Real franchises, so the tiles are the live art.
 */
export default {
  title: 'Shared/Brand Book/Franchise tiles',
  component: BrandFranchiseTiles,
  parameters: { chromatic: { modes: allModes } },
};

export const EastDivision = {
  args: {
    franchises: allFranchiseBrands('theleague').filter((b) => b.division === 'East'),
    hrefFor: () => '#',
  },
};
