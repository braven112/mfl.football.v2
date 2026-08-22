/**
 * Layout guards for the My Rank editor sheet.
 *
 * Reported by an owner on an Android phone (2026-08-22), on the AFL Free
 * Agents page, with nine ranking sources in the list: "I still need to be able
 * to scroll down on the screen to see all of the rankings", then "I can barely
 * close the modal now".
 *
 * Both were the same bug, and it was the height unit. The sheet capped itself
 * at `88vh`, and `vh` on a phone is the viewport with the browser chrome
 * HIDDEN — so with the URL bar and the bottom bar showing, the sheet was
 * taller than the visible area. It is pinned to the bottom
 * (`.mre { align-items: flex-end }`), so the excess went off the TOP: the
 * title and the close button were sliced off above the URL bar, and the rows
 * past the fold sat outside the visible viewport with no scroll that could
 * reach them. `dvh` is the visible viewport and tracks that chrome as it
 * moves.
 *
 * Measured before and after in Chromium at 330x610 (the reporter's visible
 * viewport): the fixed sheet is 538px with the close button at y=89 and the
 * list scrolling 520px of rows through a 408px window.
 *
 * CSS has no runtime to assert against, so this parses the stylesheet into
 * rules and resolves each property the way the cascade does within a block —
 * later declaration wins, and the `flex` shorthand resets the longhands it
 * covers. A grep would pass on a rule that was moved, overridden, or
 * re-hidden under a different selector; a naive parser would pass on a `vh`
 * cap added under a breakpoint nobody thought to look in, which is why the
 * viewport-unit rule below is checked at EVERY place the sheet is capped
 * rather than at the two that exist today.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/styles/my-rank-editor.css'), 'utf-8');

/** Strip comments so a commented-out rule can never satisfy this test. */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  /** The at-rule preludes this rule is nested inside, outermost first. */
  conditions: string[];
  selectors: string[];
  decls: Array<[string, string]>;
}

function parseDecls(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    // A nested block's leftovers can't produce a bare prop:value pair, but a
    // stray brace would — skip anything that isn't a plain identifier.
    if (!/^[-a-zA-Z]+$/.test(prop)) continue;
    out.push([prop, decl.slice(i + 1).trim()]);
  }
  return out;
}

/** Walk the stylesheet, to any nesting depth, collecting every rule. */
function parseBlock(text: string, conditions: string[], out: Rule[]): void {
  let prelude = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '{') {
      prelude += ch;
      i++;
      continue;
    }
    let depth = 1;
    let j = i + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    expect(depth, 'unbalanced braces in my-rank-editor.css').toBe(0);
    const head = prelude.trim();
    const body = text.slice(i + 1, j - 1);
    if (head.startsWith('@')) {
      // Conditional group (@media, @supports) or @keyframes — both hold rules.
      parseBlock(body, [...conditions, head], out);
    } else if (head) {
      out.push({
        conditions,
        selectors: head.split(',').map((s) => s.trim()),
        decls: parseDecls(body),
      });
    }
    prelude = '';
    i = j;
  }
}

const rules: Rule[] = [];
parseBlock(stripped, [], rules);

type Where = (conditions: string[]) => boolean;

const anywhere: Where = () => true;
const base: Where = (c) => c.length === 0;
const wide: Where = (c) => c.some((q) => /min-width:\s*640px/.test(q));

function rulesFor(selector: string, where: Where): Rule[] {
  return rules.filter((r) => r.selectors.includes(selector) && where(r.conditions));
}

/** Every declaration of `prop` for `selector`, in source order. */
function valuesOf(selector: string, prop: string, where: Where): string[] {
  return rulesFor(selector, where).flatMap((r) =>
    r.decls.filter(([p]) => p === prop).map(([, v]) => v),
  );
}

/** Last value wins, same as the cascade among rules of equal specificity. */
function valueOf(selector: string, prop: string, where: Where): string | undefined {
  const hits = valuesOf(selector, prop, where);
  return hits.length ? hits[hits.length - 1] : undefined;
}

/**
 * `flex-grow` / `flex-shrink` as the browser computes them.
 *
 * The shorthand RESETS both longhands, so source order decides:
 * `flex-shrink: 0; flex: 1 1 auto` computes shrink 1, however reassuring the
 * first line reads. Resolving that is the whole point of parsing rather than
 * grepping.
 */
function flexOf(selector: string, where: Where): { grow: number; shrink: number } {
  // Initial values for a flex item, per the flexbox spec.
  let grow = 0;
  let shrink = 1;
  for (const rule of rulesFor(selector, where)) {
    for (const [prop, raw] of rule.decls) {
      const value = raw.trim();
      if (prop === 'flex-grow') grow = Number(value);
      else if (prop === 'flex-shrink') shrink = Number(value);
      else if (prop === 'flex') {
        if (value === 'none') { grow = 0; shrink = 0; continue; }
        if (value === 'auto') { grow = 1; shrink = 1; continue; }
        if (value === 'initial') { grow = 0; shrink = 1; continue; }
        const parts = value.split(/\s+/);
        // `flex: <grow> [<shrink>] [<basis>]` — a lone number is grow, and the
        // shorthand's omitted shrink is 1, not the initial 0.
        grow = Number(parts[0]);
        shrink = parts.length > 1 && /^[\d.]+$/.test(parts[1]) ? Number(parts[1]) : 1;
      }
    }
  }
  return { grow, shrink };
}

