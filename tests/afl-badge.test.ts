import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { stampBadgeYear, stripBadgeYear, namespaceBadgeIds } from '../src/utils/afl-badge';

const ARC = `<svg><defs><path id="yearArc" d="M0 0"></path></defs><text><textPath href="#yearArc" startOffset="50%">★  2025  ★</textPath></text></svg>`;
const SHIELD = `<svg><text x="130" y="270" fill="#c9a44c">★  2025  ★</text></svg>`;
const SHIELD_WITH_CLIP = `<svg><defs><clipPath id="sh"><path d="M0 0"></path></clipPath><linearGradient id="g_north"><stop/></linearGradient></defs><g clip-path="url(#sh)"><rect fill="url(#g_north)"></rect></g></svg>`;
const MULTI_ARC = `<svg><defs><path id="yearArc" d="M0 0"></path><path id="labelArc" d="M0 0"></path></defs><text><textPath href="#yearArc" startOffset="50%">★  2025  ★</textPath><textPath href="#labelArc">LABEL</textPath></text></svg>`;

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

  // Multi-arc badges have two <textPath> elements. The stamper must hit only
  // the first one (year arc) without affecting the second one (label arc).
  // Year arc MUST be first in document order for this to work correctly.
  it('stamps only the first <textPath> in multi-arc badges', () => {
    const stamped = stampBadgeYear(MULTI_ARC, 1999, 'multi-test');
    // Year arc (first) was stamped
    expect(stamped).toContain('★  1999  ★');
    expect(stamped).toContain('href="#yearArc-multi-test"');
    // Label arc (second) survived untouched
    expect(stamped).toContain('href="#labelArc"');
    expect(stamped).toContain('>LABEL</textPath>');
    // Old year is gone
    expect(stamped).not.toContain('2025');
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
});

describe('stripBadgeYear', () => {
  it('removes the ★ frame and year from an arc (textPath) badge', () => {
    const out = stripBadgeYear(ARC);
    expect(out).not.toContain('★');
    expect(out).not.toContain('2025');
    expect(out).not.toContain('<textPath');
  });

  // The <path id="yearArc"> definition only exists to feed the textPath —
  // once that's stripped, the path is dead weight AND a duplicate-id risk
  // when the same badge is inlined many times on one page (e.g. one per
  // franchise on the AFL franchises index). Must go too, not just the
  // reference to it.
  it('removes the now-unreferenced yearArc path definition', () => {
    const out = stripBadgeYear(ARC);
    expect(out).not.toContain('yearArc');
    expect(out).not.toContain('<path');
  });

  it('removes the ★ frame and year from a shield (flat text) badge', () => {
    const out = stripBadgeYear(SHIELD);
    expect(out).not.toContain('★');
    expect(out).not.toContain('2025');
  });

  it('leaves everything else in the badge untouched', () => {
    const withExtra = `<svg><circle r="1"></circle>${ARC.replace('<svg>', '').replace('</svg>', '')}</svg>`;
    expect(stripBadgeYear(withExtra)).toContain('<circle r="1">');
  });

  it('returns empty string for empty input', () => {
    expect(stripBadgeYear('')).toBe('');
  });

  // Guard against badge-art drift: every shipped award badge must actually
  // lose its ★ year-stamp when stripped for a "timeless" (aggregate-count)
  // display context, and must not leave a dangling yearArc id behind (a
  // duplicate-id risk once the same file is inlined many times on one page).
  it('actually strips the year from every shipped award badge', () => {
    const dir = path.resolve(__dirname, '../public/assets/afl/awards');
    const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const raw = readFileSync(path.join(dir, f), 'utf8');
      const stripped = stripBadgeYear(raw);
      expect(stripped, `${f} did not change when stripped`).not.toBe(raw);
      expect(stripped, `${f} still contains a ★`).not.toContain('★');
      expect(stripped, `${f} left a dangling yearArc id behind`).not.toContain('yearArc');
    }
  });
});

describe('namespaceBadgeIds', () => {
  it('suffixes every id and its href/url references with the given uid', () => {
    const out = namespaceBadgeIds(SHIELD_WITH_CLIP, '0001-division');
    expect(out).toContain('id="sh-0001-division"');
    expect(out).toContain('id="g_north-0001-division"');
    expect(out).toContain('url(#sh-0001-division)');
    expect(out).toContain('url(#g_north-0001-division)');
    expect(out).not.toContain('id="sh"');
    expect(out).not.toContain('url(#sh)');
  });

  it('produces non-colliding output for two instances of the same badge', () => {
    const a = namespaceBadgeIds(SHIELD_WITH_CLIP, '0001-division');
    const b = namespaceBadgeIds(SHIELD_WITH_CLIP, '0002-division');
    expect(a).not.toBe(b);
    // No id from one instance appears verbatim in the other.
    const idsOf = (svg: string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const [aIds, bIds] = [idsOf(a), idsOf(b)];
    expect(aIds.some((id) => bIds.includes(id))).toBe(false);
  });

  it('is a no-op without a uid', () => {
    expect(namespaceBadgeIds(SHIELD_WITH_CLIP, '')).toBe(SHIELD_WITH_CLIP);
  });

  it('returns empty string for empty input', () => {
    expect(namespaceBadgeIds('', 'x')).toBe('');
  });

  it('leaves an svg with no ids untouched', () => {
    const plain = '<svg><circle r="1"></circle></svg>';
    expect(namespaceBadgeIds(plain, 'x')).toBe(plain);
  });

  // Regex-special characters in an id (unlikely in hand-authored badge art,
  // but the id set is built from the SVG itself, not a fixed list) must not
  // break the per-id RegExp construction.
  it('handles ids containing regex-special characters safely', () => {
    const tricky = `<svg><defs><path id="a.b(c)"></path></defs><use href="#a.b(c)"></use></svg>`;
    const out = namespaceBadgeIds(tricky, 'x');
    expect(out).toContain('id="a.b(c)-x"');
    expect(out).toContain('href="#a.b(c)-x"');
  });

  // Guard against badge-art drift: namespacing every shipped badge with two
  // different uids must never collide, the same drift guard shape as the
  // stamp/strip tests above.
  it('produces non-colliding ids for every shipped award badge', () => {
    const dir = path.resolve(__dirname, '../public/assets/afl/awards');
    const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
    expect(files.length).toBeGreaterThan(0);
    const idsOf = (svg: string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    for (const f of files) {
      const raw = readFileSync(path.join(dir, f), 'utf8');
      if (!idsOf(raw).length) continue;
      const a = namespaceBadgeIds(raw, '0001-x');
      const b = namespaceBadgeIds(raw, '0002-x');
      const [aIds, bIds] = [idsOf(a), idsOf(b)];
      expect(aIds.some((id) => bIds.includes(id)), `${f} produced colliding ids`).toBe(false);
    }
  });
});
