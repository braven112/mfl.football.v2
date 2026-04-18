/**
 * Tests for the Schefter tip API surface.
 *
 * Covers the P0 regression guard (admin rate-limit exemption removed) and the
 * tips-remaining response shape.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// P0 regression guard — this is a source-level check. If anyone ever re-adds
// the admin exemption, any surface that reports a per-user counter becomes a
// de-anonymization oracle (see engagement plan P0). We pin the assertion at
// the source level to make the reasoning visible in test output.
describe('P0 admin rate-limit exemption', () => {
  const tipSource = readFileSync(
    path.join(process.cwd(), 'src/pages/api/schefter/tip.ts'),
    'utf8',
  );

  it('does not import isCommissionerOrAdmin from auth', () => {
    expect(tipSource).not.toMatch(/isCommissionerOrAdmin/);
  });

  it('applies the rate-limit counter unconditionally (no admin branch)', () => {
    // The 3/24h rate limit must run for every authenticated caller; there is
    // no "if (!isAdmin)" guard and no early return that skips the INCR path.
    expect(tipSource).toMatch(/redis\.incr\(rateKey\)/);
    expect(tipSource).not.toMatch(/const\s+isAdmin\s*=/);
    expect(tipSource).not.toMatch(/if\s*\(!isAdmin\)/);
  });

  it('still returns 429 when the counter exceeds RATE_LIMIT_MAX', () => {
    expect(tipSource).toMatch(/count\s*>\s*RATE_LIMIT_MAX/);
    expect(tipSource).toMatch(/['"]rate_limited['"]/);
  });
});

// ── tips-remaining endpoint shape ──

describe('tips-remaining endpoint', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'src/pages/api/schefter/tips-remaining.ts'),
    'utf8',
  );

  it('exports prerender=false so the dynamic handler runs on every request', () => {
    expect(src).toMatch(/export\s+const\s+prerender\s*=\s*false/);
  });

  it('requires authentication', () => {
    expect(src).toMatch(/getAuthUser/);
    expect(src).toMatch(/unauthorized/);
  });

  it('hashes the user id before touching Redis (never exposes raw id)', () => {
    expect(src).toMatch(/hashTipsterId\(user\.id\)/);
  });

  it('returns max=3 and never surfaces values above the cap', () => {
    expect(src).toMatch(/RATE_LIMIT_MAX\s*=\s*3/);
    expect(src).toMatch(/Math\.min\(used,\s*RATE_LIMIT_MAX\)/);
  });

  it('degrades gracefully when Redis is unavailable', () => {
    // If we cannot read the counter we must still render a usable UI — return
    // the optimistic max so the submit button stays enabled. The POST endpoint
    // still enforces the cap atomically when Redis recovers.
    expect(src).toMatch(/remaining:\s*RATE_LIMIT_MAX/);
  });
});
