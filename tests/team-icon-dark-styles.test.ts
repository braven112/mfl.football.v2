/**
 * Dark-mode team icon swap — config + CSS generator validation.
 *
 * Locks in the contract of src/utils/team-icon-dark-css.ts:
 * - teams without `iconDark` produce NO rule (zero behavior change),
 * - teams with `iconDark` produce an exact-src `html.dark` swap rule plus a
 *   franchise-id alias rule (some client code builds `/icons/{fid}.png`),
 * - every `iconDark` declared in either league config points at a real file
 *   under public/ and sits next to a real light `icon`.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTeamIconDarkCss,
  iconSrcVariants,
  preferredIconSrc,
} from '../src/utils/team-icon-dark-css';
import theleagueConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';

const PUBLIC_DIR = join(__dirname, '..', 'public');

/** Site-relative asset path → absolute path under public/ (absolute URLs pass through as null). */
function publicPath(assetPath: string): string | null {
  if (!assetPath.startsWith('/')) return null;
  return join(PUBLIC_DIR, assetPath);
}

describe('buildTeamIconDarkCss', () => {
  it('emits nothing for teams without iconDark', () => {
    const css = buildTeamIconDarkCss([
      { franchiseId: '0001', icon: '/assets/theleague/icons/pigskins.png' },
      { franchiseId: '0003' },
    ]);
    expect(css).toBe('');
  });

  it('emits an html.dark swap rule keyed on the exact icon src', () => {
    const css = buildTeamIconDarkCss([
      {
        franchiseId: '0002',
        icon: '/assets/theleague/icons/da_dangsters.png',
        iconDark: '/assets/theleague/icons/da_dangsters_dark.png',
      },
    ]);
    expect(css).toContain(
      'html.dark img[src="/assets/theleague/icons/da_dangsters.png"] { content: url("/assets/theleague/icons/da_dangsters_dark.png"); }',
    );
  });

  it('emits a franchise-id alias rule when franchiseIconDir is given', () => {
    const css = buildTeamIconDarkCss(
      [
        {
          franchiseId: '0002',
          icon: '/assets/theleague/icons/da_dangsters.png',
          iconDark: '/assets/theleague/icons/da_dangsters_dark.png',
        },
      ],
      { franchiseIconDir: '/assets/theleague/icons' },
    );
    expect(css).toContain('img[src="/assets/theleague/icons/0002.png"]');
    // no duplicate rule when the alias equals the icon path itself
    const cssSame = buildTeamIconDarkCss(
      [
        {
          franchiseId: '0002',
          icon: '/assets/theleague/icons/0002.png',
          iconDark: '/assets/theleague/icons/da_dangsters_dark.png',
        },
      ],
      { franchiseIconDir: '/assets/theleague/icons' },
    );
    expect(cssSame.split('\n')).toHaveLength(1);
  });

  it('skips iconDark without a light icon (nothing to swap from)', () => {
    const css = buildTeamIconDarkCss([
      { franchiseId: '0004', iconDark: '/assets/x_dark.png' },
    ]);
    expect(css).toBe('');
  });

  it('escapes double quotes in paths', () => {
    const css = buildTeamIconDarkCss([
      { franchiseId: '0001', icon: '/a"b.png', iconDark: '/a"b_dark.png' },
    ]);
    expect(css).toContain('img[src="/a\\"b.png"]');
    expect(css).toContain('url("/a\\"b_dark.png")');
  });
});

describe.each([
  ['theleague', theleagueConfig.teams as Array<Record<string, unknown>>],
  ['afl', aflConfig.teams as Array<Record<string, unknown>>],
])('%s config iconDark integrity', (_league, teams) => {
  const withDark = teams.filter((t) => typeof t.iconDark === 'string');

  it('every iconDark sits next to a light icon', () => {
    for (const team of withDark) {
      expect(typeof team.icon, `${team.name} has iconDark but no icon`).toBe('string');
    }
  });

  it('every site-relative iconDark (and its light icon) exists under public/', () => {
    for (const team of withDark) {
      for (const field of ['icon', 'iconDark'] as const) {
        const abs = publicPath(team[field] as string);
        if (abs) {
          expect(existsSync(abs), `${team.name} ${field} missing: ${team[field]}`).toBe(true);
        }
      }
    }
  });

  it('every groupMeDark sits next to a light groupMe and exists under public/', () => {
    const withGroupMeDark = teams.filter((t) => typeof t.groupMeDark === 'string');
    for (const team of withGroupMeDark) {
      expect(typeof team.groupMe, `${team.name} has groupMeDark but no groupMe`).toBe('string');
      for (const field of ['groupMe', 'groupMeDark'] as const) {
        const abs = publicPath(team[field] as string);
        if (abs) {
          expect(existsSync(abs), `${team.name} ${field} missing: ${team[field]}`).toBe(true);
        }
      }
    }
  });
});

