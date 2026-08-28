/**
 * League config JSON must not declare the same key twice in one object.
 *
 * `JSON.parse` accepts a duplicate silently and keeps the LAST one, so nothing
 * in the build — not the type baseline, not any guard test, not the app at
 * runtime — can see the problem. AFL franchise `0007` carried `groupMe` twice
 * for months (identical values, so it never misbehaved). Two ways that bites:
 *
 *  - **A programmatic rewrite deletes one.** Any `JSON.parse` → `stringify`
 *    round-trip over these files drops the discarded copy without a word. That
 *    is why `broadcastGradient` was inserted as anchored TEXT rather than by
 *    re-serializing (see the draft-broadcast insights journal).
 *  - **The day the two values differ, behaviour depends on key order** — which
 *    is the least visible thing in a 1500-line config to review a diff against.
 *
 * The keys are checked against the raw TEXT, because by the time you have a
 * parsed object the evidence is already gone.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CONFIGS = [
  'data/afl-fantasy/afl.config.json',
  'src/data/theleague.config.json',
  'data/best-ball-1/bb1.config.json',
];

interface Duplicate {
  key: string;
  line: number;
  firstLine: number;
}

/**
 * Scan raw JSON text for keys repeated within the same object.
 *
 * A real scanner rather than a regex: a regex over lines cannot tell a KEY from
 * a string VALUE that happens to contain a colon, and cannot tell which object
 * a key belongs to. This walks the text tracking string literals (escapes
 * included) and a stack of object scopes, and treats a string as a key only
 * when the next non-whitespace character is `:`.
 */
function findDuplicateKeys(text: string): Duplicate[] {
  const duplicates: Duplicate[] = [];
  // One Map per open object: key → line where it was first seen.
  const stack: Map<string, number>[] = [];
  let line = 1;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    if (ch === '{') {
      stack.push(new Map());
      i += 1;
      continue;
    }

    if (ch === '}') {
      stack.pop();
      i += 1;
      continue;
    }

    if (ch === '"') {
      // Read the string literal, honouring backslash escapes.
      const startLine = line;
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          value += text[j] + (text[j + 1] ?? '');
          j += 2;
          continue;
        }
        if (text[j] === '\n') line += 1;
        value += text[j];
        j += 1;
      }
      j += 1; // past the closing quote

      // A key is a string whose next non-whitespace character is a colon.
      // This is pure LOOKAHEAD — `i` rewinds to `j` below, so the main loop
      // re-walks this whitespace. Counting newlines here too would count them
      // twice and inflate every reported line number (it did: the real
      // franchise-0007 duplicate at line 429 was reported as 453).
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      const isKey = text[k] === ':';

      if (isKey && stack.length > 0) {
        const scope = stack[stack.length - 1];
        const first = scope.get(value);
        if (first !== undefined) {
          duplicates.push({ key: value, line: startLine, firstLine: first });
        } else {
          scope.set(value, startLine);
        }
      }

      i = j;
      continue;
    }

    i += 1;
  }

  return duplicates;
}

describe('league config JSON has no duplicate keys', () => {
  for (const file of CONFIGS) {
    it(`${file} declares every key at most once per object`, () => {
      const found = findDuplicateKeys(readFileSync(file, 'utf-8')).map(
        (d) => `"${d.key}" repeated at line ${d.line} (first seen line ${d.firstLine})`
      );
      expect(
        found,
        `${file} declares a key twice in one object. JSON.parse keeps the LAST ` +
          `one silently, so this is invisible at runtime — and a parse/stringify ` +
          `round-trip over this file would delete the other copy without warning. ` +
          `Remove the redundant line.`
      ).toEqual([]);
    });
  }
});

describe('findDuplicateKeys', () => {
  // The scanner is the whole guard, so it is worth proving it can actually
  // fail — a detector that always returns [] passes the suite above forever.
  it('catches a key repeated in the same object', () => {
    const dup = findDuplicateKeys('{\n  "a": 1,\n  "b": 2,\n  "a": 3\n}');
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ key: 'a', line: 4, firstLine: 2 });
  });

  it('reproduces the franchise 0007 shape it was written for', () => {
    const dup = findDuplicateKeys(
      '{\n  "teams": [\n    {\n      "groupMe": "x",\n      "history": [],\n      "groupMe": "x"\n    }\n  ]\n}'
    );
    expect(dup.map((d) => d.key)).toEqual(['groupMe']);
  });

  it('does NOT flag the same key in sibling objects', () => {
    // Every franchise has a `franchiseId`; that is the normal case, not a bug.
    expect(findDuplicateKeys('[{"id": 1}, {"id": 2}]')).toEqual([]);
  });

  it('does NOT flag the same key at different nesting depths', () => {
    // A franchise and its `history` entries both carry `name` and `icon`.
    expect(findDuplicateKeys('{"name": "a", "history": [{"name": "b"}]}')).toEqual([]);
  });

  it('does not mistake a string VALUE for a key', () => {
    // A value containing a colon, and a value equal to a key name, are both fine.
    expect(findDuplicateKeys('{"a": "b: c", "d": "a"}')).toEqual([]);
  });

  it('handles escaped quotes inside strings', () => {
    expect(findDuplicateKeys('{"a": "he said \\"hi\\"", "b": 1}')).toEqual([]);
  });
});
