import CtaGallery from './CtaGallery.astro';
import { allModes } from '../../.storybook/modes';

/**
 * The shared CTA pattern — `cta cta--primary`, `cta cta--ghost`, `cta-link`
 * (src/styles/cta.css; rules in docs/claude/rules/theming-and-assets.md
 * § "CTAs — one pattern").
 *
 * The gallery is the reference: every variant on <a> and <button>, a
 * simulated hover column (Chromatic cannot hover), disabled, and a
 * custom-ground example showing colours set through --cta-* variables.
 */
export default {
  title: 'Design System/CTAs',
  component: CtaGallery,
};

/**
 * Snapshotted across leagues: the primary fill reads --btn-primary-bg, which
 * the AFL skin re-points to its red, so the AFL is a real shipping
 * combination — a league diff here is the skin working, not a regression.
 */
export const Gallery = {
  args: { mode: 'gallery' },
  parameters: { chromatic: { modes: allModes } },
};

/**
 * One CTA, driven by the Controls panel. Not snapshotted: every combination
 * it can show is already in Gallery, so a capture here would buy nothing.
 */
export const Playground = {
  args: {
    mode: 'single',
    variant: 'primary',
    element: 'a',
    label: 'Change your vote',
    disabled: false,
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'ghost', 'link'] },
    element: { control: 'inline-radio', options: ['a', 'button'] },
  },
  parameters: { chromatic: { disableSnapshot: true } },
};
