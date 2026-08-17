/**
 * college-logos.json data integrity guard.
 *
 * Exists because of the Aug 2026 "Malone University" bug (PR #553): the file
 * carried ESPN logo URLs that 404 permanently — Malone (556) and Manitoba
 * (2770) have no ESPN art at all, and "Louisiana"/"Louisiana-Lafayette" were
 * name-mismapped to 2347, which is Louisiana CHRISTIAN University (also no
 * art), not the Ragin' Cajuns (309). A dead light URL renders a broken-image
 * icon plus full-width alt text in every players-table college cell, and the
 * dark-mode `content: url()` swap has no error event to catch its side.
 *
 * These checks are network-free, so they cannot verify a URL actually
 * resolves — but they lock the invariants that made those defects detectable:
 *
 * 1. `logo` and `logoDark` are null together. A school ESPN has no art for is
 *    expressed as BOTH null (every consumer is null-safe and renders its
 *    designed fallback); a half-null entry is a hand-edit error.
 * 2. When present, both URLs are the canonical ESPN NCAA shape and embed
 *    exactly the entry's own `espnId` — a URL borrowed from another school is
 *    how the Louisiana mismap survived unnoticed.
 * 3. No entry references an id in KNOWN_MISSING_NCAA_DARK_IDS. That curated
 *    list records ids verified absent from ESPN's CDN; this assertion is what
 *    makes the list a live guard rather than dead documentation — a data
 *    refresh that resurrects one of those URLs fails CI here instead of
 *    shipping broken images again.
 */
import { describe, it, expect } from 'vitest';
import collegeLogos from '../src/data/college-logos.json';
import { KNOWN_MISSING_NCAA_DARK_IDS } from '../src/utils/college-logo-dark-css';

interface Entry {
  espnId?: string | null;
  logo?: string | null;
  logoDark?: string | null;
}

const entries = Object.entries(collegeLogos as Record<string, Entry>);
const LIGHT_RE = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\/500\/(\d+)\.png$/;
const DARK_RE = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/ncaa\/500-dark\/(\d+)\.png$/;

describe('college-logos.json integrity', () => {
  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(200);
  });

  it('logo and logoDark are null together (no half-null entries)', () => {
    const bad = entries.filter(([, e]) => (e.logo == null) !== (e.logoDark == null));
    expect(bad.map(([name]) => name)).toEqual([]);
  });

  it('every logo URL pair is the canonical ESPN shape embedding the entry\'s own espnId', () => {
    const bad: string[] = [];
    for (const [name, e] of entries) {
      if (!e.logo) continue;
      const light = e.logo.match(LIGHT_RE);
      const dark = (e.logoDark ?? '').match(DARK_RE);
      if (!light || light[1] !== String(e.espnId)) bad.push(`${name} (light: ${e.logo}, espnId: ${e.espnId})`);
      if (!dark || dark[1] !== String(e.espnId)) bad.push(`${name} (dark: ${e.logoDark}, espnId: ${e.espnId})`);
    }
    expect(bad).toEqual([]);
  });

  it('no entry references an id ESPN is known to have no art for', () => {
    const missing = new Set(KNOWN_MISSING_NCAA_DARK_IDS);
    // Note: a null-logo entry may keep an espnId on the missing list (Malone
    // keeps 556 — ESPN has the TEAM, just no logo art, and roster lookups use
    // the id). Only logo URLs referencing a missing id are defects.
    const bad = entries.filter(
      ([, e]) =>
        (e.logo && missing.has(e.logo.match(LIGHT_RE)?.[1] ?? '')) ||
        (e.logoDark && missing.has(e.logoDark.match(DARK_RE)?.[1] ?? '')),
    );
    expect(bad.map(([name]) => name)).toEqual([]);
  });
});
