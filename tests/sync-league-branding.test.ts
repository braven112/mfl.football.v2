/**
 * The daily MFL → config branding refresh (scripts/sync-league-branding.mjs).
 *
 * It exists because Archie's owners re-uploaded their art on MFL and the site
 * kept the one-time seed for every team. The rules pinned here are the ones
 * that keep it from doing harm: it may only replace what MFL gave us, never a
 * commissioner's edit, and it must tell an MFL change from a hand edit by what
 * it saw LAST time (`mflSync`), not by comparing with the config.
 */
import { describe, expect, it } from 'vitest';
import { generatedIconPath, planTeamSync } from '../scripts/sync-league-branding.mjs';

const SLUG = 'archies';
const OLD_ART = 'https://www48.myfantasyleague.com/fflnetdynamic2026/10105_franchise_logo0023.png';
const NEW_ART = 'https://www48.myfantasyleague.com/fflnetdynamic2026/10105_franchise_logo0023.jpg';

const seeded = (over: Record<string, unknown> = {}) => ({
  franchiseId: '0023',
  name: 'Stoners',
  nameMedium: 'Stoners',
  nameShort: 'Stoners',
  abbrev: 'STONE',
  aliases: [],
  color: '#111111',
  colorPrimary: '#111111',
  colorSecondary: '#eeeeee',
  icon: generatedIconPath(SLUG, '0023'),
  iconCroppedFromBanner: true,
  banner: OLD_ART,
  ...over,
});

const art = (over: Record<string, unknown> = {}) => ({
  bannerUrl: OLD_ART,
  hash: 'aaaa',
  colors: { primary: '#111111', secondary: '#eeeeee' },
  ...over,
});

describe('planTeamSync — first run (no mflSync yet)', () => {
  it('leaves an unchanged team alone but records what MFL said', () => {
    const plan = planTeamSync(seeded(), { name: 'Stoners' }, { slug: SLUG, art: art() });
    expect(plan.changes).toEqual([]);
    expect(plan.team.mflSync).toEqual({
      name: 'Stoners',
      artHash: 'aaaa',
      colorPrimary: '#111111',
      colorSecondary: '#eeeeee',
      derived: { nameMedium: 'Stoners', nameShort: 'Stoners', abbrev: 'STONE' },
    });
  });

  it('regenerates the icon anyway: a same-name re-upload can keep its colours', () => {
    const plan = planTeamSync(seeded(), { name: 'Stoners' }, { slug: SLUG, art: art() });
    expect(plan.writeIcon).toBe(true);
  });

  it('picks up new art under a new URL, with its colours', () => {
    const plan = planTeamSync(seeded(), { name: 'Stoners' }, {
      slug: SLUG,
      art: art({ bannerUrl: NEW_ART, colors: { primary: '#336699', secondary: '#ffcc00' } }),
    });
    expect(plan.writeIcon).toBe(true);
    expect(plan.team.banner).toBe(NEW_ART);
    expect(plan.team.colorPrimary).toBe('#336699');
    expect(plan.team.color).toBe('#336699');
  });

  it('catches a re-upload under the SAME file name by its colours', () => {
    const plan = planTeamSync(seeded(), { name: 'Stoners' }, {
      slug: SLUG,
      art: art({ colors: { primary: '#336699', secondary: '#ffcc00' } }),
    });
    expect(plan.writeIcon).toBe(true);
  });

  it('renames from MFL and keeps the old name as an alias', () => {
    const plan = planTeamSync(seeded(), { name: 'Stonecutters ', abbrev: 'STC' }, { slug: SLUG, art: art() });
    expect(plan.renamed).toBe(true);
    expect(plan.team.name).toBe('Stonecutters');
    expect(plan.team.aliases).toContain('Stoners');
    expect(plan.team.mflSync.name).toBe('Stonecutters');
  });
});

