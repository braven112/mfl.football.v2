/**
 * Turn MFL's `<error>` text from an `import` call into something an owner can
 * read and act on.
 *
 * MFL's import errors are HTML fragments, entity-escaped inside the XML: a
 * lineup blocked by an IR violation answers
 *   You may not set your lineup at this time because You have an
 *   &lt;a href="options?L=19621&amp;O=07&amp;F=0001"&gt;IR Violation&lt;/a&gt;.
 * Passed through raw, the owner got that markup as a screen-reader-only
 * announcement and a bare "Failed — Retry" button — retrying can never work,
 * because the block is on their roster, not on the request (owner report,
 * 2026-10-13). So the text is de-tagged, and the first link MFL embeds is
 * resolved against the league's own MFL host, since that link IS the fix.
 */

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  // &amp; last, so "&amp;lt;" decodes to the literal "&lt;" and no further.
  return text
    .replace(/&(lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&amp;/g, '&');
}

/** Drop every character inside angle brackets, counting nesting. */
function stripTags(input: string): string {
  let out = '';
  let depth = 0;
  for (const ch of input) {
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

export interface MflImportError {
  /** Plain-text message, no markup. */
  message: string;
  /** `'ir-violation'` when MFL refused over an IR violation. */
  reason?: 'ir-violation';
  /** Absolute URL of the MFL page MFL linked to, on the league's own host. */
  fixUrl?: string;
}

export interface ParseMflImportErrorOptions {
  /** League web host without protocol, e.g. 'www44.myfantasyleague.com'. */
  mflHost: string;
  year: string | number;
  /**
   * The league's IR-eligible designations (registry `irEligibleInjuryStatuses`).
   * IR rules differ by league, so the explanation only names them when the
   * league declares them; otherwise it stays league-neutral.
   */
  irEligibleStatuses?: readonly string[];
}

/** "Doubtful, Out or IR" */
function joinOr(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

export function irViolationMessage(eligible?: readonly string[]): string {
  const why = eligible?.length === 1 && eligible[0] === 'IR'
    ? 'a player on your IR is no longer on the NFL’s IR list'
    : eligible?.length
      ? `a player on your IR is no longer listed ${joinOr(eligible)}`
      : 'a player on your IR is no longer eligible for it';
  return `MFL won’t accept a lineup while your team has an IR violation: ${why}. `
    + 'Move him off IR (or release him), then submit again.';
}

/**
 * @param raw the inner text of MFL's `<error>` element, as returned (still
 *   entity-escaped).
 */
export function parseMflImportError(raw: string, opts: ParseMflImportErrorOptions): MflImportError {
  const html = decodeEntities(raw);
  // Rendered with textContent, but no angle bracket survives either way: a
  // character scan drops everything inside <…> (nesting included), and any
  // bracket a second entity pass produces is dropped outright.
  const text = decodeEntities(stripTags(html)).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

  let fixUrl: string | undefined;
  const href = html.match(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
  if (href) {
    try {
      const base = `https://${opts.mflHost}/${opts.year}/`;
      const resolved = new URL(href, base);
      // Only ever link back to the league's own MFL host — never somewhere an
      // error string pointed us.
      if (resolved.protocol === 'https:' && resolved.host === opts.mflHost) fixUrl = resolved.toString();
    } catch {
      // Unparseable href: the message alone still says what is wrong.
    }
  }

  if (/IR\s+Violation/i.test(text)) {
    return { message: irViolationMessage(opts.irEligibleStatuses), reason: 'ir-violation', fixUrl };
  }
  return { message: text || 'Unknown MFL error', fixUrl };
}
