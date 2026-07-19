/**
 * Schefter topic registry — per-league taxonomy invariants.
 *
 * src/config/schefter-topics.mjs is the single source of truth for tip
 * topics (labels, placeholders, per-league availability, naming policies).
 * These tests lock the invariants the API, tip form, and scanner rely on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TIP_TOPIC_META,
  ALL_TOPIC_IDS,
  DRAINABLE_TOPIC_IDS,
  LEGACY_TOPIC_ALIASES,
  getTipTopics,
  getTopicIds,
  normalizeTopicId,
  getTopicPolicy,
} from '../src/config/schefter-topics.mjs';
import { TIP_TOPICS } from '../src/types/schefter-tips';

describe('topic registry shape', () => {
  it('every topic has an id, label, and placeholder', () => {
    for (const t of TIP_TOPIC_META) {
      expect(t.id, JSON.stringify(t)).toBeTruthy();
      expect(t.label, t.id).toBeTruthy();
      expect(t.placeholder, t.id).toBeTruthy();
    }
  });

  it('ids are unique and legacy aliases never collide with modern ids', () => {
    expect(new Set(ALL_TOPIC_IDS).size).toBe(ALL_TOPIC_IDS.length);
    for (const [legacy, modern] of Object.entries(LEGACY_TOPIC_ALIASES)) {
      expect(ALL_TOPIC_IDS).not.toContain(legacy);
      expect(ALL_TOPIC_IDS).toContain(modern);
    }
  });

  it('the TS TipTopic union stays in sync with ALL_TOPIC_IDS', () => {
    expect([...TIP_TOPICS].sort()).toEqual([...ALL_TOPIC_IDS].sort());
  });
});

describe('per-league topic lists', () => {
  it('TheLeague gets the full modern set including contract-year motives', () => {
    expect(getTopicIds('theleague')).toEqual([
      'trade',
      'roster',
      'hotseat',
      'frontoffice',
      'tampering',
      'intentions',
      'motive',
      'prediction',
      'other',
    ]);
  });

  it('AFL drops motive (no contracts) but keeps everything else', () => {
    const ids = getTopicIds('afl');
    expect(ids).not.toContain('motive');
    expect(ids).toEqual([
      'trade',
      'roster',
      'hotseat',
      'frontoffice',
      'tampering',
      'intentions',
      'prediction',
      'other',
    ]);
  });

  it('AFL relabels hotseat and intentions for keeper/relegation framing', () => {
    const afl = Object.fromEntries(getTipTopics('afl').map((t) => [t.id, t]));
    expect(afl.hotseat.label).toBe('Relegation watch');
    expect(afl.intentions.label).toBe('Keeper intentions');
    const tl = Object.fromEntries(getTipTopics('theleague').map((t) => [t.id, t]));
    expect(tl.hotseat.label).toBe('Hot seat');
    expect(tl.intentions.label).toBe('Draft intentions');
  });
});

describe('legacy commish → frontoffice migration', () => {
  it('normalizes commish submissions to frontoffice for both leagues', () => {
    expect(normalizeTopicId('commish', 'theleague')).toBe('frontoffice');
    expect(normalizeTopicId('commish', 'afl')).toBe('frontoffice');
  });

  it('rejects invalid or cross-league topics', () => {
    expect(normalizeTopicId('nonsense', 'theleague')).toBeNull();
    expect(normalizeTopicId('motive', 'afl')).toBeNull();
    expect(normalizeTopicId('motive', 'theleague')).toBe('motive');
  });

  it('DRAINABLE ids cover the legacy queue contents', () => {
    expect(DRAINABLE_TOPIC_IDS).toContain('commish');
    for (const id of ALL_TOPIC_IDS) expect(DRAINABLE_TOPIC_IDS).toContain(id);
  });
});

describe('naming policies and anonymity guardrails', () => {
  it('tampering is explicit-pick-only with a mandatory hedge', () => {
    for (const nav of ['theleague', 'afl']) {
      const p = getTopicPolicy('tampering', nav);
      expect(p.namingPolicy).toBe('explicit-pick-only');
      expect(p.mandatoryHedge).toBe(true);
      expect(p.commishTargetAllowed).toBe(false);
    }
  });

  it('hotseat never names and floors scope per league', () => {
    const tl = getTopicPolicy('hotseat', 'theleague');
    expect(tl.namingPolicy).toBe('never');
    expect(tl.scopeFloor).toBe('league-wide');
    const afl = getTopicPolicy('hotseat', 'afl');
    expect(afl.namingPolicy).toBe('never');
    expect(afl.scopeFloor).toBe('tier');
    expect(afl.perTeamCooldownDays).toBe(14);
  });

  it('trade still disallows the commish target; frontoffice allows it', () => {
    expect(getTopicPolicy('trade', 'theleague').commishTargetAllowed).toBe(false);
    expect(getTopicPolicy('frontoffice', 'theleague').commishTargetAllowed).toBe(true);
  });

  it('legacy commish resolves to frontoffice policy', () => {
    expect(getTopicPolicy('commish', 'theleague').id).toBe('frontoffice');
  });
});

describe('scanner prompt coverage (source guard)', () => {
  const scannerSrc = readFileSync(
    join(__dirname, '..', 'scripts', 'schefter-rumor-scan.mjs'),
    'utf8',
  );

  it('TOPIC_NOUNS covers every drainable topic id', () => {
    const block = scannerSrc.match(/const TOPIC_NOUNS = \{[\s\S]*?\};/)?.[0] ?? '';
    for (const id of DRAINABLE_TOPIC_IDS) {
      expect(block, `TOPIC_NOUNS missing "${id}"`).toMatch(
        new RegExp(`\\b${id}:`),
      );
    }
  });

  it('the scanner asserts prompt coverage at startup', () => {
    expect(scannerSrc).toMatch(/for \(const topicId of DRAINABLE_TOPIC_IDS\)/);
  });

  it('the new HARD RULES ship with the new topics', () => {
    expect(scannerSrc).toMatch(/26\. TAMPERING/);
    expect(scannerSrc).toMatch(/27\. HOT SEAT \/ RELEGATION WATCH/);
    expect(scannerSrc).toMatch(/28\. FRONT-OFFICE DYSFUNCTION/);
    expect(scannerSrc).toMatch(/29\. RIVAL-GM SOURCING FLAVOR/);
  });
});
