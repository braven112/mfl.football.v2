/**
 * Tests for hostile-tip reframe-mode telemetry in scripts/lib/schefter-lore.mjs.
 *
 * Pins:
 *  - detectReframeMode() recognizes each frame's signature phrasing.
 *  - Priority: style-book > intra-division > reverse-lens > rivalry >
 *    league-office (most-specific-wins). Posts that mix multiple frames
 *    get tagged with the highest-priority match.
 *  - tagPost() includes reframeMode in the returned object.
 *  - buildHistoryEntry() persists reframeMode into the post-history record.
 *  - Empty / non-string body returns ''.
 *  - Routine reportage with no hostile frame returns ''.
 *  - The schema doc in data/schefter/post-history.json mentions reframeMode.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  tagPost,
  detectReframeMode,
  buildHistoryEntry,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/lib/schefter-lore.mjs';

// ── detectReframeMode — per-mode happy paths ────────────────────────────────

describe('detectReframeMode — per-mode signatures', () => {
  it('detects league-office', () => {
    expect(
      detectReframeMode(
        "The league office is catching flak this week. Not everyone's thrilled. Developing.",
      ),
    ).toBe('league-office');
    expect(detectReframeMode("The front office has heat right now. We'll see.")).toBe(
      'league-office',
    );
    expect(detectReframeMode("The commissioner's office is drawing some static.")).toBe(
      'league-office',
    );
  });

  it('detects rivalry', () => {
    expect(detectReframeMode('Bad blood between Pigskins and Dangsters is back.')).toBe('rivalry');
    expect(detectReframeMode("The Vit-DCW feud heats up again. Developing.")).toBe('rivalry');
    expect(detectReframeMode("Long memories on the East division desks.")).toBe('rivalry');
  });

  it('detects reverse-lens', () => {
    expect(
      detectReframeMode(
        "Hearing an owner in the Northwest isn't happy with the auction process.",
      ),
    ).toBe('reverse-lens');
    expect(
      detectReframeMode("An owner in the Southwest has opinions about roster standards."),
    ).toBe('reverse-lens');
    expect(
      detectReframeMode("Somebody in the Central is fed up with the league office. Developing."),
    ).toBe('reverse-lens');
  });

  it('detects intra-division', () => {
    expect(
      detectReframeMode(
        "The Southwest is really developing some strong rivalries this spring.",
      ),
    ).toBe('intra-division');
    expect(detectReframeMode("Beef brewing inside the East division. Developing.")).toBe(
      'intra-division',
    );
    expect(detectReframeMode("Rivalries heating up in the Central.")).toBe('intra-division');
    expect(detectReframeMode("The Northwest is the most personal division right now.")).toBe(
      'intra-division',
    );
  });

  it('detects style-book', () => {
    expect(
      detectReframeMode("Noted, Dead Cap. Adding that to the file. Developing."),
    ).toBe('style-book');
    expect(
      detectReframeMode("Third shot from Wabbit this season. The dossier grows."),
    ).toBe('style-book');
    expect(
      detectReframeMode("Wabbit is officially a power user of the style book."),
    ).toBe('style-book');
  });
});

// ── Priority resolution: most-specific-wins ─────────────────────────────────

describe('detectReframeMode — priority order', () => {
  it('style-book beats league-office when both phrases appear', () => {
    const body =
      "Noted, Dead Cap. Adding that to the style book. The league office will live. Developing.";
    expect(detectReframeMode(body)).toBe('style-book');
  });

  it('intra-division beats reverse-lens when both phrases appear', () => {
    // Both phrases present — intra-division is more specific so it wins.
    const body =
      "The Southwest is really developing some strong rivalries. An owner in the Southwest is fed up too.";
    expect(detectReframeMode(body)).toBe('intra-division');
  });

  it('reverse-lens beats rivalry when both phrases appear', () => {
    const body =
      "Hearing an owner in the East isn't happy with how things are going. Bad blood between two desks. More to come.";
    expect(detectReframeMode(body)).toBe('reverse-lens');
  });

  it('rivalry beats league-office when both phrases appear', () => {
    const body =
      "Bad blood between Vit and Pigskins. The league office is staying out of it. Developing.";
    expect(detectReframeMode(body)).toBe('rivalry');
  });
});

// ── Negative paths ──────────────────────────────────────────────────────────

describe('detectReframeMode — negative paths', () => {
  it('returns empty string for routine non-hostile reportage', () => {
    expect(
      detectReframeMode(
        "I'm told the Magicians are dangling a 2027 first for WR help. Still just smoke. Developing.",
      ),
    ).toBe('');
  });

  it('returns empty string for trade-offer voice without hostility', () => {
    expect(
      detectReframeMode(
        "Quietly, somebody's working the phones. Nothing imminent. One to watch.",
      ),
    ).toBe('');
  });

  it('returns empty string for null / non-string / empty body', () => {
    expect(detectReframeMode('')).toBe('');
    expect(detectReframeMode(null as unknown as string)).toBe('');
    expect(detectReframeMode(undefined as unknown as string)).toBe('');
    expect(detectReframeMode(42 as unknown as string)).toBe('');
  });

  it('does not false-positive on the literal word "office" without "league/front"', () => {
    // "The office crew" is a distinct lore bit (Dead Cap / Vit / Midwest).
    // It should NOT trip the league-office reframe — that bit is unrelated.
    // Our patterns require "league office" / "front office" / "commissioner's
    // office" specifically, so this should pass.
    expect(detectReframeMode("Office crew at it again. Monday meetings will be tense.")).toBe('');
  });
});

// ── Integration with tagPost / buildHistoryEntry ────────────────────────────

describe('tagPost — reframeMode is included in the returned tags', () => {
  it('returns reframeMode in the tags object', () => {
    const tags = tagPost("The league office is catching flak this week. Developing.");
    expect(tags.reframeMode).toBe('league-office');
    expect(tags).toHaveProperty('openerUsed');
    expect(tags).toHaveProperty('closerUsed');
    expect(tags).toHaveProperty('hadBotWink');
    expect(tags).toHaveProperty('hadLoreCallback');
  });

  it('returns empty reframeMode for non-string body (default branch)', () => {
    const tags = tagPost(null);
    expect(tags.reframeMode).toBe('');
  });

  it('returns empty reframeMode for routine reportage', () => {
    const tags = tagPost(
      "I'm told the Magicians are dangling a 2027 first. Still just smoke. Developing.",
    );
    expect(tags.reframeMode).toBe('');
  });
});

describe('buildHistoryEntry — reframeMode is persisted', () => {
  it('writes reframeMode into the history entry', () => {
    const entry = buildHistoryEntry({
      id: 'sf_test_1',
      timestamp: '2026-04-19T15:00:00Z',
      body: "Noted, Dead Cap. Adding that to the style book. Developing.",
      subject: 'groupme (Dead Cap)',
      tipSources: ['groupme'],
    });
    expect(entry.reframeMode).toBe('style-book');
  });

  it('writes empty reframeMode for routine entries', () => {
    const entry = buildHistoryEntry({
      id: 'sf_test_2',
      body: 'Quietly, somebody is working the phones. Developing.',
      subject: 'trade-offer',
      tipSources: ['trade_offer'],
    });
    expect(entry.reframeMode).toBe('');
  });
});

// ── Schema doc ──────────────────────────────────────────────────────────────

describe('post-history.json schema doc mentions reframeMode', () => {
  const raw = readFileSync(
    path.join(process.cwd(), 'data/schefter/post-history.json'),
    'utf8',
  );

  it('references reframeMode in the _schema entry block', () => {
    const parsed = JSON.parse(raw);
    expect(parsed._schema?.entry?.reframeMode).toBeDefined();
    expect(String(parsed._schema.entry.reframeMode)).toMatch(/style-book|intra-division|reverse-lens|rivalry|league-office/);
  });
});
