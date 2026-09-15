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
 *
 * `--probe` is the one mode that DOES click submit, because verifying the
 * submit handler is the whole point of it. The guarantee is the same and is
 * moved down a layer: the two endpoints it drives are answered from a canned
 * response INSIDE the browser, so the request is recorded and dropped rather
 * than forwarded. Nothing reaches the dev server, and nothing reaches MFL. The
 * cases below pin both halves — that the ordinary walk still never clicks
 * submit, and that the probe never lets a write out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('scripts/cdm-parity-check.mjs', 'utf-8');

describe('the CDM parity harness cannot write to the league', () => {
  it('only clicks submit from inside --probe', () => {
    // Both call sites of the submit-driving helpers must be behind args.probe.
    // If a third appears, or either loses its gate, this fails rather than
    // quietly letting the default walk start writing.
    const calls = [...SRC.matchAll(/await (?:probeFlow|probeDirectOpeners)\(/g)];
    expect(calls, 'submit-driving call sites').toHaveLength(2);
    expect(SRC).toContain('if (args.probe && entry.step1.open) {');
    expect(SRC).toContain('const direct = args.probe ? await probeDirectOpeners(');
  });

  it('answers a probed write in the browser instead of forwarding it', () => {
    const handler = SRC.match(/if \(args\.probe\) \{[\s\S]*?\n  \}\n/)?.[0] ?? '';
    expect(handler, 'the probe route handler').toBeTruthy();

    // The request is recorded and answered locally. `route.continue()` — the
    // one call that would let it out — may appear exactly once, on the GET
    // line, because the page still has to load.
    expect(handler).toContain('route.fulfill(');
    const continues = [...handler.matchAll(/route\.continue\(\)/g)];
    expect(continues, 'forwarding calls in the probe handler').toHaveLength(1);
    expect(handler).toMatch(/if \(req\.method\(\) === 'GET'\) return route\.continue\(\);/);

    // And only these two endpoints are probed; the rest stay aborted.
    const probed = SRC.match(/const PROBE_ENDPOINTS = \[([\s\S]*?)\];/)?.[1] ?? '';
    expect(probed).toContain('api/contracts/declare');
    expect(probed).toContain('api/cut-player');
    expect(probed).not.toContain('watch-list');
    expect(probed).not.toContain('move-to-ir');
    expect(probed).not.toContain('trade-bait');
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
