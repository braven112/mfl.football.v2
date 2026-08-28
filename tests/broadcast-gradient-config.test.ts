/**
 * `broadcastGradient` — the franchise card background, as config.
 *
 * The field is a RAW CSS string (chosen over structured stops for the
 * flexibility: multi-layer, radial, conic). That flexibility means nothing else
 * in the build can catch a typo — a stray `;` renders as no background at all,
 * on a TV, in front of the league. This suite is the thing that catches it:
 * every franchise in both real leagues must carry one, and every one must pass
 * the same validator the card runs at paint time.
 *
 * It also pins the two hand-authored cards (Brandon, 2026-08-28). The other
 * franchises' entries were GENERATED from `toBroadcastPair` to reproduce what
 * the card already painted, so a future regeneration would happily flatten
 * Midwestside and Vitside back to the derived pair. These assertions make that
 * a failing test rather than a silent revert on draft night.
 */

import { describe, it, expect } from 'vitest';
import {
  isSafeCssGradient,
  resolveBroadcastGradient,
  toBroadcastPair,
} from '../src/utils/draft-broadcast';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import theleagueConfig from '../src/data/theleague.config.json';

const LEAGUES = [
  { slug: 'afl', teams: aflConfig.teams as any[] },
  { slug: 'theleague', teams: theleagueConfig.teams as any[] },
];

