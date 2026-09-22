import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { walkFiles } from './helpers/scan-guard';
import {
  resolveFranchiseSelection,
  resolveTeamSelection,
  resolveAFLTeamSelection,
} from '../src/utils/team-preferences';

/**
 * "Which franchise is the viewer's team" — the three rules two defects broke.
 *
 * 1. The resolvers ended with a literal `return '0001'`. Three call sites asked
 *    for "don't highlight anyone" (`defaultTeam: undefined`, one of them with a
 *    `// Don't default if no preference` comment) and got the league's first
 *    franchise instead — Pacific Pigskins in TheLeague, Smokane FC in the AFL —
 *    presented to a signed-out stranger as their own team. They even wrote
 *    `|| undefined` to opt out, which cannot work: '0001' is truthy.
 * 2. `resolveAFLTeamSelection` had no `authUserFranchise` parameter at all,
 *    while TheLeague's twin did. Its six call sites worked around that four
 *    different ways, three of them by smuggling the session through the
 *    `cookiePreference` or `defaultTeam` slot — which reorders the priority
 *    silently, because a session is not a stated preference.
 *
 * Both leagues have a franchise 0001 (CLAUDE.md, "League registry — never
 * hardcode league constants"), so every one of these resolves to a REAL, WRONG
 * team rather than to an obvious blank. That is why this is a guard and not a
 * comment.
 *
 * Exemptions: the scan strips comments before reading a call, so this file's
 * own prose and the call sites' explanatory comments cannot satisfy or trip
 * it. Known gap: it checks the shape of each call's arguments, not what the
 * variables in them hold — rule (d) below ("the file imports
 * `franchiseIdForLeague`") is what covers a session passed in via a local.
 */

/** Every `.astro` page that resolves a preferred team. */
const PAGES = walkFiles({ roots: ['src/pages'], extensions: ['.astro'] });

const RESOLVERS = /\b(resolveTeamSelection|resolveAFLTeamSelection|resolveFranchiseSelection)\s*\(/g;

/** A session identifier being read straight off the auth user, ungated. */
const BARE_SESSION = /\b\w*[Uu]ser\s*\??\.\s*franchiseId\b/;
/** Anything session-shaped, for the slots a session must never occupy. */
const SESSION_SHAPED = /\b(\w*[Uu]ser\b|auth\w*|franchiseIdForLeague|isAuthorizedForLeague|myFranchiseId|authAflFranchiseId)/;

/** Strip `//` and `/* *\/` comments so prose cannot satisfy or trip the scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The balanced `(...)` following an index, comments removed. */
function callArgsAt(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return stripComments(src.slice(openParen + 1, i));
    }
  }
  throw new Error('unbalanced call');
}

/** The text of one top-level `key:` value inside a call's object literal. */
function valueOf(args: string, key: string): string | null {
  const at = args.search(new RegExp(`(^|[{,\\s])${key}\\s*:`));
  if (at === -1) return null;
  const from = args.indexOf(':', at) + 1;
  let depth = 0;
  for (let i = from; i < args.length; i++) {
    const c = args[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return args.slice(from, i).trim();
      depth--;
    } else if (c === ',' && depth === 0) return args.slice(from, i).trim();
  }
  return args.slice(from).trim();
}

interface Site {
  file: string;
  line: number;
  args: string;
}

function callSites(): Site[] {
  const sites: Site[] = [];
  for (const file of PAGES) {
    const src = readFileSync(file, 'utf8');
    RESOLVERS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RESOLVERS.exec(src)) !== null) {
      const openParen = src.indexOf('(', m.index + m[1].length);
      // The wrapper definitions live in src/utils, not src/pages, so every
      // match here is a real call site.
      sites.push({
        file,
        line: src.slice(0, m.index).split('\n').length,
        args: callArgsAt(src, openParen),
      });
    }
  }
  return sites;
}

describe('"no preference" never resolves to a franchise', () => {
  it('answers undefined when nothing names a team, in both leagues', () => {
    expect(resolveTeamSelection({})).toBeUndefined();
    expect(resolveAFLTeamSelection({})).toBeUndefined();
  });

  it('honours an EXPLICIT defaultTeam: undefined — the shape that shipped the bug', () => {
    // These four spellings all mean "highlight nobody". Every one of them
    // returned '0001' before, including the `|| undefined` opt-out.
    expect(resolveTeamSelection({ defaultTeam: undefined })).toBeUndefined();
    expect(resolveTeamSelection({ defaultTeam: undefined }) || undefined).toBeUndefined();
    expect(resolveAFLTeamSelection({ defaultTeam: undefined })).toBeUndefined();
    expect(
      resolveTeamSelection({
        myTeamParam: null,
        franchiseParam: null,
        cookiePreference: null,
        authUserFranchise: null,
        defaultTeam: undefined,
      })
    ).toBeUndefined();
  });

  it('never falls back to a franchise when every candidate is invalid', () => {
    // A junk param must not become somebody's team.
    expect(
      resolveTeamSelection({ myTeamParam: '9999', franchiseParam: '8888', cookiePreference: 'nope' })
    ).toBeUndefined();
    expect(resolveAFLTeamSelection({ myTeamParam: '9999' })).toBeUndefined();
  });

  it('holds for every league the resolver validates against', () => {
    for (const league of ['theleague', 'afl', 'bb1'] as const) {
      expect(resolveFranchiseSelection(league, {}), league).toBeUndefined();
      expect(resolveFranchiseSelection(league, { defaultTeam: undefined }), league).toBeUndefined();
    }
  });

  it('still returns a team when one is genuinely asked for', () => {
    // The fix must not turn "no preference" into "no answer ever".
    expect(resolveTeamSelection({ defaultTeam: '0001' })).toBe('0001');
    expect(resolveAFLTeamSelection({ myTeamParam: '0003' })).toBe('0003');
  });
});

