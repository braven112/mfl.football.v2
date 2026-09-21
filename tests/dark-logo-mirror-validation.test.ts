import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidSvg, isValidAsset } from '../scripts/lib/dark-logo-mirror.mjs';

/**
 * The mirror's fetched-bytes validation.
 *
 * `isValidSvg` exists for one job: reject a CDN error page saved under a `.svg`
 * name. It cannot use the PNG path's magic-byte check (SVG has none) or its
 * 1 KB floor (a real dark cut is an order of magnitude smaller), so it reads
 * the head of the buffer — and that is what made its first form dangerous.
 *
 * It matched an optional prolog and any comments with `[\s\S]*?` nested inside
 * a `(...)*` group, which backtracks EXPONENTIALLY on input shaped `<!--`
 * followed by many `--><!--` that never reaches a `<svg`. Those bytes come off
 * a CDN, so the input is reachable rather than theoretical, and the 512-byte
 * slice does not save it: at 22 repetitions the old pattern took 168 ms, at 18
 * it took 11 ms — doubling every two — and roughly 70 repetitions fit inside
 * the slice. That is a hung prebuild, not a slow one. CodeQL flagged it on
 * PR #1180 and it was confirmed by measurement before being replaced.
 *
 * The replacement scans for the root tag and then checks that nothing before
 * it opens an element. Both halves are linear.
 */

/** Pad past the 200-byte floor so these cases test the SHAPE, not the length. */
const svgBytes = (body: string) => Buffer.from(body + ' '.repeat(Math.max(0, 260 - body.length)));

describe('isValidSvg — accepts real cuts', () => {
  it.each([
    ['a bare svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>'],
    ['an xml prolog', '<?xml version="1.0" encoding="UTF-8"?><svg viewBox="0 0 1 1"><path/></svg>'],
    ['a leading comment', '<!-- Generator: whatever --><svg viewBox="0 0 1 1"><path/></svg>'],
    ['several comments', '<!--a--><!--b--><!--c--><svg viewBox="0 0 1 1"><path/></svg>'],
    ['a doctype', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg viewBox="0 0 1 1"><path/></svg>'],
    ['leading whitespace', '\n\n  <svg viewBox="0 0 1 1"><path/></svg>'],
  ])('accepts %s', (_label, body) => {
    expect(isValidSvg(svgBytes(body))).toBe(true);
  });
});

describe('isValidSvg — rejects what it exists to reject', () => {
  it.each([
    ['an HTML error page', '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body>nope</body></html>'],
    ['a JSON error body', '{"error":"not found","status":404,"detail":"no such asset on this CDN at all"}'],
    ['an svg buried inside HTML', '<html><body><div><svg viewBox="0 0 1 1"/></div></body></html>'],
    ['plain text', 'Not Found. The asset you requested is not available from this origin.'],
  ])('rejects %s', (_label, body) => {
    expect(isValidSvg(svgBytes(body))).toBe(false);
  });

  it('rejects anything under the 200-byte floor, however well-formed', () => {
    expect(isValidSvg(Buffer.from('<svg viewBox="0 0 1 1"><path/></svg>'))).toBe(false);
  });

  it('rejects a non-buffer', () => {
    expect(isValidSvg('<svg></svg>' as unknown as Buffer)).toBe(false);
  });
});

describe('isValidSvg — stays linear on the backtracking shape', () => {
  it('answers immediately on comment-prefixed input with no root tag', () => {
    // The exact shape CodeQL named. The old pattern never returns on this.
    const evil = Buffer.from(`<!--${'--><!--'.repeat(70)}${'x'.repeat(200)}`);
    const started = Date.now();
    expect(isValidSvg(evil)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('is flat across repetition counts, rather than doubling', () => {
    const timeAt = (reps: number) => {
      const buf = Buffer.from(`<!--${'--><!--'.repeat(reps)}${'x'.repeat(200)}`);
      const started = Date.now();
      isValidSvg(buf);
      return Date.now() - started;
    };
    // Exponential backtracking showed as a 15x jump from 18 to 22 reps. Linear
    // scanning shows as no measurable difference at any count.
    expect(timeAt(10)).toBeLessThan(50);
    expect(timeAt(70)).toBeLessThan(50);
  });

  it('has no nested quantifier left in the source', () => {
    // The shape, not just the symptom: a `*`-repeated group containing its own
    // lazy any-character run is the thing that backtracks.
    const src = readFileSync(join(process.cwd(), 'scripts/lib/dark-logo-mirror.mjs'), 'utf-8');
    expect(src).not.toMatch(/\(\[\\s\\S\]\*\?[^)]*\)\*/);
    expect(src).not.toMatch(/\(<!--\[\\s\\S\]\*\?-->[^)]*\)\*/);
  });
});

describe('isValidAsset routes by declared format', () => {
  it('sends svg to the svg check and everything else to the png one', () => {
    const svg = svgBytes('<svg viewBox="0 0 1 1"><path/></svg>');
    expect(isValidAsset(svg, 'svg')).toBe(true);
    // The same bytes are not a valid PNG — no magic, under the 1 KB floor.
    expect(isValidAsset(svg, 'png')).toBe(false);
  });
});
