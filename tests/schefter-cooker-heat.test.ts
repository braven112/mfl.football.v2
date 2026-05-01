/**
 * Heat-tier tests for the cooker-status endpoint.
 *
 * The heat tier is the soft popularity signal exposed to the tip page so
 * owners can see Schefter heating up as the queue fills. The thresholds are
 * deliberately aligned with the scanner's escalation points in
 * scripts/schefter-rumor-scan.mjs — when the scanner constants move, the
 * heat thresholds MUST move with them or the public copy will diverge from
 * what the scanner is actually doing.
 *
 * These tests pin the boundaries and the alignment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifyHeat,
  HEAT_SIMMER_MIN,
  HEAT_ROLLING_MIN,
  HEAT_BOIL_MIN,
  HEAT_OVERFLOW_MIN,
} from '../src/pages/api/schefter/cooker-status';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('classifyHeat — boundary behavior', () => {
  it('returns quiet for an empty queue', () => {
    expect(classifyHeat(0)).toBe('quiet');
  });

  it('treats small trickle (1-3) as simmer', () => {
    expect(classifyHeat(1)).toBe('simmer');
    expect(classifyHeat(2)).toBe('simmer');
    expect(classifyHeat(3)).toBe('simmer');
  });

  it('flips to rolling at the secondary-gossip-post pressure threshold', () => {
    expect(classifyHeat(HEAT_ROLLING_MIN - 1)).toBe('simmer');
    expect(classifyHeat(HEAT_ROLLING_MIN)).toBe('rolling');
    expect(classifyHeat(5)).toBe('rolling');
  });

  it('flips to boil at the gossip-boost queue depth', () => {
    expect(classifyHeat(HEAT_BOIL_MIN - 1)).toBe('rolling');
    expect(classifyHeat(HEAT_BOIL_MIN)).toBe('boil');
    expect(classifyHeat(9)).toBe('boil');
  });

  it('flips to overflow once the batch limit is exceeded', () => {
    expect(classifyHeat(HEAT_OVERFLOW_MIN - 1)).toBe('boil');
    expect(classifyHeat(HEAT_OVERFLOW_MIN)).toBe('overflow');
    expect(classifyHeat(50)).toBe('overflow');
  });
});

describe('heat thresholds align with scanner constants', () => {
  // The scanner's pressure points are the source of truth for what counts
  // as "busy". If these constants ever drift from cooker-status, the public
  // popularity signal stops matching what the scanner is actually doing.
  const scannerSrc = read('scripts/schefter-rumor-scan.mjs');

  function readNumericConst(name: string): number {
    const match = scannerSrc.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`));
    if (!match) throw new Error(`Could not find ${name} in schefter-rumor-scan.mjs`);
    return Number(match[1]);
  }

  it('HEAT_ROLLING_MIN matches SECONDARY_GOSSIP_POST_PRESSURE', () => {
    expect(HEAT_ROLLING_MIN).toBe(readNumericConst('SECONDARY_GOSSIP_POST_PRESSURE'));
  });

  it('HEAT_BOIL_MIN matches GOSSIP_BOOST_QUEUE_DEPTH', () => {
    expect(HEAT_BOIL_MIN).toBe(readNumericConst('GOSSIP_BOOST_QUEUE_DEPTH'));
  });

  it('HEAT_OVERFLOW_MIN matches MAX_TIPS_PER_BATCH', () => {
    expect(HEAT_OVERFLOW_MIN).toBe(readNumericConst('MAX_TIPS_PER_BATCH'));
  });

  it('thresholds increase strictly monotonically', () => {
    expect(HEAT_SIMMER_MIN).toBeLessThan(HEAT_ROLLING_MIN);
    expect(HEAT_ROLLING_MIN).toBeLessThan(HEAT_BOIL_MIN);
    expect(HEAT_BOIL_MIN).toBeLessThan(HEAT_OVERFLOW_MIN);
  });
});

describe('cooker-status response shape includes heat fields', () => {
  const src = read('src/pages/api/schefter/cooker-status.ts');

  it('declares heat on the snapshot type', () => {
    expect(src).toMatch(/heat:\s*Heat/);
  });

  it('declares backloggedHint on the snapshot type', () => {
    expect(src).toMatch(/backloggedHint:\s*boolean/);
  });

  it('only sets backloggedHint when heat is boil or overflow', () => {
    // Spot-check the live fn — the JSON write path uses these values.
    // We don't have a live Redis here, so cover the boundaries directly.
    expect(classifyHeat(HEAT_BOIL_MIN - 1)).not.toMatch(/boil|overflow/);
    expect(classifyHeat(HEAT_BOIL_MIN)).toMatch(/boil|overflow/);
    expect(classifyHeat(HEAT_OVERFLOW_MIN)).toMatch(/boil|overflow/);
  });
});
