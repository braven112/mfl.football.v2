/**
 * Suggestion Box scope guard.
 *
 * The Board shipped TheLeague-only with bare Redis keys (`sb:ideas`,
 * `sb:last-seen`, `sb:rate:{franchiseId}`). Giving the AFL a board made those
 * keys ambiguous, because **both leagues have a franchise 0001** — the exact
 * collision CLAUDE.md calls out for the rankings store. Unscoped, AFL 0001
 * reading the board would mark TheLeague 0001's unread badge as read, and one
 * league's rule-change debates would publish on the other's page.
 *
 * Two things are pinned here and both are load-bearing:
 *
 *  1. TheLeague's key strings are UNCHANGED, so no existing idea is orphaned.
 *  2. No `/api/suggestions/*` route derives its scope from anything but the
 *     session. A `?league=` param would let an AFL session post onto
 *     TheLeague's board by editing one character.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SUGGESTIONS_SCOPE,
  boardScope,
  leagueSlugForSuggestionsScope,
  scopedBoardKey,
  suggestionsScopeForLeagueId,
  suggestionsScopeForLeagueSlug,
} from '../src/utils/suggestions-scope';
import { LEAGUES } from '../src/config/leagues';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, '../src/pages/api/suggestions');

/** Every key the board writes, as the storage module spells them. */
const BASE_KEYS = [
  'sb:ideas',
  'sb:ideas:activity',
  'sb:last-seen',
  'sb:comments:idea_abc',
  'sb:rate:0001',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('suggestions scope — TheLeague keeps its legacy keys', () => {
  it('returns every base key unchanged for TheLeague', () => {
    for (const key of BASE_KEYS) {
      expect(scopedBoardKey(key, DEFAULT_SUGGESTIONS_SCOPE)).toBe(key);
    }
  });

  it('resolves TheLeague by slug and by MFL league id', () => {
    expect(suggestionsScopeForLeagueSlug(LEAGUES.theleague.slug)).toBe(DEFAULT_SUGGESTIONS_SCOPE);
    expect(suggestionsScopeForLeagueId(LEAGUES.theleague.id)).toBe(DEFAULT_SUGGESTIONS_SCOPE);
  });
});

describe('suggestions scope — every other league gets its own board', () => {
  const aflScope = suggestionsScopeForLeagueSlug(LEAGUES['afl-fantasy'].slug);

  it('gives the AFL a scope that is not TheLeague’s', () => {
    expect(aflScope).not.toBe(DEFAULT_SUGGESTIONS_SCOPE);
    expect(suggestionsScopeForLeagueId(LEAGUES['afl-fantasy'].id)).toBe(aflScope);
  });

  it('infixes the scope after the sb: namespace, colliding with nothing', () => {
    const scoped = BASE_KEYS.map((k) => scopedBoardKey(k, aflScope));
    for (const [i, key] of scoped.entries()) {
      expect(key).not.toBe(BASE_KEYS[i]);
      expect(key.startsWith(`sb:${aflScope}:`)).toBe(true);
    }
    // The whole point: the two leagues' franchise 0001 do not share a key.
    expect(scopedBoardKey('sb:rate:0001', aflScope)).not.toBe(
      scopedBoardKey('sb:rate:0001', DEFAULT_SUGGESTIONS_SCOPE),
    );
  });

  it('round-trips scope → registry slug, so team names read the right config', () => {
    expect(leagueSlugForSuggestionsScope(aflScope)).toBe(LEAGUES['afl-fantasy'].slug);
    expect(leagueSlugForSuggestionsScope(DEFAULT_SUGGESTIONS_SCOPE)).toBe(LEAGUES.theleague.slug);
  });

  it('refuses a key outside the sb: namespace rather than writing to the keyspace root', () => {
    expect(() => scopedBoardKey('ideas', aflScope)).toThrow();
  });

  it('derives the board from a session’s leagueId', () => {
    expect(boardScope({ leagueId: LEAGUES['afl-fantasy'].id })).toBe(aflScope);
    expect(boardScope({ leagueId: LEAGUES.theleague.id })).toBe(DEFAULT_SUGGESTIONS_SCOPE);
  });
});

describe('suggestions API routes take the scope from the session only', () => {
  const routes = walk(API_DIR);

  it('finds the routes (a moved directory must not silently pass this suite)', () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it.each(routes.map((f) => [path.relative(API_DIR, f), f]))(
    '%s resolves its board from the auth user',
    (_rel, file) => {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('suggestions-storage')) return; // no board access at all

      // The scope must come from boardScope(user) — never a request param or
      // body field, which the client controls.
      expect(src).toContain('boardScope(');
      expect(src).not.toMatch(/boardScope\(\s*['"`]/);
      expect(src).not.toMatch(/searchParams\.get\(\s*['"`]league/i);
    },
  );
});