describe('the AFL resolver reads the session', () => {
  it('accepts authUserFranchise and returns it', () => {
    expect(resolveAFLTeamSelection({ authUserFranchise: '0007' })).toBe('0007');
  });

  it('puts the session BEHIND a stated preference and AHEAD of any default', () => {
    // The priority slot TheLeague uses. A smuggle into `cookiePreference`
    // would make a session outrank a real cookie; one into `defaultTeam`
    // would make it lose to one.
    expect(
      resolveAFLTeamSelection({ cookiePreference: '0005', authUserFranchise: '0007' })
    ).toBe('0005');
    expect(
      resolveAFLTeamSelection({ authUserFranchise: '0007', defaultTeam: '0001' })
    ).toBe('0007');
    expect(
      resolveAFLTeamSelection({ myTeamParam: '0003', authUserFranchise: '0007' })
    ).toBe('0003');
  });

  it('resolves both leagues through ONE body, so they cannot drift again', () => {
    // The two resolvers were separate copies and the AFL's lost its session
    // slot. Same params in, same priority order out — only the franchise list
    // that validates them differs.
    const params = { cookiePreference: '0005', authUserFranchise: '0007', defaultTeam: '0001' };
    expect(resolveTeamSelection(params)).toBe(resolveFranchiseSelection('theleague', params));
    expect(resolveAFLTeamSelection(params)).toBe(resolveFranchiseSelection('afl', params));
    const src = readFileSync('src/utils/team-preferences.ts', 'utf8');
    for (const wrapper of ['resolveTeamSelection', 'resolveAFLTeamSelection']) {
      const body = src.slice(src.indexOf(`export function ${wrapper}(`));
      expect(body.slice(0, body.indexOf('\n}')), wrapper).toContain('resolveFranchiseSelection(');
    }
  });
});

describe('no call site smuggles the session through another slot', () => {
  it('finds the call sites at all', () => {
    // A rename that empties the scan would make every check below vacuous.
    const sites = callSites();
    expect(sites.length).toBeGreaterThanOrEqual(14);
    expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThanOrEqual(13);
  });

  it('never passes a session into cookiePreference or defaultTeam', () => {
    const bad: string[] = [];
    for (const site of callSites()) {
      for (const slot of ['cookiePreference', 'defaultTeam'] as const) {
        const value = valueOf(site.args, slot);
        if (value && SESSION_SHAPED.test(value)) {
          bad.push(`  ${site.file}:${site.line}  ${slot}: ${value}`);
        }
      }
    }
    expect(
      bad,
      'The session belongs in `authUserFranchise` — its own priority slot. ' +
        'Passing it as `cookiePreference` makes it outrank a real cookie; passing ' +
        'it as `defaultTeam` makes it lose to one. See ' +
        'src/utils/team-preferences.ts#TeamSelectionParams:\n' +
        bad.join('\n')
    ).toEqual([]);
  });

  it('gives every call site an authUserFranchise slot', () => {
    const bad = callSites()
      .filter((s) => valueOf(s.args, 'authUserFranchise') === null)
      .map((s) => `  ${s.file}:${s.line}`);
    expect(
      bad,
      'A league-scoped page knows who is signed in, so it must say so — a site ' +
        'with no `authUserFranchise` is a signed-in owner shown somebody ' +
        "else's team as their own:\n" + bad.join('\n')
    ).toEqual([]);
  });

  it('league-gates every session it passes', () => {
    const bad: string[] = [];
    for (const site of callSites()) {
      const value = valueOf(site.args, 'authUserFranchise');
      if (value && BARE_SESSION.test(value)) {
        bad.push(`  ${site.file}:${site.line}  authUserFranchise: ${value}`);
      }
      if (value && !stripComments(readFileSync(site.file, 'utf8')).includes('franchiseIdForLeague')) {
        bad.push(`  ${site.file}:${site.line}  does not import franchiseIdForLeague`);
      }
    }
    expect(
      bad,
      'Both leagues have a franchise 0001, so a bare `user.franchiseId` matches ' +
        "a TheLeague owner to an AFL roster. Derive it with " +
        '`franchiseIdForLeague(user, league.id)` — see CLAUDE.md, "League ' +
        'registry — never hardcode league constants":\n' + bad.join('\n')
    ).toEqual([]);
  });
});