describe('planTeamSync — later runs', () => {
  const synced = (over: Record<string, unknown> = {}) =>
    seeded({ mflSync: { name: 'Stoners', artHash: 'aaaa', colorPrimary: '#111111', colorSecondary: '#eeeeee' }, ...over });

  it('a new content hash is a new logo, even at the same URL', () => {
    const plan = planTeamSync(synced(), { name: 'Stoners' }, {
      slug: SLUG,
      art: art({ hash: 'bbbb', colors: { primary: '#336699', secondary: '#ffcc00' } }),
    });
    expect(plan.writeIcon).toBe(true);
    expect(plan.team.colorPrimary).toBe('#336699');
    expect(plan.team.mflSync.artHash).toBe('bbbb');
  });

  it('never replaces an icon the commissioner uploaded', () => {
    const blob = 'https://abc.public.blob.vercel-storage.com/archies/0023.webp';
    const plan = planTeamSync(synced({ icon: blob }), { name: 'Stoners' }, { slug: SLUG, art: art({ hash: 'bbbb' }) });
    expect(plan.writeIcon).toBe(false);
    expect(plan.team.icon).toBe(blob);
  });

  it('keeps hand-picked colours when the art changes', () => {
    const plan = planTeamSync(synced({ colorPrimary: '#ff0000', color: '#ff0000' }), { name: 'Stoners' }, {
      slug: SLUG,
      art: art({ hash: 'bbbb', colors: { primary: '#336699', secondary: '#ffcc00' } }),
    });
    expect(plan.writeIcon).toBe(true);
    expect(plan.team.colorPrimary).toBe('#ff0000');
  });

  it('keeps a commissioner rename even when MFL renames again', () => {
    const plan = planTeamSync(synced({ name: 'Rolling Stones' }), { name: 'Stonecutters' }, { slug: SLUG, art: art() });
    expect(plan.renamed).toBe(false);
    expect(plan.team.name).toBe('Rolling Stones');
  });

  it('an unreadable logo changes nothing and keeps the last hash', () => {
    const plan = planTeamSync(synced(), { name: 'Stoners' }, { slug: SLUG, art: null });
    expect(plan.changes).toEqual([]);
    expect(plan.team.mflSync.artHash).toBe('aaaa');
  });
});

describe('planTeamSync — a run after a failed art read', () => {
  it('lets the colours follow the art when no art was recorded yet', () => {
    const team = seeded({ mflSync: { name: 'Stoners' } });
    const plan = planTeamSync(team, { name: 'Stoners' }, {
      slug: SLUG,
      art: art({ hash: 'bbbb', colors: { primary: '#336699', secondary: '#ffcc00' } }),
    });
    expect(plan.writeIcon).toBe(true);
    expect(plan.team.colorPrimary).toBe('#336699');
  });
});

describe('planTeamSync — commissioner edits survive', () => {
  const synced = (over: Record<string, unknown> = {}) =>
    seeded({
      mflSync: {
        name: 'Stoners',
        artHash: 'aaaa',
        colorPrimary: '#111111',
        colorSecondary: '#eeeeee',
        derived: { nameMedium: 'Stoners', nameShort: 'Stoners', abbrev: 'STONE' },
      },
      ...over,
    });

  it('edit, quiet sync, then new art: the hand-picked colour stays', () => {
    const edited = synced({ colorPrimary: '#ff0000', color: '#ff0000' });
    const quiet = planTeamSync(edited, { name: 'Stoners' }, { slug: SLUG, art: art() });
    expect(quiet.team.mflSync.colorPrimary).toBe('#111111');
    const changed = planTeamSync(quiet.team, { name: 'Stoners' }, {
      slug: SLUG,
      art: art({ hash: 'bbbb', colors: { primary: '#336699', secondary: '#ffcc00' } }),
    });
    expect(changed.writeIcon).toBe(true);
    expect(changed.team.colorPrimary).toBe('#ff0000');
  });

  it('an MFL rename keeps a hand-set short name', () => {
    const plan = planTeamSync(synced({ nameShort: 'Rocks' }), { name: 'Stonecutters', abbrev: 'STC' }, { slug: SLUG, art: art() });
    expect(plan.team.name).toBe('Stonecutters');
    expect(plan.team.nameShort).toBe('Rocks');
    expect(plan.team.nameMedium).toBe('Stonecutters');
  });

  it('an MFL rename counts toward the rollover stop even when a hand-set name blocks it', () => {
    const plan = planTeamSync(synced({ name: 'Rolling Stones' }), { name: 'Stonecutters' }, { slug: SLUG, art: art() });
    expect(plan.renamed).toBe(false);
    expect(plan.mflRenamed).toBe(true);
  });
});