/** The angle of a `linear-gradient(Ndeg, …)`, or null. */
function angleOf(gradient: string): number | null {
  const m = /^linear-gradient\(\s*(-?[\d.]+)deg/.exec(gradient);
  return m ? parseFloat(m[1]) : null;
}

/** Every `#rrggbb <pos>%` stop, in written order. */
function stopsOf(gradient: string): { hex: string; at: number }[] {
  return [...gradient.matchAll(/#([0-9a-fA-F]{6})\s+([\d.]+)%/g)].map((m) => ({
    hex: `#${m[1].toLowerCase()}`,
    at: parseFloat(m[2]),
  }));
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Rough perceived brightness, 0–255. Good enough to say "this is black". */
function brightness(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function teamById(slug: string, franchiseId: string) {
  const league = LEAGUES.find((l) => l.slug === slug)!;
  const team = league.teams.find((t) => t.franchiseId === franchiseId);
  expect(team, `${slug} has no franchise ${franchiseId}`).toBeDefined();
  return team;
}

describe('every franchise carries a broadcastGradient', () => {
  for (const { slug, teams } of LEAGUES) {
    it(`${slug}: all ${teams.length} franchises have one, and it validates`, () => {
      const missing = teams.filter((t) => !t.broadcastGradient).map((t) => t.franchiseId);
      expect(missing, `${slug} franchises missing broadcastGradient`).toEqual([]);

      const invalid = teams
        .filter((t) => !isSafeCssGradient(t.broadcastGradient))
        .map((t) => `${t.franchiseId} ${t.name}: ${t.broadcastGradient}`);
      expect(invalid, `${slug} franchises with an unpaintable gradient`).toEqual([]);
    });

    it(`${slug}: every gradient survives the card's resolver`, () => {
      for (const t of teams) {
        expect(resolveBroadcastGradient(t), `${slug} ${t.franchiseId}`).toBe(t.broadcastGradient);
      }
    });
  }
});

describe('isSafeCssGradient', () => {
  it('accepts the shapes the config actually uses', () => {
    expect(isSafeCssGradient('linear-gradient(115deg, #28855f 0%, #1a875b 100%)')).toBe(true);
    expect(isSafeCssGradient('radial-gradient(60% 80% at 70% 70%, #fff 0%, #000 100%)')).toBe(true);
    expect(
      isSafeCssGradient(
        'radial-gradient(50% 50% at 80% 80%, #ffd400 0%, transparent 60%), linear-gradient(315deg, #000 0%, #111 100%)'
      )
    ).toBe(true);
  });

  it('rejects a value that would break out of the style declaration', () => {
    // The whole reason the field is validated: these render a BLANK card.
    expect(isSafeCssGradient('linear-gradient(115deg, #000 0%, #fff 100%); color: red')).toBe(false);
    expect(isSafeCssGradient('linear-gradient(115deg, #000 0%, #fff 100%)}')).toBe(false);
    expect(isSafeCssGradient('linear-gradient(115deg, #000 0%, #fff 100%)"')).toBe(false);
  });

  it('rejects anything that is not a gradient', () => {
    expect(isSafeCssGradient('url(https://example.com/x.png)')).toBe(false);
    expect(isSafeCssGradient('#000000')).toBe(false);
    expect(isSafeCssGradient('red')).toBe(false);
  });

  it('rejects unbalanced parens, which swallow the next declaration', () => {
    expect(isSafeCssGradient('linear-gradient(115deg, #000 0%, #fff 100%')).toBe(false);
    expect(isSafeCssGradient('linear-gradient(115deg, #000 0%, #fff 100%))')).toBe(false);
  });

  it('rejects empty and non-string values rather than painting them', () => {
    expect(isSafeCssGradient(undefined)).toBe(false);
    expect(isSafeCssGradient(null)).toBe(false);
    expect(isSafeCssGradient('')).toBe(false);
    expect(isSafeCssGradient('   ')).toBe(false);
  });
});

/**
 * 315deg points at the TOP-LEFT, so the gradient's 0% stop is the BOTTOM-RIGHT
 * corner — which is where the player cutout stands on the reveal card. Both
 * hand-authored cards are built on that fact.
 */
describe('the two hand-authored cards', () => {
  const MIDWESTSIDE = [
    { slug: 'afl', id: '0011' },
    { slug: 'theleague', id: '0011' },
  ];
  const VITSIDE = [
    { slug: 'afl', id: '0009' },
    { slug: 'theleague', id: '0012' },
  ];

  for (const { slug, id } of MIDWESTSIDE) {
    it(`${slug} Midwestside is black with gold only in the bottom-right corner`, () => {
      const team = teamById(slug, id);
      expect(team.name).toContain('Midwestside');
      const g = team.broadcastGradient as string;
      const stops = stopsOf(g);

      expect(angleOf(g), 'gold must come from the bottom-right, i.e. 315deg').toBe(315);

      // 0% (bottom-right, under the player) is the gold.
      const [r, gg, b] = rgb(stops[0].hex);
      expect(r).toBeGreaterThan(200);
      expect(gg).toBeGreaterThan(150);
      expect(b).toBeLessThan(60);

      // 100% (top-left, where the copy sits) is black.
      expect(brightness(stops[stops.length - 1].hex)).toBeLessThan(12);

      // "The black will be really strong" — black owns most of the card, so the
      // gold has to be gone well before halfway across.
      const firstBlack = stops.find((s) => brightness(s.hex) < 20);
      expect(firstBlack, 'gradient never reaches black').toBeDefined();
      expect(firstBlack!.at).toBeLessThanOrEqual(50);
    });
  }

  for (const { slug, id } of VITSIDE) {
    it(`${slug} Vitside is red, with the black anchored bottom-right`, () => {
      const team = teamById(slug, id);
      expect(team.name).toContain('Vitside');
      const g = team.broadcastGradient as string;
      const stops = stopsOf(g);

      expect(angleOf(g), 'black must come from the bottom-right, i.e. 315deg').toBe(315);

      // 0% (bottom-right, under the player) is black — the flip of what this
      // franchise painted before, where black sat upper-left.
      expect(brightness(stops[0].hex)).toBeLessThan(12);

      // 100% (top-left) is the brand red, and it still carries white copy.
      const [r, gg, b] = rgb(stops[stops.length - 1].hex);
      expect(r).toBeGreaterThan(130);
      expect(r).toBeGreaterThan(gg * 2);
      expect(r).toBeGreaterThan(b * 2);
    });
  }

  it('the two cards are mirror images, not the same card twice', () => {
    const mid = teamById('afl', '0011').broadcastGradient;
    const vit = teamById('afl', '0009').broadcastGradient;
    expect(mid).not.toBe(vit);
    // Both start bottom-right, and the corner stop is what differs: gold vs black.
    expect(brightness(stopsOf(mid).at(0)!.hex)).toBeGreaterThan(100);
    expect(brightness(stopsOf(vit).at(0)!.hex)).toBeLessThan(12);
  });
});

/**
 * The other 38 franchises were GENERATED, not designed — each entry is exactly
 * the gradient `toBroadcastPair` already produced, written down. That makes this
 * whole change a visual no-op everywhere except the two cards above, and this
 * test is the proof.
 *
 * Hand-authoring a third card is fine — add it to HAND_AUTHORED, and pin what
 * you meant in the block above. What must NOT happen quietly is a franchise
 * drifting away from its brand colours because someone edited the string and
 * nothing noticed.
 */
describe('generated gradients still match the derived pair', () => {
  const HAND_AUTHORED = new Set(['afl:0011', 'afl:0009', 'theleague:0011', 'theleague:0012']);

  for (const { slug, teams } of LEAGUES) {
    it(`${slug}: every generated entry equals what toBroadcastPair yields`, () => {
      const drifted: string[] = [];
      for (const t of teams) {
        if (HAND_AUTHORED.has(`${slug}:${t.franchiseId}`)) continue;
        const pair = toBroadcastPair(
          t.colorPrimary || '#1c497c',
          t.colorSecondary || t.colorPrimary || '#0e2440'
        );
        const expected = `linear-gradient(115deg, ${pair.primary} 0%, ${pair.secondary} 100%)`;
        if (t.broadcastGradient !== expected) {
          drifted.push(`${t.franchiseId} ${t.name}\n  config: ${t.broadcastGradient}\n  derived: ${expected}`);
        }
      }
      expect(drifted, `${slug} gradients no longer match their brand colours`).toEqual([]);
    });
  }
});
