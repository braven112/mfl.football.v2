import NetworkBadge from '../../src/components/shared/NetworkBadge.astro';
import { themeModes } from '../../.storybook/modes';

/**
 * The TV-network badge — the mark a game is carried on, in the viewer's country.
 *
 * Pure: a US network name plus a country, resolved through `resolveChannel`.
 * It is the shared primitive behind the NFL games rail, both Set Lineup
 * opponent lines and the game-day hero, and the two things it exists to get
 * right are only visible in a snapshot:
 *
 *  - **The two arms.** A channel with artwork on disk draws its MARK; one
 *    without draws its NAME. The text arm is a real branch, not an <img>
 *    fallback, and `CBS/FOX` (the Sunday doubleheader, unsplit) is the case
 *    that hits it in production.
 *  - **Optical sizing.** The marks are trimmed to their own ink, so equal
 *    height is NOT equal weight — ESPN's wordmark is aspect 4.0 against NBC's
 *    1.07. `max-width: calc(var(--net-badge-h) * 3)` makes the wide ones
 *    width-governed. `AllNetworks` is the story that shows a regression there,
 *    because it puts them side by side at one height.
 *
 * Light + dark, because the dark half is where `TeamIconDarkStyles` swaps
 * DAZN/YouTube TV to their white cuts and rings the marks that would otherwise
 * dissolve — a treatment keyed on the image `src`, with no markup here to
 * suggest it is happening.
 */
export default {
  title: 'Shared/NetworkBadge',
  component: NetworkBadge,
  parameters: {
    layout: 'centered',
    chromatic: { modes: themeModes },
  },
  args: {
    network: 'CBS',
    country: 'US',
  },
  argTypes: {
    country: { control: 'inline-radio', options: ['US', 'CA', 'AU', 'GB', 'MX'] },
    network: {
      control: 'select',
      options: ['CBS', 'FOX', 'NBC', 'ESPN', 'ABC', 'NFL Network', 'Prime Video', 'Netflix', 'CBS/FOX', ''],
    },
  },
};

/** The common case: a Sunday afternoon game at home. */
export const Mark = {};

/**
 * The text arm. `CBS/FOX` is what the schedule says before the league splits
 * the doubleheader, and no mapping names it — so the badge says so in words
 * rather than rendering nothing.
 */
export const TextArm = {
  args: { network: 'CBS/FOX' },
};

/**
 * ESPN beside NBC at one height — aspect 4.03 against 1.07. If the width cap
 * regresses, this is the story that shows the wordmark swallowing the row.
 */
export const WideWordmark = {
  args: { network: 'ESPN' },
};

/** A square mark, the other end of the aspect range. */
export const SquareMark = {
  args: { network: 'ABC' },
};

/** Bigger, as the game-day hero renders it — the size prop is the only knob. */
export const HeroSize = {
  args: { network: 'NFL Network', size: '1.6rem' },
};

/**
 * Canada: the same US network resolves to DAZN, whose artwork is white and is
 * swapped in by the global dark rules rather than by anything here.
 */
export const Canada = {
  args: { network: 'CBS', country: 'CA' },
};

/** Australia: Kayo, whose pale green needs the LIGHT-mode ring to read. */
export const Australia = {
  args: { network: 'CBS', country: 'AU' },
};

/**
 * A global streamer keeps its own mark everywhere rather than falling back to
 * the country's default carrier — checked before the fallback in
 * `resolveChannel`, and easy to break.
 */
export const GlobalStreamerAbroad = {
  args: { network: 'Prime Video', country: 'GB' },
};

/**
 * ESPN has published no network yet — normal more than a week out. The badge
 * renders NOTHING rather than an empty box, so this snapshot is deliberately
 * blank.
 */
export const NoNetwork = {
  args: { network: '' },
};
