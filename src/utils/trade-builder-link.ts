/**
 * The link into a league's Trade Builder, preloaded with one player.
 *
 * ONE place decides this because the two builders are separate pages that
 * grew separate vocabularies for the same three facts, and nothing in either
 * URL announces which dialect it is:
 *
 *   TheLeague  /theleague/trade-builder?b=<franchise>&bp=<player>
 *   AFL        /afl-fantasy/trade-builder?to=<franchise>&target=<player>
 *
 * They also disagree about the viewer's own side. TheLeague's page derives it
 * (resolveInitialTradeState seats the viewer on whichever side the link left
 * empty), while the AFL's defaults `from` to the signed-in owner's franchise.
 * Both therefore want the OTHER team's id and nothing else — passing the
 * viewer's own would put one club on both sides of the trade — so this builder
 * deliberately takes only the counterparty.
 *
 * A league with no builder returns null rather than a guessed path: Best Ball
 * is draft-only and has no trade page at all, and a 404 is a worse answer than
 * no button.
 */
import type { RankingsScope } from './rankings-scope';

interface BuilderDialect {
  path: string;
  /** Query key naming the OTHER franchise. */
  team: string;
  /** Query key naming the player on that franchise. */
  player: string;
}

const DIALECTS: Partial<Record<RankingsScope, BuilderDialect>> = {
  theleague: { path: '/theleague/trade-builder', team: 'b', player: 'bp' },
  afl: { path: '/afl-fantasy/trade-builder', team: 'to', player: 'target' },
  // bb1: draft-only, no trade builder. Absence is the answer.
};

export interface TradeBuilderLinkInput {
  scope: RankingsScope;
  /** The franchise holding the player — never the viewer's own. */
  franchiseId: string;
  playerId: string;
}

/**
 * The builder path for one player, or null when this league has no builder or
 * the inputs are incomplete. The result is prefixed (`/theleague/...`); run it
 * through `resolveLeaguePath` before using it as an href on an apex host.
 */
export function buildTradeBuilderPath({
  scope,
  franchiseId,
  playerId,
}: TradeBuilderLinkInput): string | null {
  const dialect = DIALECTS[scope];
  if (!dialect || !franchiseId || !playerId) return null;
  const params = new URLSearchParams();
  params.set(dialect.team, String(franchiseId));
  params.set(dialect.player, String(playerId));
  return `${dialect.path}?${params.toString()}`;
}

/** Whether a league has a Trade Builder to link to at all. */
export function leagueHasTradeBuilder(scope: RankingsScope): boolean {
  return scope in DIALECTS;
}
