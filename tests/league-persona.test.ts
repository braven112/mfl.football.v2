/**
 * The league's news persona (src/utils/persona.mjs) and the prompt it builds.
 *
 * The load-bearing promise: a league that never saves a persona writes EXACTLY
 * what it wrote before personas existed — same system prompt, byte for byte.
 * A custom persona must replace who is speaking without dropping one rule.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONA,
  PERSONA_LIMITS,
  isDefaultPersona,
  personaKey,
  resolvePersona,
  validatePersona,
} from '../src/utils/persona.mjs';
import {
  BASE_SYSTEM_PROMPT,
  PERSONA_NEUTRAL_RULES,
  buildCachedSystem,
} from '../scripts/article-utils/ai-client.mjs';
import { loadLeaguePersona } from '../scripts/lib/persona-store.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const ARCHIE = { name: 'Archie Bunker', avatarUrl: 'https://example.com/a.png', voice: 'Grumpy. Hates the Jets.' };

describe('validatePersona', () => {
  it('accepts and trims a complete persona', () => {
    const r = validatePersona({ name: '  Archie   Bunker ', avatarUrl: ' https://example.com/a.png ', voice: '  Grumpy.  ' });
    expect(r).toEqual({ ok: true, persona: { name: 'Archie Bunker', avatarUrl: 'https://example.com/a.png', voice: 'Grumpy.' } });
  });

  it('allows an empty avatar', () => {
    expect(validatePersona({ name: 'A', voice: 'B' }).ok).toBe(true);
  });

  it('requires a name and a voice', () => {
    const r = validatePersona({ name: ' ', voice: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  it('enforces the length limits', () => {
    expect(validatePersona({ name: 'x'.repeat(PERSONA_LIMITS.name + 1), voice: 'v' }).ok).toBe(false);
    expect(validatePersona({ name: 'n', voice: 'v'.repeat(PERSONA_LIMITS.voice + 1) }).ok).toBe(false);
  });

  it('refuses a non-https avatar', () => {
    expect(validatePersona({ name: 'n', voice: 'v', avatarUrl: 'http://example.com/a.png' }).ok).toBe(false);
    expect(validatePersona({ name: 'n', voice: 'v', avatarUrl: 'javascript:alert(1)' }).ok).toBe(false);
  });

  it('strips control characters but keeps line breaks in the voice', () => {
    const r = validatePersona({ name: 'n\u0007', voice: 'one\r\ntwo\u0000' });
    expect(r.ok && r.persona).toEqual({ name: 'n', avatarUrl: '', voice: 'one\ntwo' });
  });
});

describe('resolvePersona', () => {
  it('falls back to Schefter for a league with nothing saved', () => {
    expect(resolvePersona(LEAGUES.theleague, null)).toEqual({ ...DEFAULT_PERSONA, source: 'default' });
  });

  it('uses the saved override, as a string (node) or an object (Upstash)', () => {
    expect(resolvePersona(LEAGUES.theleague, JSON.stringify(ARCHIE))).toEqual({ ...ARCHIE, source: 'league' });
    expect(resolvePersona(LEAGUES.theleague, ARCHIE)).toEqual({ ...ARCHIE, source: 'league' });
  });

  it('ignores a stored value that no longer validates', () => {
    expect(resolvePersona(LEAGUES.theleague, '{"name":""}').source).toBe('default');
    expect(resolvePersona(LEAGUES.theleague, 'not json').source).toBe('default');
  });

  it('prefers a registry default over Schefter', () => {
    const entry = { persona: { name: 'Registry Guy' } };
    expect(resolvePersona(entry, null)).toMatchObject({ name: 'Registry Guy', voice: DEFAULT_PERSONA.voice, source: 'registry' });
  });

  it('keys storage by registry slug', () => {
    expect(personaKey('afl-fantasy')).toBe('persona:afl-fantasy');
  });
});

describe('buildCachedSystem with a persona', () => {
  it('is byte-identical to the pre-persona prompt for the default persona', () => {
    const before = buildCachedSystem('TYPE', { league: 'theleague' });
    for (const persona of [undefined, null, DEFAULT_PERSONA, resolvePersona(LEAGUES.theleague, null)]) {
      expect(buildCachedSystem('TYPE', { league: 'theleague', persona })).toEqual(before);
    }
    expect(before[0].text).toBe(BASE_SYSTEM_PROMPT);
  });

  it('swaps who is speaking for a custom persona and keeps every rule', () => {
    const blocks = buildCachedSystem('TYPE', { league: 'theleague', persona: ARCHIE });
    const all = blocks.map((b: { text: string }) => b.text).join('\n');
    expect(blocks[0].text).toBe(PERSONA_NEUTRAL_RULES);
    expect(blocks[0].cache_control).toBeTruthy();
    expect(all).toContain('You are Archie Bunker');
    expect(all).toContain('Grumpy. Hates the Jets.');
    expect(all).not.toContain('You are Claude Schefter');
    expect(all).not.toContain("Channel Adam Schefter's");
    for (const rule of ['CRITICAL RULE:', 'FORMATTING RULE:', 'LINK EVERYTHING YOU CAN.', '<p> tags']) {
      expect(all, `custom persona dropped "${rule}"`).toContain(rule);
    }
    expect(all).toContain(LEAGUES.theleague.name);
  });

  it('keeps the persona out of the cached block, so it is shared across personas', () => {
    const a = buildCachedSystem('T', { league: 'theleague', persona: ARCHIE });
    const b = buildCachedSystem('T', { league: 'afl-fantasy', persona: { name: 'Other', voice: 'x' } });
    expect(a[0].text).toBe(b[0].text);
    expect(a[0].text).not.toContain('Archie');
  });

  it('every article type forwards the persona to the prompt', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = new URL('../scripts/article-types/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
    for (const file of files) {
      const mod = await import(new URL(file, dir).href);
      if (typeof mod.getSystemPrompt !== 'function') continue;
      const text = mod
        .getSystemPrompt({ league: 'theleague', persona: ARCHIE })
        .map((b: { text: string }) => b.text)
        .join('');
      expect(text, `${file} ignores the persona`).toContain('You are Archie Bunker');
    }
  });

  it('isDefaultPersona ignores the avatar', () => {
    expect(isDefaultPersona({ ...DEFAULT_PERSONA, avatarUrl: 'https://x.test/a.png' })).toBe(true);
    expect(isDefaultPersona(ARCHIE)).toBe(false);
  });
});

describe('loadLeaguePersona', () => {
  const redis = { url: 'https://redis.test', token: 't' };

  it('reads the saved persona', async () => {
    const command = async (_r: unknown, args: string[]) => {
      expect(args).toEqual(['GET', 'persona:theleague']);
      return JSON.stringify(ARCHIE);
    };
    expect(await loadLeaguePersona('theleague', { redis, command })).toEqual({ ...ARCHIE, source: 'league' });
  });

  it('fails soft to the default when Redis errors or is unconfigured', async () => {
    const command = async () => {
      throw new Error('boom');
    };
    const log = { warn: () => {} };
    expect((await loadLeaguePersona('theleague', { redis, command, log })).source).toBe('default');
    expect((await loadLeaguePersona('theleague', { redis: null })).source).toBe('default');
  });
});

describe('personaLabels and personaByline — the persona on owner-facing surfaces', () => {
  it('reproduces the site’s original wording for the default persona', async () => {
    const { personaLabels } = await import('../src/utils/persona.mjs');
    expect(personaLabels(null)).toMatchObject({
      name: 'Claude Schefter',
      surname: 'Schefter',
      report: 'The Schefter Report',
      reportShort: 'Schefter Report',
      tip: 'Tip Schefter',
      column: 'A Claude Schefter weekly column',
      avatar: '/assets/claude-schefter-avatar.webp',
    });
  });

  it('derives every label from a custom persona', async () => {
    const { personaLabels } = await import('../src/utils/persona.mjs');
    expect(personaLabels({ name: 'Archie Bunker', avatarUrl: 'https://x.test/a.png' })).toMatchObject({
      surname: 'Bunker',
      report: 'The Bunker Report',
      tip: 'Tip Bunker',
      column: 'An Archie Bunker weekly column',
      avatar: 'https://x.test/a.png',
    });
  });

  it('renames only the persona’s own byline', async () => {
    const { personaByline } = await import('../src/utils/persona.mjs');
    const claude = { id: 'claude', name: 'Claude Schefter', handle: '@schefter' };
    const wire = { id: 'nfl-wire', name: 'NFL Wire', handle: '@wire' };
    expect(personaByline(claude, '/assets/c.webp', ARCHIE)).toEqual({
      name: 'Archie Bunker',
      avatar: 'https://example.com/a.png',
      handle: '@bunker',
    });
    expect(personaByline(wire, '/assets/w.webp', ARCHIE)).toEqual({ name: 'NFL Wire', avatar: '/assets/w.webp', handle: '@wire' });
    // Default persona: the feed author table, untouched.
    expect(personaByline(claude, '/assets/c.webp', DEFAULT_PERSONA)).toEqual({
      name: 'Claude Schefter',
      avatar: '/assets/c.webp',
      handle: '@schefter',
    });
  });
});
