import type { MflLiveAppIdentityMatchup } from '@mfl/shared-types/mfl-live-app-e';
import type { Theme } from './theme';

/** Both sides of one matchup, ready to paint. */
export interface MatchupColors {
  mine: string;
  theirs: string;
  /** For text: lifted to readable contrast on the card by the server. */
  mineInk: string;
  theirsInk: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A server colour, or the theme's own when it is missing or malformed. */
function pick(value: string | undefined, fallback: string): string {
  return value && HEX.test(value) ? value : fallback;
}

/**
 * The colours the web board paints this matchup with (its `colorVars`, dark
 * values, resolved server-side against the same card colour the app uses).
 *
 * A board from before the server sent them falls back to the app's own look,
 * red for me and the empty track for them, so nothing changes until it does.
 */
export function matchupColors(matchup: MflLiveAppIdentityMatchup, t: Theme): MatchupColors {
  const vars = matchup.colorVars ?? {};
  return {
    mine: pick(vars['--t0-dark'], t.accent),
    theirs: pick(vars['--t1-dark'], t.field),
    mineInk: pick(vars['--t0-ink-dark'], t.text),
    theirsInk: pick(vars['--t1-ink-dark'], t.muted),
  };
}
