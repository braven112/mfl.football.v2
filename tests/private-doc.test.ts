import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isPrivateDocOwner,
  isPrivateDocSlug,
  parsePrivateDocOwners,
} from '../src/utils/private-doc';
import { renderInline, renderMarkdown } from '../src/utils/mini-markdown';
import type { AuthUser } from '../src/utils/auth';

const user = (name: string): AuthUser => ({
  id: 'x',
  name,
  franchiseId: '0001',
  leagueId: '1',
  role: 'owner',
});

describe('private doc owner gate', () => {
  it('fails closed when the owner list is unset or blank', () => {
    expect(isPrivateDocOwner(user('someone'), undefined)).toBe(false);
    expect(isPrivateDocOwner(user('someone'), '')).toBe(false);
    expect(isPrivateDocOwner(user('someone'), ' , ,')).toBe(false);
  });

  it('refuses a missing session and a blank username even when the list has blanks', () => {
    expect(isPrivateDocOwner(null, 'alice')).toBe(false);
    expect(isPrivateDocOwner(user(''), 'alice,,')).toBe(false);
    expect(isPrivateDocOwner(user('  '), 'alice')).toBe(false);
  });

  it('matches usernames case-insensitively and trims', () => {
    expect(isPrivateDocOwner(user('Alice'), ' alice , bob')).toBe(true);
    expect(isPrivateDocOwner(user('bob'), 'alice,BOB')).toBe(true);
    expect(isPrivateDocOwner(user('carol'), 'alice,bob')).toBe(false);
    expect(isPrivateDocOwner(user('ali'), 'alice')).toBe(false);
  });

  it('parses the list without empty entries', () => {
    expect(parsePrivateDocOwners('a,,B ,')).toEqual(['a', 'b']);
  });

  it('only known slugs resolve, so the URL cannot mint Redis keys', () => {
    expect(isPrivateDocSlug('proposal')).toBe(true);
    expect(isPrivateDocSlug('anything-else')).toBe(false);
    expect(isPrivateDocSlug(undefined)).toBe(false);
  });
});

describe('private doc route', () => {
  const route = readFileSync(
    path.resolve(__dirname, '../src/pages/private/[slug].astro'),
    'utf8',
  );

  it('gates in the route: owner check before any read of the document', () => {
    const gate = route.indexOf('isPrivateDocOwner(user)');
    const read = route.indexOf('readPrivateDoc(slug)');
    expect(gate).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(gate);
  });

  it('is never cached or indexed', () => {
    expect(route).toContain("'Cache-Control', 'private, no-store'");
    expect(route).toContain("'X-Robots-Tag', 'noindex, nofollow'");
  });
});

describe('mini markdown', () => {
  it('escapes raw HTML everywhere', () => {
    const out = renderMarkdown('<script>alert(1)</script>\n\n| a | b |\n| --- | --- |\n| <img src=x onerror=1> | **<b>x</b>** |');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('only links http(s), same-origin paths and fragments', () => {
    expect(renderInline('[x](javascript:alert(1))')).not.toContain('href');
    expect(renderInline('[x](//evil.com)')).not.toContain('href');
    expect(renderInline('[x](https://example.com)')).toContain('href="https://example.com"');
    expect(renderInline('[x](/live)')).toContain('href="/live"');
  });

  it('renders the shapes the proposal uses', () => {
    const out = renderMarkdown(
      [
        '# Title',
        '',
        'Lead with **bold** and `code`.',
        '',
        '## Section',
        '',
        '| Product | Price |',
        '| --- | --- |',
        '| Hub | $2,000/year |',
        '',
        '1. **Software only.** We provide software.',
        '2. Second',
        '',
        '- Parent',
        '    - Child',
        '',
        '- [ ] Open question',
        '- [x] Done question',
      ].join('\n'),
    );
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<th>Product</th>');
    expect(out).toContain('<td>$2,000/year</td>');
    expect(out).toMatch(/<ol><li><strong>Software only\.<\/strong> We provide software\.<\/li><li>Second<\/li><\/ol>/);
    expect(out).toContain('<ul><li>Parent<ul><li>Child</li></ul></li></ul>');
    expect(out).toContain('<ul class="tasks">');
    expect(out).toMatch(/type="checkbox" disabled checked/);
  });
});
