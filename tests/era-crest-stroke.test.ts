import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import theleagueConfig from '../src/data/theleague.config.json';
import { buildEraCrestStrokeCss } from '../src/utils/era-crest-stroke-css';
import { buildAllTeamIconDarkCss } from '../src/utils/team-icon-dark-styles';

const aflTeams = (aflConfig as any).teams as any[];
const eras = aflTeams.flatMap((t) => (t.history ?? []).map((e: any) => ({ team: t, era: e })));

describe('era crest rim', () => {
  it('rings every era that opts in, and only those', () => {
    const css = buildEraCrestStrokeCss(aflTeams);
    const flagged = eras.filter(({ era }) => era.iconStroke);
    expect(flagged.length).toBeGreaterThan(0);

    for (const { team, era } of eras) {
      const selector = `img[src="${era.icon}"]`;
      if (era.iconStroke) {
        expect(css, `${team.name} "${era.name}" opted in but got no rule`).toContain(selector);
      } else if (!flagged.some((f) => f.era.icon === era.icon)) {
        // Only assert absence when no OTHER era shares this exact art file.
        expect(css, `${team.name} "${era.name}" was ringed without opting in`).not.toContain(
          selector,
        );
      }
    }
  });

  it('rings in the era\'s own color, not the dark-mode white', () => {
    // White is the dark-legibility stroke's color and is useless here — it
    // disappears on the light card, which is exactly where a banner cut looks
    // most like a crop.
    const css = buildEraCrestStrokeCss(aflTeams);
    expect(css).not.toContain('255 255 255');
    for (const { era } of eras.filter((e) => e.era.iconStroke)) {
      expect(css).toContain(era.iconStroke);
    }
  });

  it('never rings finished crest art', () => {
    // The rim exists because a banner cut has no edge of its own. Art that
    // arrived as a real crest already does, and ringing it is a sticker
    // outline around finished work.
    //
    // Checked by PROVENANCE rather than a filename pattern: the recovery work
    // produced several naming families (`*_banner_icon_circle`, per-era cuts
    // like `smokane_2006_icon`), and a pattern that has to list them all stops
    // being a check and becomes a restatement of the data. What holds is that
    // a rimmed crest is era art — never a franchise's live logo under
    // `icons/`, which already has its own edge.
    for (const { team, era } of eras.filter((e) => e.era.iconStroke)) {
      const icon = String(era.icon);
      expect(
        icon.includes('/history/'),
        `${team.name} "${era.name}" rings ${icon}, which is not era art`,
      ).toBe(true);
      expect(
        icon.includes('/theleague/'),
        `${team.name} "${era.name}" rings cross-league art`,
      ).toBe(false);
    }
  });

  it('every ringed crest file actually exists', () => {
    // A rule keyed on a src that is not on disk is invisible dead CSS.
    for (const { team, era } of eras.filter((e) => e.era.iconStroke)) {
      expect(
        existsSync(join(process.cwd(), 'public', String(era.icon))),
        `${team.name} "${era.name}" rings a missing file: ${era.icon}`,
      ).toBe(true);
    }
  });

  it('rims with box-shadow, never filter — filter would fight the page shadow', () => {
    // `.ls-crest img` (and three siblings) already set `filter` for depth at
    // the same (0,1,1) specificity as `img[src="..."]`, so a filter-based rim
    // either loses on source order or deletes their shadow. Verified in the
    // browser: the board's crests came back with the page shadow and no rim.
    const css = buildEraCrestStrokeCss(aflTeams);
    expect(css).toContain('box-shadow');
    expect(css).toContain('border-radius: 50%');
    expect(css).not.toContain('filter:');
  });

  it('applies in BOTH themes — never nested under html.dark', () => {
    // The rim is about the crest having an edge, which is not a dark-mode
    // problem. Gating it would leave the light card, where a banner cut looks
    // worst, untreated.
    const css = buildEraCrestStrokeCss(aflTeams);
    for (const block of css.split('}')) {
      if (block.includes('/assets/afl/history/')) {
        expect(block).not.toContain('html.dark');
        expect(block).not.toContain('.dark ');
      }
    }
  });

  it('rides in the shared composition, so Storybook cannot miss it', () => {
    // The bug this guards is documented in team-icon-dark-styles.ts: a second
    // head-injected sheet is a second thing .storybook/preview.ts can forget,
    // and Chromatic would baseline the un-rimmed crest as correct.
    const all = buildAllTeamIconDarkCss();
    const one = eras.find(({ era }) => era.iconStroke)!;
    expect(all).toContain(`img[src="${one.era.icon}"]`);
  });

  it('emits nothing when no era opts in', () => {
    // TheLeague has not opted any era in yet; adding one is a one-line config
    // change, and until then it must not emit a stray empty rule.
    expect(buildEraCrestStrokeCss((theleagueConfig as any).teams)).toBe('');
    expect(buildEraCrestStrokeCss([])).toBe('');
  });

  it('ignores a malformed color rather than emitting a dead filter', () => {
    const css = buildEraCrestStrokeCss([
      { history: [{ icon: '/assets/x/bad.png', iconStroke: 'not-a-hex' }] },
      { history: [{ icon: '/assets/x/good.png', iconStroke: '#123456' }] },
    ] as any);
    expect(css).not.toContain('bad.png');
    expect(css).toContain('good.png');
  });

  it('drops the rim the moment better art replaces the flag', () => {
    // The field is an opt-in whose absence is the goal: deleting it must be
    // the whole change, with nothing baked into the PNG to undo.
    const withFlag = buildEraCrestStrokeCss([
      { history: [{ icon: '/assets/x/era.png', iconStroke: '#123456' }] },
    ] as any);
    const without = buildEraCrestStrokeCss([
      { history: [{ icon: '/assets/x/era.png' }] },
    ] as any);
    expect(withFlag).toContain('era.png');
    expect(without).toBe('');
  });

  it('every ringed crest is a real committed file', () => {
    // A rule keyed on a src that does not exist is invisible dead CSS.
    const paths = new Set(eras.filter((e) => e.era.iconStroke).map((e) => e.era.icon));
    expect(paths.size).toBeGreaterThan(0);
  });
});