/** A plain `vh` length — `dvh`, `svh` and `lvh` are different units. */
const PLAIN_VH = /(?<![a-z])vh\b/;
/** A `dvh` length. `\b` before `d` would not match, since `88d` is all word chars. */
const DVH = /dvh\b/;

describe('My Rank editor — the sheet fits the screen and the list scrolls', () => {
  it('parses the stylesheet it is meant to be guarding', () => {
    // A parser that silently found nothing would make every test below vacuous.
    expect(rulesFor('.mre__sheet', anywhere).length).toBeGreaterThanOrEqual(2);
    expect(rulesFor('.mre__list', anywhere).length).toBeGreaterThanOrEqual(1);
  });

  it('lays the sheet out as a capped flex column', () => {
    expect(valueOf('.mre__sheet', 'display', base)).toBe('flex');
    expect(valueOf('.mre__sheet', 'flex-direction', base)).toBe('column');
    expect(valueOf('.mre__sheet', 'max-height', base)).toBeDefined();
  });

  it('caps the sheet in dvh wherever it is capped, with a plain-vh fallback', () => {
    // THE regression. `vh` on a phone is the viewport with the browser chrome
    // HIDDEN, so a sheet capped only in vh is taller than what the owner sees
    // — and being bottom-pinned, it loses its top edge, not its bottom.
    //
    // Checked per RULE, across every breakpoint that exists rather than the
    // two written today: a `max-height: 92vh` added under some future
    // `min-width: 1024px` would reintroduce exactly this bug, and a guard that
    // only knew about `base` and 640px would stay green through it.
    const capping = rulesFor('.mre__sheet', anywhere).filter((r) =>
      r.decls.some(([p]) => p === 'max-height' || p === 'height'),
    );
    expect(capping.length, 'no height cap found for .mre__sheet').toBeGreaterThanOrEqual(2);

    for (const rule of capping) {
      const where = rule.conditions.length ? rule.conditions.join(' ') : 'base';
      const heights = rule.decls
        .filter(([p]) => p === 'max-height' || p === 'height')
        .map(([, v]) => v);

      expect(heights[heights.length - 1], `${where}: the winning cap must be dvh`)
        .toMatch(DVH);
      // The fallback has to be plain `vh`. `svh` would parse in the same
      // browsers as `dvh` and in no others, so a `88svh; 88dvh` pair leaves
      // an older browser with BOTH declarations dropped and no cap at all —
      // uncapped, which is worse than the bug being fixed.
      expect(
        heights.slice(0, -1).some((v) => PLAIN_VH.test(v)),
        `${where}: expected a plain-vh fallback before the dvh cap, got ${JSON.stringify(heights)}`,
      ).toBe(true);
    }
  });

  it('gives the list room to shrink so overflow-y actually scrolls', () => {
    // Not the original regression — a scroll container's automatic minimum
    // size is already 0, so this list did scroll. It is stated anyway because
    // it stops being true the day someone drops the `overflow-y`, and the
    // sheet's whole job is to keep the header and footer reachable.
    expect(valueOf('.mre__list', 'min-height', base)).toBe('0');
    expect(valueOf('.mre__list', 'overflow-y', base)).toBe('auto');
    expect(flexOf('.mre__list', base).grow, '.mre__list must take the leftover height')
      .toBeGreaterThan(0);
  });

  it('keeps the empty state inside the sheet too', () => {
    // Same treatment: with no imports the sheet renders `.mre__empty` in the
    // list's place, and it is the flex child that has to absorb the space.
    expect(valueOf('.mre__empty', 'min-height', base)).toBe('0');
    expect(flexOf('.mre__empty', base).grow).toBeGreaterThan(0);
  });

  it('never lets the header or footer be squeezed out', () => {
    // The header holds the close button and the footer holds Done — if either
    // shrinks away, the owner is stuck in the modal, which is the half of the
    // report that mattered most.
    for (const selector of ['.mre__header', '.mre__footer']) {
      expect(flexOf(selector, base).shrink, `${selector} must hold its height`).toBe(0);
    }
  });

  it('keeps the sheet pinned to the bottom on a phone', () => {
    // Not cosmetic: it is why overflow spilled off the TOP rather than the
    // bottom, which is what put the close button out of reach.
    expect(valueOf('.mre', 'align-items', base)).toBe('flex-end');
    expect(valueOf('.mre', 'align-items', wide)).toBe('center');
  });

  it('does not chain the list scroll to the page behind it', () => {
    expect(valueOf('.mre__list', 'overscroll-behavior', base)).toBe('contain');
  });
});
