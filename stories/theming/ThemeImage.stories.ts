import ThemeImage from '../../src/components/ThemeImage.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The highest-value story in this suite relative to its size.
 *
 * ThemeImage swaps a hand-authored dark asset for its light one — AFL tier and
 * conference badges. Its own header explains why it cannot be done in
 * frontmatter: with theme preference 'auto' the SERVER CANNOT KNOW the
 * resolved theme, so BOTH <img> elements always render and CSS
 * (src/styles/theme-image.css) decides which is visible.
 *
 * That design is what makes it dangerous without snapshots. A regression here
 * is INVISIBLE IN WHICHEVER THEME YOU HAPPEN TO BE LOOKING AT — drop the
 * `.theme-img--dark` rule and light mode stays perfect while dark shows both
 * badges stacked, or the wrong one. It is the exact failure shape
 * docs/claude/rules/theming-and-assets.md calls this repo's most expensive bug
 * class, and a light/dark pair catches it on the first build.
 *
 * These are the only stories here whose LIGHT and DARK captures must differ.
 * Everything else in the suite re-skins; this one swaps the asset itself. If a
 * pair ever comes back identical, the swap is broken, not stable.
 *
 * theme-image.css is loaded by preview.ts, not by this component reaching the
 * canvas — it imports the sheet in frontmatter, which is Trap 2.
 */
export default {
  title: 'Theming/ThemeImage',
  component: ThemeImage,
  parameters: {
    chromatic: { modes: themeModes },
  },
};

/** The AFL Premier tier badge — a real pair shipped in public/assets/afl. */
export const PremierTierBadge = {
  args: {
    src: '/assets/afl/premier.svg',
    darkSrc: '/assets/afl/premier-dark.svg',
    alt: 'Premier tier',
    width: 96,
    height: 96,
  },
};

/** A second real pair, to catch a rule that accidentally hard-codes one asset. */
export const DLeagueTierBadge = {
  args: {
    src: '/assets/afl/dleague.svg',
    darkSrc: '/assets/afl/dleague-dark.svg',
    alt: 'D-League tier',
    width: 96,
    height: 96,
  },
};

/**
 * `eager` + `sync`, the attributes a badge above the fold gets. The component
 * contract is that every pass-through attribute lands on BOTH images; if it
 * reaches only the light one the dark render silently loses its sizing.
 */
export const EagerWithExplicitSizing = {
  args: {
    src: '/assets/afl/premier.svg',
    darkSrc: '/assets/afl/premier-dark.svg',
    alt: 'Premier tier',
    width: 48,
    height: 48,
    loading: 'eager',
    decoding: 'sync',
  },
};

/**
 * Same asset for both themes — what a caller passes when no dark variant was
 * authored. It must render as ONE visible badge in both themes, not two
 * stacked. This is the story that fails loudest if the visibility rules break,
 * because a broken rule shows the duplicate in the SAME theme rather than
 * hiding it in the other one.
 */
export const NoDarkVariantAuthored = {
  args: {
    src: '/assets/afl/premier.svg',
    darkSrc: '/assets/afl/premier.svg',
    alt: 'Premier tier',
    width: 96,
    height: 96,
  },
};
