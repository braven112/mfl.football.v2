import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isPrivateDocSlug } from '../src/utils/private-doc';
import { renderInline, renderMarkdown } from '../src/utils/mini-markdown';

describe('private doc slugs', () => {
  it('only known slugs resolve, so nothing can mint new Redis keys', () => {
    expect(isPrivateDocSlug('proposal')).toBe(true);
    expect(isPrivateDocSlug('anything-else')).toBe(false);
    expect(isPrivateDocSlug(undefined)).toBe(false);
  });
});

describe.each(['theleague', 'afl-fantasy'])('/%s/admin/proposal route', (slug) => {
  const route = readFileSync(path.resolve(__dirname, `../src/pages/${slug}/admin/proposal.astro`), 'utf8');

  it('runs the league admin gate before touching the document', () => {
    const gate = route.indexOf('isAuthorizedForLeague(user,');
    const commish = route.indexOf('isCommissionerOrAdmin(user)');
    const doc = route.indexOf('handlePrivateDocRequest(');
    expect(gate).toBeGreaterThan(-1);
    expect(commish).toBeGreaterThan(-1);
    expect(doc).toBeGreaterThan(gate);
    expect(route).toContain(`getLeagueBySlug('${slug}')`);
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
