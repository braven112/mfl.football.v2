import PlayerCell from '../../src/components/theleague/PlayerCell.astro';
import { allModes } from '../../.storybook/modes';

/**
 * The player lockup used everywhere a roster row appears — both leagues'
 * roster pages, free agents, lineup tables, trade builder.
 *
 * This is the highest-traffic component reachable from `rosters.astro`, and
 * the only part of that page that is safely storyable: the page itself is
 * ~12,500 lines and the player modals are empty shells populated by client JS.
 *
 * WHY IT EARNS SNAPSHOTS: the avatar backdrop is not a raw team color. It goes
 * through `getPlayerAvatarBackground` / `getPlayerAvatarBorder`, which pick a
 * readable anchor and floor its luminance, because roughly a third of the NFL
 * wears a near-black primary and a dark-jerseyed headshot on it is invisible
 * in dark mode. That exact bug shipped in July 2026 (Cam Ward on Titans navy).
 * The `NearBlackPrimaries` story below is a standing guard against it.
 *
 * Headshots are inline data URIs, never espncdn — Chromatic waits for network
 * idle, so a live CDN would make every one of these flaky.
 */

/** Neutral silhouette. A literal, not Buffer.from — see Trap 6. */
const FACE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyMDAgMjAwJz48Y2lyY2xlIGN4PScxMDAnIGN5PSc3Micgcj0nNDInIGZpbGw9JyNjZmQ0ZGEnLz48cGF0aCBkPSdNMjAgMjAwYzAtNDYgMzYtNzQgODAtNzRzODAgMjggODAgNzR6JyBmaWxsPScjY2ZkNGRhJy8+PC9zdmc+';

export default {
  title: 'Roster/PlayerCell',
  component: PlayerCell,
  parameters: {
    // Both leagues render this, and nothing in the args says which league is
    // active — the surface it sits on is themed by CSS. Genuine 4-mode case.
    chromatic: { modes: allModes },
  },
};

export const Default = {
  args: { name: 'Ja’Marr Chase', position: 'WR', nflTeam: 'CIN', headshot: FACE },
};

/** The dense variant used in tables and the lineup grid. */
export const Compact = {
  args: { name: 'Ja’Marr Chase', position: 'WR', nflTeam: 'CIN', headshot: FACE, size: 'compact' },
};

/** Position line carries the contract state appended after the position. */
export const WithContractStatus = {
  args: {
    name: 'Breece Hall',
    position: 'RB',
    nflTeam: 'NYJ',
    headshot: FACE,
    contractStatus: 'FA',
  },
};

/**
 * A team defense. `isDef` forces the logo-avatar path — a team mark instead of
 * a headshot, on a different backdrop treatment.
 */
export const TeamDefense = {
  args: { name: 'Bills, Buffalo', position: 'DEF', nflTeam: 'BUF', isLogoAvatar: true },
};

/** No headshot at all. The fallback must not collapse the lockup. */
export const MissingHeadshot = {
  args: { name: 'Unknown Rookie', position: 'TE', nflTeam: 'LAR' },
};

/**
 * THE REGRESSION GUARD — six stories, one purpose.
 *
 * These are NFL teams whose primary is near-black or deep navy: the exact set
 * the avatar helpers exist to handle. If someone swaps
 * `getPlayerAvatarBackground` for a raw `getNflTeamColors` primary, every one
 * of them goes muddy or invisible in dark mode, and these are what catch it.
 *
 * Titans first because that is the one that actually shipped broken.
 */
export const NearBlackTitans = {
  args: { name: 'Cam Ward', position: 'QB', nflTeam: 'TEN', headshot: FACE },
};

export const NearBlackRavens = {
  args: { name: 'Lamar Jackson', position: 'QB', nflTeam: 'BAL', headshot: FACE },
};

export const NearBlackSteelers = {
  args: { name: 'George Pickens', position: 'WR', nflTeam: 'PIT', headshot: FACE },
};

export const NearBlackSaints = {
  args: { name: 'Alvin Kamara', position: 'RB', nflTeam: 'NO', headshot: FACE },
};

export const NearBlackRaiders = {
  args: { name: 'Brock Bowers', position: 'TE', nflTeam: 'LV', headshot: FACE },
};

export const NearBlackJaguars = {
  args: { name: 'Brian Thomas Jr.', position: 'WR', nflTeam: 'JAX', headshot: FACE },
};
