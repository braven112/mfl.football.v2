/**
 * Source-text helpers for guards that measure WHERE something appears in a
 * bundled `<script>`, not just whether it appears.
 *
 * Why this exists: `tests/lineup-page-clientrouter.test.ts` asserts that a
 * bail-out gate sits AFTER the teardown and BEFORE the first element read, and
 * it does that with `indexOf` offsets into the raw file text. Raw text counts
 * comments, so an explanatory comment that happens to quote
 * `getElementById('lineup-submit')` shifts the offsets and fails a file that is
 * perfectly correct. That bit twice while writing the Sept 2026 lineup hotfix,
 * and the workaround both times was to reword the comment — i.e. the guard was
 * constraining prose. It also meant a COMMENTED-OUT call could satisfy a
 * positional assertion, which is the same bug pointing the other way.
 *
 * `stripComments` blanks comments so neither can happen.
 */

/**
 * Blank every line and block comment in `src`, replacing each
 * comment character with a space and preserving newlines, so the result is the
 * same LENGTH as the input and every offset still lines up with the original
 * file. Callers can therefore mix `stripComments(s).indexOf(x)` with positions
 * taken from `s` itself.
 *
 * String and template literals are tracked, so a `'https://…'` URL or a
 * backticked path is never mistaken for a comment.
 *
 * Known limitation: regular-expression literals are not tracked. That is safe
 * for this repo's purposes because neither `//` nor `/*` can BEGIN a valid
 * regex, and an inner slash inside one is written `\/` — which never produces
 * two adjacent unescaped slashes. A regex with an unescaped `//` inside a
 * character class would confuse it; there is none, and a new one would show up
 * as a guard failure rather than a silent pass.
 */
export function stripComments(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    // String / template literal — skip to its close, honouring backslash escapes.
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === c) { i++; break; }
        i++;
      }
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      blank(i, end);
      i = end;
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }

    i++;
  }

  return out.join('');
}
