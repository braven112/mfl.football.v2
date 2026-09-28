/**
 * Commissioner branding edits (src/utils/branding-edit.mjs) and the publish
 * script the workflow runs (scripts/apply-branding-edit.mjs).
 *
 * The same validator runs in the API and in the workflow, because the
 * workflow can be dispatched by hand and must not trust its input.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyBrandingEdit, isBlobUrl, validateBrandingEdit } from '../src/utils/branding-edit.mjs';
import { runBrandingEdit } from '../scripts/apply-branding-edit.mjs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const current = {
  franchiseId: '0005',
  name: 'Lions',
  nameMedium: 'Lions',
  nameShort: 'Lions',
  abbrev: 'LIONS',
  aliases: [],
  color: '#0a4879',
  colorPrimary: '#0a4879',
  colorSecondary: '#24a7e7',
  icon: '/assets/archies/icons/0005.webp',
  banner: 'https://www48.myfantasyleague.com/fflnetdynamic2026/10105_franchise_logo0005.png',
};
const ctx = { leagueSlug: 'archies', current };
const BLOB = 'https://abc123.public.blob.vercel-storage.com/branding/archies/0005/icon-1.png';

describe('validateBrandingEdit', () => {
  it('accepts and normalises a real edit', () => {
    const r = validateBrandingEdit(
      { name: '  Detroit   Roar ', nameShort: 'Roar', abbrev: 'roar', colorPrimary: '#FF0000', aliases: ['Roar', ' Roar ', 'Cats'] },
      ctx,
    );
    expect(r).toEqual({
      ok: true,
      patch: { name: 'Detroit Roar', nameShort: 'Roar', abbrev: 'ROAR', colorPrimary: '#ff0000', aliases: ['Roar', 'Cats'] },
    });
  });

  it('enforces the display limits the site uses', () => {
    expect(validateBrandingEdit({ nameMedium: 'x'.repeat(16) }, ctx).ok).toBe(false);
    expect(validateBrandingEdit({ nameShort: 'x'.repeat(11) }, ctx).ok).toBe(false);
    expect(validateBrandingEdit({ abbrev: 'A' }, ctx).ok).toBe(false);
    expect(validateBrandingEdit({ abbrev: 'TOOLONG' }, ctx).ok).toBe(false);
  });

  it('rejects unknown fields instead of ignoring them', () => {
    const r = validateBrandingEdit({ franchiseId: '0001' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('only takes images that were uploaded, are unchanged, or are the league’s own assets', () => {
    expect(validateBrandingEdit({ icon: BLOB }, ctx).ok).toBe(true);
    expect(validateBrandingEdit({ banner: current.banner }, ctx).ok).toBe(true);
    expect(validateBrandingEdit({ icon: '/assets/archies/icons/0009.webp' }, ctx).ok).toBe(true);
    expect(validateBrandingEdit({ icon: 'https://evil.example.com/x.png' }, ctx).ok).toBe(false);
    expect(validateBrandingEdit({ icon: '/assets/theleague/icons/pigskins.png' }, ctx).ok).toBe(false);
    expect(validateBrandingEdit({ icon: '/assets/archies/../theleague/x.png' }, ctx).ok).toBe(false);
    expect(validateBrandingEdit({ icon: '' }, ctx).ok).toBe(false);
  });

  it('requires hex colours, and lets the optional ones be cleared', () => {
    expect(validateBrandingEdit({ colorPrimary: 'red' }, ctx).ok).toBe(false);
    expect(validateBrandingEdit({ colorPrimary: '' }, ctx).ok).toBe(false);
    expect(validateBrandingEdit({ colorTertiary: '' }, ctx)).toEqual({ ok: true, patch: { colorTertiary: null } });
  });

  it('says so when nothing changes', () => {
    expect(validateBrandingEdit({}, ctx)).toEqual({ ok: false, errors: ['Nothing to change.'] });
  });

  it('recognises Vercel Blob URLs only', () => {
    expect(isBlobUrl(BLOB)).toBe(true);
    expect(isBlobUrl('http://abc.public.blob.vercel-storage.com/x.png')).toBe(false);
    expect(isBlobUrl('https://public.blob.vercel-storage.com.evil.com/x.png')).toBe(false);
  });
});

describe('applyBrandingEdit', () => {
  const config = { name: 'x', teams: [current, { franchiseId: '0006', name: 'Chickens' }] };

  it('changes one team and keeps the old name as an alias on a rename', () => {
    const next = applyBrandingEdit(config, '0005', { name: 'Detroit Roar' });
    expect(next.teams[0]).toMatchObject({ name: 'Detroit Roar', aliases: ['Lions'] });
    expect(next.teams[1]).toBe(config.teams[1]);
    expect(config.teams[0].name).toBe('Lions');
  });

  it('moves the chart colour with the primary when they matched', () => {
    expect(applyBrandingEdit(config, '0005', { colorPrimary: '#ff0000' }).teams[0].color).toBe('#ff0000');
  });

  it('drops a cleared optional field', () => {
    const withT = { teams: [{ ...current, colorTertiary: '#111111' }] };
    expect(applyBrandingEdit(withT, '0005', { colorTertiary: null }).teams[0]).not.toHaveProperty('colorTertiary');
  });

  it('refuses an unknown franchise', () => {
    expect(() => applyBrandingEdit(config, '0404', { name: 'X' })).toThrow(/No franchise/);
  });
});

describe('runBrandingEdit (the workflow script)', () => {
  const league = getLeagueBySlug('archies')!;
  const setup = () => {
    const root = mkdtempSync(path.join(tmpdir(), 'brand-'));
    mkdirSync(path.join(root, path.dirname(league.configPath)), { recursive: true });
    writeFileSync(path.join(root, league.configPath), JSON.stringify({ teams: [current] }, null, 2));
    return root;
  };
  const log = { log: () => {} };

  it('writes a valid edit to the league config', () => {
    const root = setup();
    runBrandingEdit({ leagueSlug: 'archies', franchiseId: '0005', patchJson: '{"nameShort":"Roar"}', root, log });
    const out = JSON.parse(readFileSync(path.join(root, league.configPath), 'utf8'));
    expect(out.teams[0].nameShort).toBe('Roar');
  });

  it('re-validates rather than trusting its input', () => {
    const root = setup();
    expect(() =>
      runBrandingEdit({ leagueSlug: 'archies', franchiseId: '0005', patchJson: '{"icon":"https://evil.example.com/x.png"}', root, log }),
    ).toThrow(/Rejected/);
    expect(() => runBrandingEdit({ leagueSlug: 'archies', franchiseId: '5; rm -rf', patchJson: '{}', root, log })).toThrow(/Bad franchise/);
  });

  it('refuses a league without the editor turned on', () => {
    expect(() => runBrandingEdit({ leagueSlug: 'theleague', franchiseId: '0001', patchJson: '{"name":"X"}', log })).toThrow(
      /not have the branding editor/,
    );
  });
});
