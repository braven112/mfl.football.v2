/**
 * The Transactions screen's feed — what `/api/mfl-live/transactions?league=`
 * answers the MFL Football app (package O).
 *
 * One league's adds, drops, waiver claims, auction wins and trades for the
 * league year, newest first. The server parses MFL with the site's own
 * normalizer (`src/utils/mfl-transactions.ts`) and resolves every id to a
 * name, so the phone never reads MFL's pipe strings and never keeps a second
 * parser of them (docs/claude/rules/schefter.md, "A parity test is only as
 * strong as its corpus").
 *
 * Store-safe: MFL data only. A player is a name, a position and an NFL team
 * ABBREVIATION as text — no headshots, no logos.
 *
 * Types only, no runtime code — the app imports this with `import type`.
 * `src/types/mfl-live-app-o-contract.ts` asserts the server's view stays
 * assignable to it.
 */

/** `free-agent` is first-come-first-served; `blind-bid` is a FAAB waiver claim. */
export type MflLiveAppTransactionKind = 'free-agent' | 'waiver' | 'blind-bid' | 'auction' | 'trade';

export interface MflLiveAppTxPlayer {
  /** MFL player id. */
  id: string;
  /** "First Last". Falls back to `Player <id>` only when MFL does not know him. */
  name: string;
  /** "RB", "Def", … Empty when unknown. */
  position: string;
  /** NFL team abbreviation as text ("KC", "FA"). Empty when unknown. Never a logo. */
  nflTeam: string;
}

export interface MflLiveAppTxTeam {
  /** Zero-padded MFL franchise id, e.g. "0007". */
  franchiseId: string;
  name: string;
  /** True for the signed-in owner's own franchise in this league. */
  mine: boolean;
}

export interface MflLiveAppTxTradeSide {
  /** The team GIVING UP everything listed on this side. */
  team: MflLiveAppTxTeam;
  players: MflLiveAppTxPlayer[];
  /** Draft picks given up, already worded: "2027 Round 1 (Bring The Pain)", "Round 2, Pick 4". */
  picks: string[];
}

export interface MflLiveAppTransaction {
  /** Stable across reads; MFL gives rows no id of its own. */
  id: string;
  /** Epoch milliseconds. */
  at: number;
  kind: MflLiveAppTransactionKind;
  /** For a trade, the first side's team. */
  team: MflLiveAppTxTeam;
  added: MflLiveAppTxPlayer[];
  dropped: MflLiveAppTxPlayer[];
  /** What it cost in dollars (a bid, an auction price), or null when nothing was paid or it is unknowable. */
  amount: number | null;
  /** The commissioner made this move for the team. */
  byCommish: boolean;
  /** Present only when `kind === 'trade'`: what each team gave up. */
  trade?: { sides: [MflLiveAppTxTradeSide, MflLiveAppTxTradeSide]; comments: string };
}

export interface MflLiveAppTransactionsFeed {
  leagueId: string;
  leagueName: string;
  /** MFL league year the rows come from. */
  year: number;
  /** The signed-in owner's franchise in this league. */
  myFranchiseId: string;
  /** Newest first; at most `limit` of them. */
  transactions: MflLiveAppTransaction[];
  /** Pass back as `before=` for the next, older page. Null when there is nothing older. */
  nextBefore: string | null;
  /** When the server read MFL (epoch ms); it re-reads at most once a minute. */
  fetchedAt: number;
}
