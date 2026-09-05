/**
 * The trade-block → rumor-mill lane runs for BOTH leagues, and its Redis keys
 * must be built from the league being scanned.
 *
 * History: `scanTradeBait` was written for TheLeague with its tips-queue keys
 * captured at module load as `schefterKey('theleague', …)`. Flipping the AFL's
 * `tradeBait` toggle on without re-scoping them would have pushed every AFL
 * listing into TheLeague's queue — which TheLeague's rumor-scan step drains
 * and posts to TheLeague's GroupMe. These tests pin both halves: the toggle
 * and the key scoping.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SCHEFTER_LEAGUES, getSchefterLeague } from '../scripts/lib/schefter-leagues.mjs';

const src = readFileSync(path.join(process.cwd(), 'scripts/schefter-scan.mjs'), 'utf8');

describe('trade-bait lane — per-league enablement', () => {
  it('runs for TheLeague AND the AFL', () => {
    expect(getSchefterLeague('theleague').features.tradeBait).toBe(true);
    expect(getSchefterLeague('afl-fantasy').features.tradeBait).toBe(true);
  });

  it('every league with the lane on has a rumor mill to drain its queue', () => {
    // A tip enqueued for a league whose rumor-scan never runs sits in Redis
    // forever — the lane is only useful paired with the consumer.
    for (const league of SCHEFTER_LEAGUES) {
      if (league.features.tradeBait) {
        expect(league.features.rumorMill, `${league.slug} tradeBait without rumorMill`).toBe(true);
      }
    }
  });
});

describe('scanTradeBait — Redis keys are built from the scanned league', () => {
  const match = src.match(/async function scanTradeBait[\s\S]+?\n\}\n/);
  if (!match) throw new Error('scanTradeBait not found in scanner');
  const body = match[0];

  it('never hardcodes TheLeague as the tips-queue tenant', () => {
    // Module-level constants captured for one league are the exact bug.
    expect(src).not.toMatch(/const TIPS_QUEUE_KEY = schefterKey\('theleague'/);
    expect(src).not.toMatch(/const FIRST_TIP_TS_KEY = schefterKey\('theleague'/);
  });

  it('derives both keys from league.slug', () => {
    expect(src).toMatch(/schefterKey\(league\.slug, 'tips:queue'\)/);
    expect(src).toMatch(/schefterKey\(league\.slug, 'tips:first_tip_ts'\)/);
    expect(body).toMatch(/tipsQueueKey\(league\)/);
    expect(body).toMatch(/firstTipTsKey\(league\)/);
  });

  it('treats "state key present on the feed" as seeded, not "state has franchises"', () => {
    // The AFL launches with an EMPTY block, so its persisted state is `{}`.
    // Sizing the seed check on Object.keys would re-seed forever and swallow
    // every franchise's first listing.
    expect(body).toMatch(/leagueSeeded/);
    expect(body).not.toMatch(/!Object\.keys\(prevState\)\.length/);
  });
});
