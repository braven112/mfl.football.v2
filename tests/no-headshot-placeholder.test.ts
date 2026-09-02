import { describe, it, expect } from 'vitest';
import {
  buildNoHeadshotPlaceholder,
  getNoHeadshotPlaceholderMap,
  getPlayerAvatarBackground,
  NFL_TEAM_COLORS,
  NO_HEADSHOT_PLACEHOLDER,
} from '../src/utils/nfl-team-colors';
import {
  DEFAULT_HEADSHOT_URL,
  LEGACY_MFL_NO_PHOTO_URL,
  buildHeadshotOnerror,
  getPlayerHeadshot,
  isPlaceholderHeadshot,
  resolveHeadshotSrc,
} from '../src/constants/roster-constants';

/**
 * The missing-headshot fallback used to be MFL's `no_photo_available.jpg` — a
 * white disc with a black silhouette — which sat ON TOP of the team-color
 * avatar chip and blanked it out completely. It is now an inline, team-colored
 * SVG. These tests pin the three things that would quietly put the white disc
 * back:
 *   1. the placeholder stays inline (no network) and team-colored,
 *   2. it stays safe to splice into a single-quoted inline `onerror` string,
 *   3. the legacy URL keeps being recognized as "no headshot" — it is still
 *      baked into committed roster payloads, loads with a 200, and so never
 *      fires an onerror of its own.
 */
describe('no-headshot placeholder', () => {
  it('is an inline data URI, never a network fetch', () => {
    expect(DEFAULT_HEADSHOT_URL).toBe(NO_HEADSHOT_PLACEHOLDER);
    expect(DEFAULT_HEADSHOT_URL.startsWith('data:image/svg+xml,')).toBe(true);
    // The only `http` in there is the SVG xmlns — nothing is fetched.
    expect(DEFAULT_HEADSHOT_URL).not.toContain('myfantasyleague');
    expect(DEFAULT_HEADSHOT_URL).not.toContain('espncdn');
    expect(DEFAULT_HEADSHOT_URL).not.toContain('yimg');
  });

  it('paints the same team color as the avatar chip it sits on', () => {
    for (const team of Object.keys(NFL_TEAM_COLORS)) {
      const svg = decodeURIComponent(buildNoHeadshotPlaceholder(team).replace('data:image/svg+xml,', ''));
      const chip = getPlayerAvatarBackground(team);
      // Every stop the CSS gradient uses must appear in the SVG, or the
      // placeholder would read as a differently-colored patch on the chip.
      for (const hex of chip.match(/#[0-9a-f]{6}/g) ?? []) {
        expect(svg, `${team} placeholder is missing ${hex}`).toContain(hex);
      }
    }
  });

  it('gives two different teams two different placeholders', () => {
    expect(buildNoHeadshotPlaceholder('TEN')).not.toBe(buildNoHeadshotPlaceholder('KC'));
  });

  it('falls back to the league-neutral color for unknown/FA codes', () => {
    expect(buildNoHeadshotPlaceholder('FA')).toBe(buildNoHeadshotPlaceholder(''));
    expect(buildNoHeadshotPlaceholder('NOT_A_TEAM')).toBe(NO_HEADSHOT_PLACEHOLDER);
  });

  it('carries the id player-cell.css matches on to skip the headshot zoom', () => {
    // player-cell.css: `.player-cell__avatar img[src*="no-headshot"]`. The id
    // must survive URI-encoding intact or the placeholder gets cropped like an
    // ESPN cutout — head blown past the chip edge.
    expect(buildNoHeadshotPlaceholder('KC')).toContain('no-headshot');
  });

  it('is safe to splice into a single-quoted inline onerror handler', () => {
    // encodeURIComponent does NOT escape apostrophes, so an apostrophe in the
    // SVG source would terminate the JS string literal inside the attribute.
    for (const team of ['KC', 'TEN', '']) {
      const uri = buildNoHeadshotPlaceholder(team);
      expect(uri).not.toContain("'");
      expect(uri).not.toContain('"');
      expect(uri).not.toContain('<');
      expect(uri).not.toContain('>');
    }
    const handler = buildHeadshotOnerror('13145', '4239996', 'TEN');
    expect(handler).toContain(buildNoHeadshotPlaceholder('TEN'));
    expect(handler).not.toContain('no_photo_available');
  });

  it('ends every headshot cascade on the team-colored placeholder', () => {
    expect(buildHeadshotOnerror(undefined, undefined, 'PIT')).toContain(buildNoHeadshotPlaceholder('PIT'));
    expect(buildHeadshotOnerror('13145', undefined, 'PIT')).toContain(buildNoHeadshotPlaceholder('PIT'));
    expect(getPlayerHeadshot(undefined, undefined, 'BAL')).toBe(buildNoHeadshotPlaceholder('BAL'));
  });

  it('keys the client map by ESPN codes and MFL aliases alike', () => {
    const map = getNoHeadshotPlaceholderMap();
    expect(map.TEN).toBe(buildNoHeadshotPlaceholder('TEN'));
    // MFL alias — the define:vars renderers look up raw feed codes with no
    // client-side normalization.
    expect(map.KCC).toBe(buildNoHeadshotPlaceholder('KC'));
  });
});

describe('isPlaceholderHeadshot / resolveHeadshotSrc', () => {
  it('treats the legacy MFL no-photo URL as no headshot', () => {
    // It 200s, so no onerror ever fires — recognizing it here is the ONLY
    // thing that stops a stale payload rendering the white disc again.
    expect(isPlaceholderHeadshot(LEGACY_MFL_NO_PHOTO_URL)).toBe(true);
    expect(resolveHeadshotSrc(LEGACY_MFL_NO_PHOTO_URL, 'TEN')).toBe(buildNoHeadshotPlaceholder('TEN'));
  });

  it('treats empty/absent headshots as no headshot', () => {
    expect(isPlaceholderHeadshot(undefined)).toBe(true);
    expect(isPlaceholderHeadshot('')).toBe(true);
    expect(resolveHeadshotSrc(undefined, 'KC')).toBe(buildNoHeadshotPlaceholder('KC'));
  });

  it('leaves a real photo alone', () => {
    const espn = 'https://a.espncdn.com/i/headshots/nfl/players/full/4239996.png';
    expect(isPlaceholderHeadshot(espn)).toBe(false);
    expect(resolveHeadshotSrc(espn, 'TEN')).toBe(espn);
  });
});
