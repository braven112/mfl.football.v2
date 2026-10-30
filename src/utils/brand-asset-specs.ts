/**
 * The asset specs a new league or team owner is handed at onboarding
 * (`/brand/specs` on the shared host, rendered by `BrandSpecsPage`).
 *
 * Every size here is a MASTER: owners send big, we resize. The `shownAt`
 * figures are what the site actually stores and paints today, and
 * `STORED_SIZES` names the files that prove them — `tests/brand-asset-specs.test.ts`
 * measures those files, so the page cannot quietly drift from the art it
 * describes when a stored size changes.
 */

import { writeLogoPrompt } from './team-logo-prompt';

export interface AssetSpec {
  id: string;
  name: string;
  /** Who supplies it at onboarding. */
  owner: 'team' | 'league';
  required: boolean;
  /** The master we ask for, in pixels. */
  size: string;
  ratio: string;
  format: string;
  background: string;
  /** Where and how big the site paints it, smallest first. */
  shownAt: string;
  notes: string[];
  template?: { label: string; svg: string; png: string };
}

const TEMPLATE_DIR = '/assets/brand-specs';
const template = (label: string, base: string) => ({
  label,
  svg: `${TEMPLATE_DIR}/${base}-template.svg`,
  png: `${TEMPLATE_DIR}/${base}-template.png`,
});

/** Uploads through the commissioner branding editor (`/api/admin/branding-upload`). */
export const UPLOAD_LIMITS = { formats: 'PNG, JPG or WebP', maxMb: 2 } as const;

export const ASSET_SPECS: AssetSpec[] = [
  {
    id: 'crest',
    name: 'Team crest',
    owner: 'team',
    required: true,
    size: '1024 × 1024',
    ratio: '1:1 square',
    format: 'SVG best, else transparent PNG',
    background: 'Transparent',
    shownAt: '16–40 px in lists and rosters, 100 px on cards, 400 px in GroupMe, about 730 px on the draft broadcast',
    notes: [
      'Your main mark. It appears next to your team name everywhere on the site.',
      'Keep it inside the safe square. A few screens crop it to a circle.',
    ],
    template: template('Crest template', 'crest'),
  },
  {
    id: 'crest-dark',
    name: 'Crest for dark backgrounds',
    owner: 'team',
    required: false,
    size: '1024 × 1024',
    ratio: '1:1 square',
    format: 'SVG best, else transparent PNG',
    background: 'Transparent',
    shownAt: 'Everywhere the crest appears, when the viewer uses dark mode',
    notes: [
      'Only needed if your crest has black or very dark edges that would vanish on a dark card.',
      'Same art, with the dark parts swapped for white or a light outline.',
    ],
  },
  {
    id: 'banner',
    name: 'Team banner',
    owner: 'team',
    required: true,
    size: '1900 × 316',
    ratio: '6:1 wide',
    format: 'SVG best, else transparent PNG',
    background: 'Transparent',
    shownAt: '950 × 158 on desktop, roughly 340 px wide on a phone',
    notes: ['Your crest on the left and your team name to its right, in big, bold letters.'],
    template: template('Banner template', 'banner'),
  },
  {
    id: 'colors',
    name: 'Team colors',
    owner: 'team',
    required: true,
    size: '2 to 4 colors',
    ratio: '—',
    format: 'Hex codes, e.g. #BD1F2B',
    background: '—',
    shownAt: 'Headers, scoreboards, the broadcast and your Brand Book page',
    notes: ['List your main color first. We check every color for contrast in light and dark mode.'],
  },
  {
    id: 'mono',
    name: 'One-color mark',
    owner: 'team',
    required: false,
    size: '1024 × 1024',
    ratio: '1:1 square',
    format: 'SVG best, else transparent PNG',
    background: 'Transparent',
    shownAt: 'Seasonal weeks such as Halloween, at the same sizes as the crest',
    notes: ['Your crest drawn in a single solid color, with no shading. We recolor it for each event.'],
  },
  {
    id: 'league-logo',
    name: 'League logo',
    owner: 'league',
    required: true,
    size: '1024 px on the long side',
    ratio: 'Any, between 1:2 and 2:1',
    format: 'SVG best, else transparent PNG',
    background: 'Transparent',
    shownAt: '32–45 px tall in the site header, larger on the home page',
    notes: ['Send a light-mode version (dark ink) and a dark-mode version (light ink).'],
  },
  {
    id: 'app-icon',
    name: 'App icon',
    owner: 'league',
    required: true,
    size: '1024 × 1024',
    ratio: '1:1 square',
    format: 'SVG or PNG',
    background: 'Solid color to every edge',
    shownAt: '16 px browser tab, 180 px iPhone home screen, 512 px Android app icon',
    notes: [
      'We cut the favicon, home-screen and notification icons from this one file.',
      'Phones mask it to a circle or rounded square, so keep the mark inside the circle guide.',
    ],
    template: template('App icon template', 'app-icon'),
  },
  {
    id: 'social',
    name: 'Social share image',
    owner: 'league',
    required: true,
    size: '1200 × 630',
    ratio: '1.91:1',
    format: 'PNG or JPG',
    background: 'Solid (no transparency)',
    shownAt: 'The preview card when a link is shared in GroupMe, iMessage, X or Facebook',
    notes: ['Keep the logo in the center square. Some apps crop the sides.'],
    template: template('Social image template', 'social-image'),
  },
  {
    id: 'badges',
    name: 'Conference and division badges',
    owner: 'league',
    required: false,
    size: '512 × 512',
    ratio: '1:1 square',
    format: 'SVG best, else transparent PNG',
    background: 'Transparent',
    shownAt: 'Small, next to standings and division names, and on the Brand Book',
    notes: ['Simple shapes or initials work best at these sizes. Send light and dark versions if the ink is dark.'],
  },
];

/**
 * Stored files that back a `shownAt` claim above: [path under public/, width, height].
 * Measured by the test, so a resize of the stored art fails until this page says so.
 */
export const STORED_SIZES: ReadonlyArray<readonly [string, number, number]> = [
  ['assets/theleague/icons/0001.png', 100, 100],
  ['assets/theleague/group-me/0001.png', 400, 400],
  ['assets/theleague/banners/0001.png', 950, 158],
  ['assets/afl/favicons/apple-touch-icon.png', 180, 180],
  ['assets/afl/favicons/favicon-512.png', 512, 512],
];

/**
 * The files one crest is cut into, in pixels. The logo resizer
 * (`src/data/logo-platform-sizes.ts`) reads these rather than copying them, and
 * the test pins them to `STORED_SIZES`, so the resizer cannot hand out an MFL
 * size the site does not store.
 */
export const CREST_OUTPUTS = {
  crest: 1024,
  cardIcon: 100,
  groupMe: 400,
  banner: { width: 950, height: 158 },
  bannerRetina: { width: 1900, height: 316 },
  appIcon: 512,
  favicons: [16, 32, 180, 512],
} as const;

/**
 * Copy-paste starting point for an AI image tool. `[brackets]` are the owner's to fill.
 * The same sentence the logo prompt builder writes (`team-logo-prompt.ts`), so the
 * two can never drift.
 */
export const AI_PROMPT = writeLogoPrompt({
  teamName: '[team name]',
  idea: '[your mascot or idea]',
  stylePhrase: 'a bold sports logo',
  colors: '[colors]',
  kind: 'icon',
});
