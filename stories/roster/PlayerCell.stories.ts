import PlayerCell from '../../src/components/theleague/PlayerCell.astro';
import { themeModes } from '../../.storybook/modes';

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
    // themeModes, NOT allModes. Both leagues render this component, but
    // player-cell.css reads ZERO league-scoped tokens (verified: no
    // `--league-accent`, no `data-league`), so an AFL snapshot is
    // pixel-identical to TheLeague's. That is 16 snapshots a build buying
    // nothing, and it contradicts this repo's own rule — modes are for axes
    // the args cannot express, and here there is no such axis.
    chromatic: { modes: themeModes },
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

/**
 * No headshot at all — the component falls back to `buildNoHeadshotPlaceholder`:
 * the team's own avatar gradient with a translucent white silhouette on it.
 *
 * NOW SNAPSHOTTED. It used to be excluded because the fallback was a live URL
 * on the MFL photo host — that image was a WHITE DISC with a black silhouette,
 * which loaded on top of the team-color chip and blanked it out entirely. The
 * replacement is an inline data URI, so it is both deterministic (no CDN) and
 * the thing worth guarding: if someone points the fallback back at a remote
 * image, this story goes white and the diff is unmissable.
 */
export const MissingHeadshot = {
  args: { name: 'Unknown Rookie', position: 'TE', nflTeam: 'LAR' },
};

/**
 * Missing headshot on a near-black team — the pairing that motivated the
 * change. The placeholder must show Titans navy, not a white disc.
 */
export const MissingHeadshotNearBlack = {
  args: { name: 'Unknown Rookie', position: 'QB', nflTeam: 'TEN' },
};

/**
 * Missing headshot with no NFL team (free agent). The placeholder falls back
 * to the league-neutral blue rather than rendering colorless.
 */
export const MissingHeadshotFreeAgent = {
  args: { name: 'Unknown Rookie', position: 'WR', nflTeam: 'FA' },
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

// Deliberately five, not six. Jacksonville was here originally and is wrong:
// JAX's primary is #006778, a mid teal that clears both luminance thresholds
// and so never exercises the swap/lighten path this block guards. Five real
// near-blacks are worth more than six with a passenger — TEN #0c2340,
// PIT/NO/LV #101820, BAL #241773.
