import { describe, expect, it } from 'vitest';
import { IR_VIOLATION_MESSAGE, parseMflImportError } from '../src/utils/mfl-import-error';

const opts = { mflHost: 'www44.myfantasyleague.com', year: 2026 };

describe('parseMflImportError', () => {
  it('turns an IR violation into a plain sentence and MFL’s own fix link', () => {
    // Verbatim from production, 2026-10-13: the lineup import's <error> text.
    const raw = 'You may not set your lineup at this time because You have an &lt;a href="options?L=19621&amp;O=07&amp;F=0001"&gt;IR Violation&lt;/a&gt;.';
    const parsed = parseMflImportError(raw, opts);
    expect(parsed.reason).toBe('ir-violation');
    expect(parsed.message).toBe(IR_VIOLATION_MESSAGE);
    expect(parsed.message).not.toMatch(/[<>]|&lt;|&amp;/);
    expect(parsed.fixUrl).toBe('https://www44.myfantasyleague.com/2026/options?L=19621&O=07&F=0001');
  });

  it('strips markup from any other error and keeps its words', () => {
    const parsed = parseMflImportError('Player &lt;b&gt;13592&lt;/b&gt; is   locked', opts);
    expect(parsed).toEqual({ message: 'Player 13592 is locked', fixUrl: undefined });
  });

  it('never links off the league’s own MFL host', () => {
    for (const href of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', 'http://www44.myfantasyleague.com/2026/x']) {
      const raw = `Blocked &lt;a href="${href}"&gt;here&lt;/a&gt;`;
      expect(parseMflImportError(raw, opts).fixUrl, href).toBeUndefined();
    }
  });

  it('falls back to a generic message for an empty error', () => {
    expect(parseMflImportError('', opts).message).toBe('Unknown MFL error');
  });
});
