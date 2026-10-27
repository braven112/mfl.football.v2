/**
 * Compile-time contract for the app's trade screens (package M).
 *
 * `MflLiveAppTrades` / `MflLiveAppTradeBuilder`
 * (packages/shared-types/src/mfl-live-app-trades.ts) are what the phone's
 * Trades and Trade builder screens read; the loaders below are what
 * `/api/mfl-live/trades` and `/api/mfl-live/trade-builder` send. If either
 * side is renamed or retyped, the assignments stop type-checking and
 * `pnpm test:types` fails, instead of the app breaking on an owner's phone.
 * Nothing imports this file; it exists to be checked.
 */

import type {
  MflLiveAppTradeBuilder,
  MflLiveAppTrades,
} from '../../packages/shared-types/src/mfl-live-app-trades';
import type { loadAppTrades, loadTradeBuilder } from '../utils/live/mfl-live-app-trades';

type TradesView = Awaited<ReturnType<typeof loadAppTrades>>['view'];
type BuilderView = Awaited<ReturnType<typeof loadTradeBuilder>>;

export type MflLiveAppTradesContract = TradesView extends MflLiveAppTrades
  ? BuilderView extends MflLiveAppTradeBuilder
    ? true
    : never
  : never;
export const mflLiveAppTradesContract: MflLiveAppTradesContract = true;
