/**
 * CTA routing for the Schefter rumor mill.
 *
 * Trade-flavored beats (any tip with source 'trade_offer'/'trade_bait' or
 * topic === 'trade') route to the Trade Builder so the natural next click
 * is to build a counter-offer. Single-franchise scope pre-loads that franchise
 * — but ONLY when the resolved scope is allowed to name it; multi-franchise,
 * league-wide, or any fuzzed scope drops to the bare builder.
 * Non-trade beats (commish beef, roster gripes, predictions, other) keep
 * the tip-page CTA so readers can whisper a follow-up.
 *
 * The directed-CTA override ("Geeks desk — your move →") points at the
 * tip form and would clobber a Trade Builder link if applied to a trade
 * beat, so it must skip trade-flavored beats entirely.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCta, buildDirectedCta } from '../scripts/schefter-rumor-scan.mjs';
import { franchiseIdsInLink } from '../scripts/lib/schefter-links.mjs';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const SCANNER_SRC = read('scripts/schefter-rumor-scan.mjs');

describe('isTradeFlavoredTip — classification', () => {
  // The function lives inside the scanner mjs and isn't exported; we
  // validate via source-level guards that the predicate covers the
  // documented cases. Behavioral tests of CTA routing live below and
  // exercise the predicate end-to-end.

  it('declares an isTradeFlavoredTip helper', () => {
    expect(SCANNER_SRC).toMatch(/function isTradeFlavoredTip\(tip\)/);
    // Exported, so the behavioral suite below can call the real one.
    expect(SCANNER_SRC).toMatch(/export function isTradeFlavoredTip/);
  });

  it('matches trade_offer source', () => {
    expect(SCANNER_SRC).toMatch(/tip\.source === 'trade_offer'/);
  });

  it('matches trade_bait source', () => {
    expect(SCANNER_SRC).toMatch(/tip\.source === 'trade_bait'/);
  });

  it('matches topic === "trade" web/groupme tips', () => {
    expect(SCANNER_SRC).toMatch(/tip\.topic === 'trade'/);
  });

  it('excludes whisper-back tips so explicit replies stay in their lane', () => {
    // The function returns false when repliesToPostId is set — the body
    // contains both checks in the documented order.
    const fn = SCANNER_SRC.match(
      /function isTradeFlavoredTip\(tip\) \{[\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(fn).toMatch(/tip\.repliesToPostId/);
    expect(fn).toMatch(/return false/);
  });
});

describe('resolveCta — trade-flavored beats route to the Trade Builder', () => {
  // Pull resolveCta out of the scanner via dynamic import. The scanner
  // doesn't run at import time (top-level runs via require.main === module
  // pattern or similar guard), but importing for function refs is safe.
  // We instead validate via grep-asserted source-level behavior + execute
  // via a focused harness below.

  it('imports the Trade Builder constants used by the CTA path', () => {
    expect(SCANNER_SRC).toMatch(/TRADE_BUILDER_LINK_LABEL = 'Open in Trade Builder/);
    expect(SCANNER_SRC).toMatch(/TRADE_BUILDER_GROUPME_PREFIX = 'Counter on the block/);
    // League-relative since the --league conversion: `/${LEAGUE_SLUG}/trade-builder`.
    expect(SCANNER_SRC).toMatch(/const TRADE_BUILDER_PATH = `\/\$\{LEAGUE_SLUG\}\/trade-builder`/);
  });

  it('routes single-franchise trade beats through buildTradeBuilderPath(fid) — when the scope allows naming', () => {
    // Pinned: exactly one franchise named across trade-flavored tips deep-links
    // to that franchise, AND the resolved scope must permit naming it. The
    // second half is not decoration — see the scope-gate suite below.
    expect(SCANNER_SRC).toMatch(
      /franchiseIds\.size === 1 && mayName\s*\n?\s*\?\s*buildTradeBuilderPath\(/,
    );
    expect(SCANNER_SRC).toMatch(/const mayName = franchiseDeepLinkAllowed\(scopeKind\)/);
  });

  it('drops league-wide / multi-franchise trade beats to the bare builder', () => {
    expect(SCANNER_SRC).toMatch(/:\s*TRADE_BUILDER_PATH\b/);
  });

  it('league-wide and commish hints do not count toward franchise scope', () => {
    expect(SCANNER_SRC).toMatch(/fid !== 'league-wide' && fid !== 'commish'/);
  });
});

describe('buildDirectedCta — skips trade beats', () => {
  it('bails out when any tip in the batch is trade-flavored', () => {
    const fn = SCANNER_SRC.match(
      /function buildDirectedCta\(beat\) \{[\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(fn).toMatch(/batch\.some\(isTradeFlavoredTip\)/);
    expect(fn).toMatch(/return null/);
  });
});

describe('CTA routing — against the real exported resolveCta', () => {
  // `resolveCta` and `isTradeFlavoredTip` are exported from the scanner (the
  // file's own convention for its pure helpers), so these call the real thing
  // rather than a local re-implementation. The re-implementation this replaced
  // carried its own warning that it could drift from the scanner — and it had:
  // it predated the scope gate entirely, so it would have kept passing while
  // the scanner leaked a franchise into an href.
  const TIP = '/theleague/schefter/tip';
  const BUILDER = '/theleague/trade-builder';

  // Any naming-allowed scope; the gate itself is exercised below.
  const named = (bucket: unknown) => resolveCta(bucket, 'trade-bait');

  it('trade_offer with one franchise → builder pre-loaded', () => {
    expect(named({ tips: [{ source: 'trade_offer', franchiseHint: '0003' }] }).link)
      .toBe(`${BUILDER}?b=0003`);
  });

  it('trade_bait single franchise → builder pre-loaded', () => {
    expect(named({ tips: [{ source: 'trade_bait', franchiseHint: '0007' }] }).link)
      .toBe(`${BUILDER}?b=0007`);
  });

  it('web tip with topic=trade and one franchise → builder pre-loaded', () => {
    expect(named({ tips: [{ topic: 'trade', franchiseHint: '0001' }] }).link)
      .toBe(`${BUILDER}?b=0001`);
  });

  it('league-wide trade speculation → bare builder', () => {
    expect(named({ tips: [{ topic: 'trade', franchiseHint: 'league-wide' }] }).link).toBe(BUILDER);
  });

  it('multi-franchise trade rumor → bare builder', () => {
    expect(named({
      tips: [
        { source: 'trade_offer', franchiseHint: '0003' },
        { source: 'trade_offer', franchiseHint: '0007' },
      ],
    }).link).toBe(BUILDER);
  });

  it('mixed trade + non-trade bucket still routes to builder (any trade tip wins)', () => {
    expect(named({
      tips: [
        { topic: 'trade', franchiseHint: '0003' },
        { topic: 'roster', franchiseHint: '0003' },
      ],
    }).link).toBe(`${BUILDER}?b=0003`);
  });

  it('commish beef stays on the tip page', () => {
    expect(named({ tips: [{ topic: 'commish', franchiseHint: 'commish' }] }).link).toBe(TIP);
  });

  it('roster gripe stays on the tip page', () => {
    expect(named({ tips: [{ topic: 'roster', franchiseHint: '0005' }] }).link).toBe(TIP);
  });

  it('whisper-back to a non-trade rumor stays on the tip page even with topic=trade', () => {
    expect(named({
      tips: [{ topic: 'trade', franchiseHint: '0003', repliesToPostId: 'sf_rumor_x' }],
    }).link).toBe(TIP);
  });

  it('empty bucket falls back to tip page', () => {
    expect(named({}).link).toBe(TIP);
    expect(named({ tips: [] }).link).toBe(TIP);
  });

  it('the tip-page fallback is PREFIXED', () => {
    // A bare `/schefter/tip` resolves only on a league apex host; on the shared
    // host it hits the 404 catch-all. One July 2026 rumor shipped exactly that.
    expect(named({}).link.startsWith('/theleague/')).toBe(true);
  });
});

describe('the CTA may not name a franchise the prose may not name', () => {
  /**
   * `isTradeFlavoredTip` answers "is this about a trade?". Whether the post may
   * IDENTIFY the team is a different question, answered by the resolved scope —
   * and only the second one governs what may appear in the href.
   *
   * The reachable path: a web tip with topic 'trade' whose scope falls through
   * to `division` (single source, no consent signal, or over the per-tipster
   * naming rate limit) still arrives here with its franchiseHint intact. Before
   * the gate, the body read "a team in the AL East" while the button beneath it
   * pre-loaded that exact franchise — the redaction bug wearing a costume, in
   * the one place none of the redaction tests were looking.
   */
  const tradeTip = { tips: [{ topic: 'trade', franchiseHint: '0003' }] };

  for (const scope of ['franchise-multi-source', 'franchise-explicit-pick', 'trade-bait']) {
    it(`${scope} may deep-link the franchise`, () => {
      expect(resolveCta(tradeTip, scope).link).toBe('/theleague/trade-builder?b=0003');
    });
  }

  for (const scope of ['division', 'league-wide', 'commish', 'tier', 'groupme-public', undefined]) {
    it(`${String(scope)} drops to the bare builder rather than naming the team`, () => {
      const link = resolveCta(tradeTip, scope).link;
      expect(link).toBe('/theleague/trade-builder');
      expect(franchiseIdsInLink(link)).toEqual([]);
    });
  }

  it('the GroupMe URL is fuzzed too, not just the feed card', () => {
    // The chat message carries the same CTA; anonymizing one and not the other
    // would just move which surface leaks.
    const cta = resolveCta(tradeTip, 'division');
    expect(cta.groupMeUrl).not.toMatch(/0003/);
  });

  it('the directed "your move" dare is already scope-gated, and stays that way', () => {
    // buildDirectedCta fires only on franchise-explicit-pick — a naming-allowed
    // scope — which is why it needs no separate gate.
    expect(buildDirectedCta({ anonymized: [{ scope: { kind: 'division' } }], batch: [] })).toBeNull();
    expect(buildDirectedCta({ anonymized: [{ scope: { kind: 'league-wide' } }], batch: [] })).toBeNull();
    expect(SCANNER_SRC).toMatch(/safe\?\.scope\?\.kind !== 'franchise-explicit-pick'/);
  });

  it('and the finished post is checked again before it ships', () => {
    // Same principle as redactSafePayload: applied to the RESULT, so a CTA
    // branch added later is safe by default rather than by remembering.
    expect(SCANNER_SRC).toMatch(/if \(!franchiseDeepLinkAllowed\(beatScopeKind\)\) \{/);
    expect(SCANNER_SRC).toMatch(/franchiseIdsInLink\(post\.link\)/);
  });
});
