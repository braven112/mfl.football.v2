/**
 * Cross-corroboration: real MFL pending offer × independent tipster sources.
 *
 * When a trade-offer tip (source: 'trade_offer') is being whispered about
 * independently in the rest of the queue (web/groupme tips that match the
 * same franchise scope or mention a player name from the offer), the LLM
 * upgrades to direct-knowledge voice — "multiple sources with direct
 * knowledge", "spoke on the condition of anonymity" — instead of the
 * default "I'm hearing chatter" hedge.
 *
 * The matcher (`findCorroboratingTips`) is the source-of-truth predicate
 * for this elevation. These tests pin its behavior and the downstream
 * plumbing (anonymizer surface, LLM directive insertion).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const SCANNER_SRC = read('scripts/schefter-rumor-scan.mjs');
const REDACT_SRC = read('scripts/lib/redact-trade-offer.mjs');

describe('redactTradeOffer — corroboration metadata', () => {
  it('exposes partnerFranchiseId on the redacted tip', () => {
    expect(REDACT_SRC).toMatch(/partnerFranchiseId/);
    expect(REDACT_SRC).toMatch(
      /offeringFid === String\(rawOffer\.franchise\)\s*\?\s*rawOffer\.franchise2\s*:\s*rawOffer\.franchise/,
    );
  });

  it('exposes lower-cased playerNames for substring matching', () => {
    expect(REDACT_SRC).toMatch(/playerNames\s*=\s*allAssets/);
    expect(REDACT_SRC).toMatch(/a\.name\.toLowerCase\(\)/);
  });

  it('keeps internal-only metadata fields out of the LLM-visible tip', () => {
    // The anonymizer's trade_offer branch must NOT assign partnerFranchiseId
    // or playerNames onto `safe` — those are matcher-only metadata.
    // (Comments inside the branch may reference them as guidance; what we
    // care about is that no `safe.<field> =` assignment exists.)
    const branch = SCANNER_SRC.match(
      /if \(tip\.source === 'trade_offer'\) \{[\s\S]*?return safe;\s*\}/,
    )?.[0] ?? '';
    expect(branch).not.toMatch(/safe\.partnerFranchiseId\s*=/);
    expect(branch).not.toMatch(/safe\.playerNames\s*=/);
  });
});

describe('findCorroboratingTips — match logic', () => {
  // Reimplement the predicate to validate behavior. The real function
  // lives at module scope in the scanner mjs and is grep-asserted below.
  function findCorroboratingTips(
    tradeOfferTip: { source?: string; offeringFranchiseId?: string; partnerFranchiseId?: string; playerNames?: string[] } | null,
    otherTips: Array<{ id?: string; source?: string; topic?: string; franchiseHint?: string; text?: string }>,
  ): string[] {
    if (!tradeOfferTip || tradeOfferTip.source !== 'trade_offer') return [];
    const offeringFid = tradeOfferTip.offeringFranchiseId;
    const partnerFid = tradeOfferTip.partnerFranchiseId;
    const playerNames = Array.isArray(tradeOfferTip.playerNames) ? tradeOfferTip.playerNames : [];
    const matchingFids = new Set(
      [offeringFid, partnerFid].filter(
        (fid): fid is string => typeof fid === 'string' && fid.length > 0 && fid !== 'league-wide' && fid !== 'commish',
      ),
    );
    const matches = new Set<string>();
    for (const tip of otherTips) {
      if (!tip || tip.source === 'trade_offer') continue;
      let matched = false;
      if (tip.topic === 'trade' && tip.franchiseHint && matchingFids.has(tip.franchiseHint)) {
        matched = true;
      }
      if (!matched && playerNames.length > 0 && typeof tip.text === 'string' && tip.text.length > 0) {
        const textLower = tip.text.toLowerCase();
        for (const name of playerNames) {
          if (name && textLower.includes(name)) {
            matched = true;
            break;
          }
        }
      }
      if (matched && tip.id) matches.add(tip.id);
    }
    return [...matches];
  }

  const baseOffer = {
    source: 'trade_offer' as const,
    offeringFranchiseId: '0003',
    partnerFranchiseId: '0007',
    playerNames: ["ja'marr chase", 'breece hall'],
  };

  it('matches a web trade-topic tip pointing at the offering franchise', () => {
    const matches = findCorroboratingTips(baseOffer, [
      { id: 't1', source: 'web', topic: 'trade', franchiseHint: '0003', text: 'shopping their 1st' },
    ]);
    expect(matches).toEqual(['t1']);
  });

  it('matches a web trade-topic tip pointing at the partner franchise', () => {
    const matches = findCorroboratingTips(baseOffer, [
      { id: 't2', source: 'web', topic: 'trade', franchiseHint: '0007', text: 'looking for a WR' },
    ]);
    expect(matches).toEqual(['t2']);
  });

  it('does NOT match a non-trade-topic tip on the same franchise', () => {
    const matches = findCorroboratingTips(baseOffer, [
      { id: 't3', source: 'web', topic: 'roster', franchiseHint: '0003', text: 'roster looks weak' },
    ]);
    expect(matches).toEqual([]);
  });

  it('matches a player-name substring even with different scope', () => {
    const matches = findCorroboratingTips(baseOffer, [
      { id: 't4', source: 'web', topic: 'trade', franchiseHint: 'league-wide', text: "Hearing JA'MARR CHASE is on the move" },
    ]);
    expect(matches).toEqual(['t4']);
  });

  it('matches a GroupMe tip the same way (source-agnostic)', () => {
    const matches = findCorroboratingTips(baseOffer, [
      { id: 't5', source: 'groupme', text: 'Breece Hall to Magicians? saw it last night' },
    ]);
    expect(matches).toEqual(['t5']);
  });

  it('excludes other trade_offer tips from the match pool', () => {
    const matches = findCorroboratingTips(baseOffer, [
      { id: 'to_other', source: 'trade_offer' },
    ]);
    expect(matches).toEqual([]);
  });

  it('excludes league-wide and commish hints from franchise matching', () => {
    const matches = findCorroboratingTips(baseOffer, [
      { id: 't6', source: 'web', topic: 'trade', franchiseHint: 'league-wide', text: 'something is brewing' },
      { id: 't7', source: 'web', topic: 'trade', franchiseHint: 'commish', text: 'the commish' },
    ]);
    expect(matches).toEqual([]);
  });

  it('returns empty when the offer has no franchise scope and no player names', () => {
    const matches = findCorroboratingTips({ source: 'trade_offer' }, [
      { id: 't8', source: 'web', topic: 'trade', franchiseHint: '0003' },
    ]);
    expect(matches).toEqual([]);
  });

  it('dedupes when one tip matches via multiple signals', () => {
    const matches = findCorroboratingTips(baseOffer, [
      // Hits BOTH franchise (offering) and player-name (Chase) — should
      // surface once.
      { id: 't9', source: 'web', topic: 'trade', franchiseHint: '0003', text: "ja'marr chase rumors" },
    ]);
    expect(matches).toEqual(['t9']);
  });

  it('returns an empty array for null/undefined trade tip', () => {
    expect(findCorroboratingTips(null, [{ id: 't', source: 'web' }])).toEqual([]);
  });

  it('returns an empty array for non-trade-offer source', () => {
    expect(findCorroboratingTips({ source: 'web' as never } as never, [{ id: 't', source: 'web' }])).toEqual([]);
  });
});

describe('scanner integration — corroboration plumbing', () => {
  it('declares findCorroboratingTips at module scope', () => {
    expect(SCANNER_SRC).toMatch(/function findCorroboratingTips\(tradeOfferTip,\s*otherTips\)/);
  });

  it('mutates trade-offer tips with corroboratingSourceCount in the main loop', () => {
    expect(SCANNER_SRC).toMatch(/tip\.corroboratingSourceCount\s*=\s*matches\.length/);
  });

  it('considers BOTH primary and secondary batches for corroboration', () => {
    expect(SCANNER_SRC).toMatch(/\[batch,\s*secondaryBatch\]\.filter\(Boolean\)/);
  });

  it('passes corroboratingSourceCount into the anonymized safe tip', () => {
    expect(SCANNER_SRC).toMatch(/safe\.corroboratingSourceCount\s*=\s*tip\.corroboratingSourceCount/);
  });

  it('only surfaces the count when > 0 (no zero-leak in the anonymizer output)', () => {
    expect(SCANNER_SRC).toMatch(/tip\.corroboratingSourceCount\s*>\s*0/);
  });
});

describe('CORROBORATION_CONTEXT directive in the LLM prompt', () => {
  it('reads max corroboration count across the anonymized batch', () => {
    expect(SCANNER_SRC).toMatch(/maxCorroboration\s*=\s*anonymized\.reduce/);
  });

  it('only fires when at least one source corroborates', () => {
    expect(SCANNER_SRC).toMatch(/maxCorroboration\s*>=\s*1/);
  });

  it('includes the user-requested direct-knowledge phrasings', () => {
    expect(SCANNER_SRC).toMatch(/multiple sources with direct knowledge/);
    expect(SCANNER_SRC).toMatch(/spoke on the condition of anonymity/);
    expect(SCANNER_SRC).toMatch(/league sources with direct knowledge/);
  });

  it('instructs the LLM to drop hedge words in the corroborated lane', () => {
    expect(SCANNER_SRC).toMatch(/Drop the hedge words/);
  });

  it('preserves anonymity rules (no name liberty, just credibility upgrade)', () => {
    expect(SCANNER_SRC).toMatch(/CREDIBILITY of the source, not LIBERTY to name names/);
  });

  it('splices the directive into both single and mailbag userMessage paths', () => {
    const occurrences = SCANNER_SRC.match(/\$\{corroborationDirective\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('singular vs plural source word is grammatically correct', () => {
    // sourceWord = matches === 1 ? 'source' : 'sources'
    expect(SCANNER_SRC).toMatch(/maxCorroboration === 1\s*\?\s*'source'\s*:\s*'sources'/);
  });
});
