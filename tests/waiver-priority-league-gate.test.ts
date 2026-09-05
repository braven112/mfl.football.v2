/**
 * A waiver PRIORITY ORDER may only be shown where MFL says one exists.
 *
 * TheLeague is `BBID_FCFS` — blind bidding, ties broken first come first
 * served. It has no priority order. MFL serves it a `waiverSortOrder` anyway
 * (it always does), which is the trap: the number looks authoritative, is the
 * default reverse-franchise-id list nobody set, and decides nothing. Shipping
 * it invented a queue for sixteen owners.
 *
 * These pin the three places that could put it back:
 *   1. the resolver, which must read MFL's `currentWaiverType`, not the slug
 *   2. the hub config, which must gate the row and screen on that
 *   3. the API route, which is what makes the number look official
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const leagueFeed = (slug: string, year: number) =>
  JSON.parse(read(`data/${slug}/mfl-feeds/${year}/league.json`)).league;

describe('waiver priority is gated on MFL settings', () => {
  it('the two leagues really do differ in MFL, which is why a slug check is not the fix', () => {
    // If either of these changes, the product decision changes with it — that
    // is the point of reading the setting rather than hardcoding a league.
    expect(leagueFeed('theleague', 2026).currentWaiverType).toBe('BBID_FCFS');
    expect(leagueFeed('afl-fantasy', 2026).currentWaiverType).toBe('WAIVERS_FCFS');
  });

  it('the resolver decides from currentWaiverType, never from a league slug', () => {
    const src = read('src/utils/waiver-system.ts');
    // readBidRules is the ONE reader of currentWaiverType; going around it
    // would be a second interpretation of the same MFL field.
    expect(src).toMatch(/readBidRules/);
    // A slug may only be used to pick WHICH feed to read, never to decide the
    // answer — so no comparison of a slug against a system.
    expect(src).not.toMatch(/===\s*'priority'\s*\|\|\s*leagueSlug/);
    expect(src).toMatch(/leagueUsesWaiverPriority/);
  });

  it('hides the priority row AND the screen, not just the row', () => {
    const modal = read('src/components/theleague/TransactionHubModal.astro');
    // Two gates: the hub-home row, and view 5 itself. Hiding only the row
    // leaves a screen reachable by any stray showView call.
    const gates = modal.match(/\{config\.showWaiverPriority && \(/g) ?? [];
    expect(gates.length).toBe(2);
    expect(modal).toMatch(/id="thm-hub-order"/);
    expect(modal).toMatch(/id="thm-order-view"/);
  });

  it('does not spend an MFL read on an order it would never show', () => {
    const script = read('src/scripts/transaction-hub.ts');
    const load = script.slice(script.indexOf('async function thmLoadOrder'));
    const body = load.slice(0, load.indexOf('\n}'));
    // The bail must come before the fetch, not after it.
    expect(body.indexOf('showWaiverPriority')).toBeGreaterThan(-1);
    expect(body.indexOf('showWaiverPriority')).toBeLessThan(body.indexOf('fetch('));
  });

  it('the API route refuses, and decides from the build-time feed not the live read', () => {
    const route = read('src/pages/api/waiver-order.ts');
    expect(route).toMatch(/leagueUsesWaiverPriority\(league\.slug, year\)/);
    // Before the MFL read: a refusal that costs a round-trip is still a bug.
    expect(route.indexOf('leagueUsesWaiverPriority(league.slug, year)')).toBeLessThan(
      route.indexOf('await readLiveOrder('),
    );
    // Inferring the system from the live payload would flip a real priority
    // league to "no order here" for the length of an MFL outage.
    expect(route).not.toMatch(/readBidRules/);
  });

  it('no longer claims priority breaks tied bids — BBID_FCFS breaks them FCFS', () => {
    const render = read('src/utils/waiver-priority-render.ts');
    expect(render).not.toMatch(/breaks ties between equal bids/);
    // And the footnote no longer takes a system it cannot act on honestly.
    expect(render).toMatch(/export function waiverPriorityFootnote\(asOf: string, live: boolean\)/);
  });
});
