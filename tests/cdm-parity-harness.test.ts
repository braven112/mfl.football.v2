/**
 * Guards the one property that makes scripts/cdm-parity-check.mjs safe to
 * point at a real league: it never writes.
 *
 * The Contract Declaration Modal's submit is a real MFL write — a declaration,
 * a franchise tag, an extension, a cut. A harness that drives that modal is
 * one careless click away from mutating the league it is supposed to be
 * observing, and the damage would be silent (a tag is not obviously wrong
 * until someone reads the cap sheet). So the no-write guarantee is mechanical
 * here rather than remembered: the flows that write on the first tap are never
 * entered, submit is never clicked, and every write endpoint is aborted at the
 * network layer even if a click gets past the first two.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('scripts/cdm-parity-check.mjs', 'utf-8');

describe('the CDM parity harness cannot write to the league', () => {
  it('never clicks the modal submit', () => {
    expect(SRC).not.toMatch(/cdm-submit'\)\s*(\??\.)?click\(\)/);
    expect(SRC).not.toMatch(/click\(\s*['"]#cdm-submit/);
  });

  it('aborts every known write endpoint at the network layer', () => {
    // GET is let through (the page still has to load); anything else is cut.
    expect(SRC).toMatch(/route\.request\(\)\.method\(\) === 'GET' \? route\.continue\(\) : route\.abort\(\)/);
    for (const endpoint of [
      'api/contracts',
      'api/cut-player',
      'api/move-to-ir',
      'api/move-to-practice',
      'api/trade-bait',
      'api/watch-list',
      'api/autocut-list',
      'api/waiver-claim',
    ]) {
      expect(SRC, endpoint).toContain(endpoint);
    }
  });

  it('only enters flows that open another screen inside the modal', () => {
    // Watch toggles on the first tap by design, and IR / Trade either write or
    // leave the modal — none of them may appear in the walk list.
    const safeFlows = SRC.match(/const SAFE_FLOWS = \[([\s\S]*?)\];/)?.[1] ?? '';
    expect(safeFlows).toBeTruthy();
    expect(safeFlows.toLowerCase()).not.toMatch(/'watch/);
    expect(safeFlows.toLowerCase()).not.toMatch(/move to ir/);
    expect(safeFlows.toLowerCase()).not.toMatch(/trade player/);
    expect(safeFlows).toMatch(/veteran extension/);
    expect(safeFlows).toMatch(/cut player/);
  });

  it('serves a DECODABLE image placeholder, not an empty 200', () => {
    // The roster harness learned this one the hard way: headshots carry an
    // inline onerror cascade that reassigns this.src, so an undecodable body
    // makes the captured state a race against how far the cascade walked —
    // 291 phantom diffs between two identical builds.
    expect(SRC).toMatch(/contentType: 'image\/svg\+xml'/);
    expect(SRC).toMatch(/<svg xmlns=/);
  });
});