describe('theleague config dark icon rollout', () => {
  it('the launch teams declare iconDark named {slug}_dark.png next to the light icon', () => {
    const byId = new Map(
      (theleagueConfig.teams as Array<{ franchiseId: string; icon?: string; iconDark?: string }>).map(
        (t) => [t.franchiseId, t],
      ),
    );
    // Dangsters, Maverick, Dead Cap Walking, Ninjas, Music City,
    // Fire Ready Aim, Bring The Pain, Wabbits, Computer Jocks.
    // Two of these took a round trip through the stroke and came back. Computer
    // Jocks (0010) came off in Aug 2026 because its `_dark.png` was the light
    // artwork with a white ring painted on — precisely what the generated stroke
    // does — and returned once real dark artwork was drawn for it; the Mariachi
    // Ninjas (0005) followed the same arc (green redrawn INTO the crest,
    // full-bleed backdrop, ring baked in). Both leagues share each of those
    // files byte-for-byte, the AFL crest being identical artwork. Dark artwork
    // always wins over the stroke — the manifest excludes any team declaring an
    // `iconDark`.
    const LAUNCH_FIDS = ['0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010'];
    for (const fid of LAUNCH_FIDS) {
      const team = byId.get(fid);
      expect(team?.iconDark, `franchise ${fid} should have iconDark`).toBe(
        team?.icon?.replace(/\.png$/, '_dark.png'),
      );
    }
  });
});

/**
 * The absolute-vs-same-origin split. These two helpers are the whole reason a
 * crest can be RENDERED at one URL and STYLED by a selector written for
 * another, so they are unit-tested directly rather than only through the
 * generators — a silent regression here re-introduces either the cross-origin
 * latency that blanked the AFL team columns, or a dark swap that stops
 * matching, and neither surfaces as a test failure anywhere else.
 */
describe('iconSrcVariants', () => {
  it('returns both the absolute and same-origin form of an AFL icon', () => {
    const abs = 'https://mflfootballv2.vercel.app/assets/afl/icons/badd_boys.png';
    const variants = iconSrcVariants(abs);
    expect(variants).toContain(abs);
    expect(variants).toContain('/assets/afl/icons/badd_boys.png');
    expect(variants).toHaveLength(2);
  });

  it('returns a single form for an already-relative icon', () => {
    const rel = '/assets/theleague/icons/da_dangsters.png';
    expect(iconSrcVariants(rel)).toEqual([rel]);
  });

  it('passes an unparseable value through rather than throwing', () => {
    expect(iconSrcVariants('not a url')).toEqual(['not a url']);
  });
});

describe('preferredIconSrc', () => {
  it('normalizes our own asset URLs to same-origin', () => {
    expect(preferredIconSrc('https://mflfootballv2.vercel.app/assets/afl/icons/smokane.png'))
      .toBe('/assets/afl/icons/smokane.png');
  });

  it('leaves a relative path untouched', () => {
    expect(preferredIconSrc('/assets/afl/icons/smokane.png')).toBe('/assets/afl/icons/smokane.png');
  });

  it('leaves a genuinely external host absolute', () => {
    // Only /assets/* is ours. Blob storage and third-party CDNs must not be
    // rewritten to a same-origin path that would 404.
    const external = 'https://uhyqublxrbcezhyu.public.blob.vercel-storage.com/logo.png';
    expect(preferredIconSrc(external)).toBe(external);
  });

  it('every rendered form it produces is still matched by a generated rule', () => {
    // The contract that actually matters: whatever preferredIconSrc emits for a
    // team must appear as a selector in the dark-swap CSS, or that team renders
    // its light crest forever in dark mode.
    for (const cfg of [theleagueConfig, aflConfig] as any[]) {
      const css = buildTeamIconDarkCss(cfg.teams, { franchiseIconDir: '/assets/x' });
      for (const team of cfg.teams ?? []) {
        if (!team.icon || !team.iconDark) continue;
        expect(css, `${team.name}: rendered src has no swap rule`)
          .toContain(`img[src="${preferredIconSrc(team.icon)}"]`);
      }
    }
  });
});
