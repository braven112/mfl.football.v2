/**
 * Set Lineup — the bench list.
 *
 * The bench is not a list, it is a DERIVED VIEW: "every rostered player who is
 * not currently in one of the nine slots." Both lineup pages rendered it once
 * server-side and never again, while the slots above it were re-rendered on
 * every swap by the page's own client script. So the moment an owner seated
 * someone from the bench, the page showed him TWICE — once in his new slot and
 * once still on the bench — and the player he replaced vanished from the page
 * entirely (owner report, 2026-09-15: "I added DJ Moore to my starting lineup
 * but he still shows on the bottom").
 *
 * This module is the one definition of that view, used by BOTH the `.astro`
 * server render and the client re-render on each page, so the two cannot
 * disagree about who is on the bench or what a bench row looks like.
 *
 * See `docs/claude/rules/lineups.md`.
 */

import { NFL_LOGO_ONERROR, NFL_LOGO_ONLOAD } from '../constants/roster-constants';
import { buildPlayerCellHTML, escapeHtml as esc } from './player-cell-html';

/** The slot fields the bench derivation cares about. */
export interface BenchSlot {
  playerId: string | null;
}

/** The player fields a bench row reads. */
export interface BenchPlayer {
  id: string;
  name: string;
  headshot?: string;
  position: string;
  nflTeam: string;
  projection: number | null;
  gameLocked: boolean;
  gameIndex: number | null;
  isBye: boolean;
}

/** The schedule fields a bench row reads (`GameInfo`, as both pages build it). */
export interface BenchGame {
  home: string;
  away: string;
  channel: { name: string; logo: string | null; title: string } | null;
}

/**
 * Who is on the bench, in display order (best projection first).
 *
 * Derived from the slots THEMSELVES rather than from a `usedPlayerIds` set
 * accumulated during the server-side fill: that set is only correct at the
 * instant the page renders, and the client has no equivalent of it.
 */
export function selectBenchPlayers<T extends { id: string; projection: number | null }>(
  roster: T[],
  slots: BenchSlot[],
): T[] {
  const seated = new Set(slots.map((s) => s.playerId).filter((id): id is string => !!id));
  return roster
    .filter((p) => !seated.has(p.id))
    .sort((a, b) => (b.projection ?? -1) - (a.projection ?? -1));
}

/**
 * One bench row, as an HTML string for the client re-render.
 *
 * Markup parity with the `.astro` branch is load-bearing twice over: the CSS is
 * addressed by these exact class names, and `applyRankChips` finds its rows by
 * `.lineup-bench-row[data-player-id]`. The two renders are a pair — move them
 * together.
 */
export function buildBenchRowHTML(player: BenchPlayer, game: BenchGame | null): string {
  const oppTeam = game ? (player.nflTeam === game.home ? game.away : game.home) : null;
  const isHome = game ? player.nflTeam === game.home : false;
  const matchupPrefix = isHome ? 'vs' : '@';
  const matchupLabel = isHome ? `vs ${oppTeam}` : `at ${oppTeam}`;
  const ch = game?.channel ?? null;

  const playerCell = buildPlayerCellHTML({
    name: player.name,
    headshot: player.headshot,
    position: player.position,
    nflTeam: player.nflTeam,
    size: 'compact',
  });

  const netHtml = !ch
    ? ''
    : ch.logo
      ? `<span class="net-badge net-badge--mark lineup-bench-row__net" title="${esc(ch.title)}"><img class="net-badge__logo" src="${esc(ch.logo)}" alt="${esc(ch.name)}" decoding="async" /></span>`
      : `<span class="net-badge lineup-bench-row__net" title="${esc(ch.title)}">${esc(ch.name)}</span>`;

  let gameHtml = '';
  if (player.isBye) {
    gameHtml = `<span class="lineup-bench-row__bye">BYE</span>`;
  } else if (oppTeam) {
    gameHtml = `<div class="lineup-bench-row__opp" aria-label="${esc(matchupLabel)}">${netHtml}<span class="lineup-bench-row__opp-prefix">${matchupPrefix}</span><img src="/assets/nfl-logos/${esc(oppTeam)}.svg" alt="" aria-hidden="true" class="lineup-bench-row__opp-logo" width="18" height="18" onerror="${esc(NFL_LOGO_ONERROR)}" onload="${esc(NFL_LOGO_ONLOAD)}" /></div>`;
  }

  const projHtml =
    player.projection != null
      ? `<span class="lineup-bench-row__proj">${player.projection.toFixed(1)}</span>`
      : '';

  return `<li class="lineup-bench-row${player.gameLocked ? ' lineup-bench-row--locked' : ''}" data-player-id="${esc(player.id)}"><div class="lineup-bench-row__player">${playerCell}</div>${gameHtml}${projHtml}</li>`;
}
