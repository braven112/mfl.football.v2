import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { stampBadgeYear } from '../src/utils/afl-badge';

const ARC = `<svg><defs><path id="yearArc" d="M0 0"></path></defs><text><textPath href="#yearArc" startOffset="50%">★  2025  ★</textPath></text></svg>`;
const SHIELD = `<svg><text x="130" y="270" fill="#c9a44c">★  2025  ★</text></svg>`;

describe('stampBadgeYear', () => {
  it('stamps the year into an arc (textPath) badge', () => {
    const out = stampBadgeYear(ARC, 2016);
    expect(out).toContain('★  2016  ★');
    expect(out).not.toContain('2025');
  });

  it('stamps the year into a shield (flat text) badge', () => {
    const out = stampBadgeYear(SHIELD, 2016);
    expect(out).toContain('2016');
    expect(out).not.toContain('2025');
  });

  it('blanks the year when passed an empty string (locked placeholder)', () => {
    expect(stampBadgeYear(ARC, '')).not.toContain('2025');
    expect(stampBadgeYear(SHIELD, '')).not.toContain('2025');
  });

  it('makes the #yearArc id unique per instance', () => {
    const out = stampBadgeYear(ARC, 2016, 'afl-championship-2016');
    expect(out).toContain('id="yearArc-afl-championship-2016"');
    expect(out).toContain('href="#yearArc-afl-championship-2016"');
    expect(out).not.toMatch(/id="yearArc"/);
  });

  it('returns empty string for empty input', () => {
    expect(stampBadgeYear('', 2016)).toBe('');
  });

  it('leaves the year untouched when passed null', () => {
    // null = "don't stamp" (vs '' = "blank it"); the default art year survives.
    expect(stampBadgeYear(ARC, null)).toContain('2025');
    expect(stampBadgeYear(SHIELD, null)).toContain('2025');
  });

  // Guard against badge-art drift: if a future SVG revision changes the year
  // token, stamping would silently no-op and leave the hardcoded placeholder.
  it('actually stamps every shipped award badge', () => {
    const dir = path.resolve(__dirname, '../public/assets/afl/awards');
    const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const raw = readFileSync(path.join(dir, f), 'utf8');
      const stamped = stampBadgeYear(raw, 1999, `t-${f}`);
      expect(stamped, `${f} did not change when stamped`).not.toBe(raw);
      expect(stamped, `${f} year not stamped`).toContain('1999');
    }
  });

  // The "Grand Slam" badge has TWO curved arcs — a year arc and a label arc.
  // Stamping must hit the year arc only, leaving the GRAND SLAM label intact.
  // (A prior bug had the stamper match the literal tag name inside an SVG
  // comment, blanking the year arc's attributes; this locks the contract.)
  it('stamps the year into the grand-slam badge without eating the label', () => {
    const raw = readFileSync(
      path.resolve(__dirname, '../public/assets/afl/grand-slam.svg'),
      'utf8'
    );
    const stamped = stampBadgeYear(raw, 2025, 'grand-slam');
    // Year landed on the bottom arc…
    expect(stamped).toContain('★  2025  ★');
    // …the arc kept its href (attributes weren't clobbered)…
    expect(stamped).toContain('href="#yearArc-grand-slam"');
    // …and the label arc survived intact.
    expect(stamped).toContain('>GRAND SLAM</textPath>');
  });
});
