/**
 * Player action specs — what the shared PlayerActionModal renders.
 *
 * A surface (free-agent row, custom-rankings row, details modal) opens the
 * modal with a player and a list of actions. Each action owns its own
 * side-effect via `run()`, so the modal never knows about MFL, watch lists,
 * or trade blocks — it renders options, shows working/success/error, and
 * re-renders the list after a run so a toggle reads its new state.
 *
 * `buildWatchAction` is the one action every surface shares. It reads and
 * writes through `watch-list-client`, and it is the reason the option text
 * flips between "Watch player" and "Stop watching" everywhere at once.
 */

import { isWatched, toggleWatch, getWatchListAuth } from './watch-list-client';
import { getLeagueBySlug } from '../config/leagues';

export interface PlayerActionPlayer {
  id: string;
  name: string;
  position?: string | null;
  nflTeam?: string | null;
  espnId?: string | null;
  headshot?: string | null;
  /** Fantasy franchise rostering the player, for the band colors. */
  franchiseId?: string | null;
  /** Free text under the meta line — e.g. "Rostered by Pacific Pigskins". */
  subText?: string | null;
}

export interface PlayerActionRunResult {
  ok: boolean;
  /** Shown inline under the option on success (e.g. "Added to your watch list"). */
  message?: string;
  error?: string;
  /** True when the viewer must sign in — the modal hands off to the sign-in dialog. */
  signedOut?: boolean;
  /** Close the modal after a short beat (default: stay open, re-render). */
  close?: boolean;
}

export interface PlayerActionSpec {
  id: string;
  label: string;
  desc?: string;
  /** Sprite symbol id, e.g. "icon-eye". */
  icon: string;
  kind?: 'default' | 'destructive' | 'active';
  /** Disabled options render but do nothing; `desc` says why. */
  disabled?: boolean;
  /**
   * Signed-out surfaces set this so a click opens the sign-in dialog
   * (`requestSignIn`) instead of running. The modal closes itself first so
   * the sign-in dialog is the only thing on screen.
   */
  signIn?: boolean;
  /** Navigate instead of running. */
  href?: string;
  /**
   * Close the sheet BEFORE `run()` — for an action that opens another dialog
   * (the waiver claim form) and must not race it for the top layer.
   */
  closeFirst?: boolean;
  run?: () => Promise<PlayerActionRunResult>;
}

export interface PlayerActionPayload {
  player: PlayerActionPlayer;
  /** Called on every render, so a toggle can read its current state. */
  actions: () => PlayerActionSpec[];
  title?: string;
}

export const WATCH_ACTION_ID = 'watch';

/**
 * The Watch / Stop watching option.
 *
 * Signed-out is decided by the caller when the page knows (SSR), and
 * otherwise by what the store learned from its last request — a visitor who
 * has never hit the API reads as signed-in until the first click proves
 * otherwise, at which point the run result carries `signedOut` and the modal
 * swaps to the sign-in trigger.
 */
export function buildWatchAction(
  playerId: string,
  { signedIn = getWatchListAuth() !== 'signed-out' }: { signedIn?: boolean } = {},
): PlayerActionSpec {
  const watched = isWatched(playerId);
  if (!signedIn) {
    return {
      id: WATCH_ACTION_ID,
      label: 'Watch player',
      desc: 'Sign in to build your watch list',
      icon: 'icon-eye',
      signIn: true,
    };
  }
  return {
    id: WATCH_ACTION_ID,
    label: watched ? 'Stop watching' : 'Watch player',
    desc: watched
      ? 'Remove him from your watch list'
      : 'His news lights up in the Schefter Report and you can filter to him',
    icon: watched ? 'icon-eye-slash' : 'icon-eye',
    kind: watched ? 'active' : 'default',
    run: async () => {
      const res = await toggleWatch(playerId);
      if (!res.ok) return { ok: false, error: res.error, signedOut: res.signedOut };
      return { ok: true, message: res.watched ? 'Added to your watch list' : 'Removed from your watch list' };
    },
  };
}

/** Open the shared modal if the page mounted it. Returns false when it did not. */
export function openPlayerActionModal(payload: PlayerActionPayload): boolean {
  const opener = (window as any).openPlayerActionModal;
  if (typeof opener !== 'function') return false;
  opener(payload);
  return true;
}

/**
 * Put the sign-in dialog on screen, or fall back to the league's login page.
 *
 * SignInModal is mounted only where a page chose to; a surface that lives on
 * every page (the player details modal) cannot assume it. When the dialog is
 * absent the league's login route takes a `?redirect=` back to this page,
 * which is the same landing the modal delivers.
 */
export function requestSignIn(): void {
  const dialog = document.getElementById('signin-modal') as HTMLDialogElement | null;
  if (dialog && typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
    (dialog.querySelector('[autocomplete="username"]') as HTMLInputElement | null)?.focus();
    return;
  }
  // On a league's own apex host the middleware hides the league prefix, so
  // the first path segment is the PAGE ("standings"), not the league. Only
  // a segment that is a registry slug is a prefix; otherwise the bare
  // /login resolves through the root catch-all to this league's login.
  const [, first] = window.location.pathname.split('/');
  const prefix = first && getLeagueBySlug(first) ? `/${first}` : '';
  const back = `${window.location.pathname}${window.location.search}`;
  window.location.href = `${prefix}/login?redirect=${encodeURIComponent(back)}`;
}
