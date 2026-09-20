import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  fillsIn,
  loadReversals,
  normalizeHex,
  reverseSvg,
  REVERSED_DIR,
  LIGHT_DIR,
} from '../scripts/lib/nfl-mark-reversal.mjs';
import { derive } from '../scripts/derive-nfl-reversed-marks.mjs';
import { markOptions, markUrl } from '../src/utils/nfl-marks';
import { getAllNFLTeamCodes } from '../src/utils/nfl-logo';

/**
 * The DERIVED reversed cut — the one mark in this repo we make rather than
 * fetch, because no public source publishes one.
 *
 * Three things can break it silently, and each is a test here:
 *
 * 1. **The committed light art moves.** The reversal is a colour swap keyed on
 *    exact fills. A logo refresh that changes one turns the swap into a no-op
 *    (the mark ships unchanged and dissolves on a dark ground) or into a half-
 *    applied mess. `reverseSvg` throws on an absent source colour; this pins
 *    that it still throws rather than degrading to a skip.
 *
 * 2. **The committed output drifts from the map.** A hand-edited file, or a
 *    map edit nobody re-derived, and the page shows art no rule produces.
 *
 * 3. **A club is offered a cut it has none of.** `markUrl` must return null for
 *    the 29 clubs with no reversal, or the Brand Book links a 404.
 */

const clubs = loadReversals();
const CODES = Object.keys(clubs);

describe('nfl mark reversals', () => {
  it('covers exactly the three clubs reviewed on a dark render', () => {
    // ATL, BUF, CLE, HOU, LV and TB rendered acceptably and were DECLINED on
    // review (docs/plans/nfl-mark-assignments.md). Their absence is a decision.
    expect(CODES.sort()).toEqual(['ARI', 'DET', 'WSH']);
  });

  it('names a real club and a reason for every entry', () => {
    for (const code of CODES) {
      expect(getAllNFLTeamCodes(), code).toContain(code);
      expect(clubs[code].note, `${code} needs a note — the map is a review record`).toBeTruthy();
      expect(clubs[code].map.length, code).toBeGreaterThan(0);
    }
  });

  it('finds every `from` colour still present in the committed light SVG', () => {
    for (const code of CODES) {
      const svg = readFileSync(join(LIGHT_DIR, `${code}.svg`), 'utf-8');
      const present = fillsIn(svg);
      for (const swap of clubs[code].map) {
        expect(present, `${code}/${swap.part}: ${swap.from} is gone from the art`).toContain(
          normalizeHex(swap.from),
        );
      }
    }
  });

  it('refuses to derive when a source colour is absent, rather than skipping it', () => {
    // A silent skip is the failure mode this guard exists for: it ships the
    // light mark under a "reversed" label with nothing to notice it by.
    expect(() => reverseSvg('<svg><path fill="#123456"/></svg>', [{ from: '#abcdef', to: '#fff' }])).toThrow(
      /absent from the committed SVG/,
    );
  });

  it('swaps simultaneously, so an exchange of two colours survives', () => {
    // Washington's map exchanges its two colours. Applied in sequence the
    // first swap paints every burgundy gold and the second paints ALL of it
    // burgundy — a single-colour blob.
    const out = reverseSvg(
      '<svg><path fill="#5a1414"/><path fill="#ffb612"/></svg>',
      clubs.WSH.map,
    );
    expect(out).toContain('fill="#ffb612"');
    expect(out).toContain('fill="#5a1414"');
    expect(out).toBe('<svg><path fill="#ffb612"/><path fill="#5a1414"/></svg>');
  });

  it('matches a shortened hex, because svgo writes #000 for #000000', () => {
    // ARI's keyline is exactly this case — a raw string compare misses it.
    expect(normalizeHex('#000')).toBe('#000000');
    expect(reverseSvg('<svg><path fill="#000"/></svg>', [{ from: '#000000', to: '#97233f' }])).toBe(
      '<svg><path fill="#97233f"/></svg>',
    );
  });

  it('keeps Detroit\'s interior detail rather than flattening it to a silhouette', () => {
    // The mane, face and leg lines are a separate white layer OVER the blue
    // body. Reversing the body alone merges them into it and the lion becomes
    // a blank shape — so the detail layer is part of the map, not an omission.
    const parts = clubs.DET.map.map((m: { part: string }) => m.part);
    expect(parts).toContain('detail');
    const out = readFileSync(join(REVERSED_DIR, 'DET.svg'), 'utf-8');
    const fills = fillsIn(out);
    expect(fills, 'the body must be white').toContain('#ffffff');
    expect(fills, 'the detail + keyline must stay Honolulu blue').toContain('#0076b6');
  });

  it('has every committed reversed file in step with the map', () => {
    for (const { code, svg, outPath } of derive()) {
      expect(existsSync(outPath), `${code}: run node scripts/derive-nfl-reversed-marks.mjs`).toBe(
        true,
      );
      expect(readFileSync(outPath, 'utf-8'), `${code} differs from what the map produces`).toBe(
        svg,
      );
    }
  });

  it('leaves no orphan file for a club dropped from the map', () => {
    const onDisk = existsSync(REVERSED_DIR)
      ? readdirSync(REVERSED_DIR).filter((f) => f.endsWith('.svg'))
      : [];
    expect(onDisk.sort()).toEqual(CODES.map((c) => `${c}.svg`).sort());
  });

  it('offers the cut to those three clubs and to nobody else', () => {
    for (const code of getAllNFLTeamCodes()) {
      const url = markUrl(code, 'reversed');
      if (CODES.includes(code)) {
        expect(url, code).toBe(`/assets/nfl-logos/reversed/${code}.svg`);
        expect(markOptions(code).find((m) => m.id === 'reversed')?.derived, code).toBe(true);
      } else {
        expect(url, `${code} has no reversal — the page must not link one`).toBeNull();
      }
    }
  });

  it('is the only mark flagged as made here', () => {
    // `derived` is what the Brand Book badges. If a fetched cut ever gets the
    // flag, the badge starts claiming we drew someone else's artwork.
    const flagged = new Set(
      getAllNFLTeamCodes().flatMap((c) => markOptions(c).filter((m) => m.derived).map((m) => m.id)),
    );
    expect([...flagged]).toEqual(['reversed']);
  });
});
