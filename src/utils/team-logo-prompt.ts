/**
 * The team logo prompt builder (MFL Football app and `/live/team-logo`).
 *
 * We do not make images. An owner picks a style, colours and a kind of art,
 * and this writes the prompt they paste into the AI image tool they already
 * use (ChatGPT, Gemini), or an SVG request for Claude, which draws vector code
 * rather than pictures. The rules wrapped around their choices are the ones
 * our art has to meet: flat, bold and readable at 40 px, on a transparent
 * ground at the master sizes the Brand Book asks for (`brand-asset-specs.ts`),
 * and ORIGINAL — nothing that copies an NFL, college or pro mark, which the
 * stores refuse (docs/plans/mfl-live-store-app.md, Legal).
 *
 * Every word of every prompt is written here, once: the app gets its prompt
 * from `/api/mfl-live/logo-prompt`, the website page imports this module, and
 * the Brand Book's copy-paste prompt is the icon prompt with placeholders.
 * Decided with Brandon 2026-10-27 over an in-app generator (no running cost,
 * no AI-content moderation for Play); research in team memory
 * `team-logo-maker-research`.
 */

import type {
  MflLiveAppLogoChoice,
  MflLiveAppLogoKind,
  MflLiveAppLogoOption,
  MflLiveAppLogoColor,
  MflLiveAppLogoColorNote,
  MflLiveAppLogoSuggestion,
} from '../../packages/shared-types/src/mfl-live-app-logo';
import { NFL_TEAM_NAMES } from './nfl-logo';
import { AA_LARGE_TEXT_RATIO, contrastRatio } from './team-color-contrast';

export const LOGO_STYLES: Array<MflLiveAppLogoOption & { phrase: string }> = [
  { id: 'crest', label: 'Classic crest', phrase: 'a classic varsity crest' },
  { id: 'mascot', label: 'Modern mascot', phrase: 'a modern, minimal mascot head' },
  { id: 'monogram', label: 'Monogram', phrase: 'a bold monogram built from the team initials' },
  { id: 'retro', label: 'Retro patch', phrase: 'a retro 1970s embroidered patch' },
  { id: 'badge', label: 'Round badge', phrase: 'a round badge with the mascot in the middle' },
];

/**
 * The colour grid. The owner taps up to `LOGO_MAX_COLORS` of these, or types
 * any other hex. Names go into the prompt beside the hex so the image tool
 * reads both.
 */
export const LOGO_COLORS: MflLiveAppLogoColor[] = [
  { name: 'red', hex: '#C8102E' },
  { name: 'crimson', hex: '#9E1B32' },
  { name: 'maroon', hex: '#6B1F2A' },
  { name: 'orange', hex: '#F26B1D' },
  { name: 'gold', hex: '#FFB81C' },
  { name: 'yellow', hex: '#FFD100' },
  { name: 'kelly green', hex: '#00843D' },
  { name: 'forest green', hex: '#1E5631' },
  { name: 'teal', hex: '#0F766E' },
  { name: 'sky blue', hex: '#4FA3E0' },
  { name: 'royal blue', hex: '#1D4ED8' },
  { name: 'navy', hex: '#13294B' },
  { name: 'purple', hex: '#4C1D95' },
  { name: 'brown', hex: '#4E3629' },
  { name: 'cream', hex: '#F3E9D2' },
  { name: 'silver', hex: '#A5ACAF' },
  { name: 'white', hex: '#FFFFFF' },
  { name: 'black', hex: '#111111' },
];

export const LOGO_MAX_COLORS = 3;

/**
 * One-tap colour sets that read well together and stay apart when tiny: every
 * two colours in a set clear `LOGO_MIN_CONTRAST`, which
 * tests/team-logo-prompt.test.ts checks, so a set added here cannot be a
 * pair that blurs into one blob at 40 px.
 */
export const LOGO_COLOR_SUGGESTIONS: MflLiveAppLogoSuggestion[] = [
  { label: 'Red, white and black', hexes: ['#C8102E', '#FFFFFF', '#111111'] },
  { label: 'Navy and gold', hexes: ['#13294B', '#FFB81C'] },
  { label: 'Royal and white', hexes: ['#1D4ED8', '#FFFFFF'] },
  { label: 'Forest and cream', hexes: ['#1E5631', '#F3E9D2'] },
  { label: 'Kelly green and white', hexes: ['#00843D', '#FFFFFF'] },
  { label: 'Purple and gold', hexes: ['#4C1D95', '#FFB81C'] },
  { label: 'Black and orange', hexes: ['#111111', '#F26B1D'] },
  { label: 'Maroon and gold', hexes: ['#6B1F2A', '#FFB81C'] },
  { label: 'Navy and silver', hexes: ['#13294B', '#A5ACAF'] },
  { label: 'Teal, black and white', hexes: ['#0F766E', '#111111', '#FFFFFF'] },
];

/**
 * Two colours in a logo must differ by at least WCAG's 3:1 for graphics
 * (1.4.11, the same bar as large text), or they merge when the logo is small.
 */
export const LOGO_MIN_CONTRAST = AA_LARGE_TEXT_RATIO;

/** The grounds a logo sits on: the app's dark cards and the site's white pages. */
const DARK_GROUND = '#14161A';
const LIGHT_GROUND = '#FFFFFF';

export const LOGO_KINDS: Array<MflLiveAppLogoOption<MflLiveAppLogoKind>> = [
  { id: 'icon', label: 'Square icon' },
  { id: 'banner', label: 'Wide banner' },
  { id: 'svg', label: 'Vector (for Claude)' },
];

export const DEFAULT_LOGO_CHOICE = { style: 'crest', colors: ['#C8102E', '#FFFFFF'], kind: 'icon' } as const;

const IDEA_MAX = 120;
const NAME_MAX = 60;

/** One line of plain text: no quotes or line breaks that could reshape the prompt around it. */
export function cleanLogoText(value: unknown, max: number): string {
  return `${value ?? ''}`
    .replace(/["“”«»`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** `#RRGGBB` from what the owner sent, or null. Accepts `#abc` and a missing `#`. */
export function normalizeHex(value: unknown): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(`${value ?? ''}`.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return `#${h.toUpperCase()}`;
}

/** The owner's colours, cleaned: valid hexes only, no repeats, at most three. */
export function pickLogoColors(sent: unknown): string[] {
  const list = Array.isArray(sent) ? sent : [];
  const hexes = [...new Set(list.map(normalizeHex).filter((h): h is string => !!h))].slice(0, LOGO_MAX_COLORS);
  return hexes.length ? hexes : [...DEFAULT_LOGO_CHOICE.colors];
}

/** "red #C8102E, white #FFFFFF and black #111111"; a typed hex goes in on its own. */
export function colorsText(hexes: string[]): string {
  const named = hexes.map((h) => {
    const known = LOGO_COLORS.find((c) => c.hex === h);
    return known ? `${known.name} ${h}` : h;
  });
  return named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}` : named[0];
}

function colorName(hex: string): string {
  return LOGO_COLORS.find((c) => c.hex === hex)?.name ?? hex;
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Whether the owner's colours work together, in words: any two that are too
 * close to tell apart, else a nod. Also whether the whole set disappears on a
 * dark or a light ground, which the prompt then fixes with an outline.
 */
export function logoColorAdvice(hexes: string[]): { note: MflLiveAppLogoColorNote; outline?: 'light' | 'dark' } {
  const outline = hexes.every((h) => contrastRatio(h, DARK_GROUND) < LOGO_MIN_CONTRAST)
    ? 'light'
    : hexes.every((h) => contrastRatio(h, LIGHT_GROUND) < LOGO_MIN_CONTRAST)
      ? 'dark'
      : undefined;
  const ground =
    outline === 'light'
      ? ' All of them are dark, so we asked for a thin white outline to show on dark screens.'
      : outline === 'dark'
        ? ' All of them are light, so we asked for a thin dark outline to show on white pages.'
        : '';

  let worst: { a: string; b: string; ratio: number } | null = null;
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      const ratio = contrastRatio(hexes[i], hexes[j]);
      if (!worst || ratio < worst.ratio) worst = { a: hexes[i], b: hexes[j], ratio };
    }
  }

  if (!worst) {
    return {
      outline,
      note: { tone: 'tip', text: `One color makes a simple mark. Add a much lighter or darker second color so details show.${ground}` },
    };
  }
  if (worst.ratio < LOGO_MIN_CONTRAST) {
    return {
      outline,
      note: {
        tone: 'weak',
        text:
          `${capital(colorName(worst.a))} and ${colorName(worst.b)} are too close to tell apart on a small logo ` +
          `(${worst.ratio.toFixed(1)}:1, aim for 3:1). Swap one for a much lighter or darker color, or tap a suggested set.${ground}`,
      },
    };
  }
  return {
    outline,
    note: { tone: 'good', text: `Good contrast: these colors stay distinct even when the logo is tiny.${ground}` },
  };
}

const OUTLINE: Record<'light' | 'dark', string> = {
  light: 'Give the logo a thin white outline so it stands out on dark backgrounds.',
  dark: 'Give the logo a thin dark outline so it stands out on white backgrounds.',
};

const ORIGINAL_RULE =
  'It must be an original design: do not copy or resemble any NFL, college or professional team logo, shield or wordmark.';

/**
 * The prompt for one set of choices. `colors` is already phrased ("crimson
 * #B3122E and gold #F2B705"), so the Brand Book can pass a `[colors]`
 * placeholder through the same sentence.
 */
export function writeLogoPrompt(input: {
  teamName: string;
  idea: string;
  stylePhrase: string;
  colors: string;
  kind: MflLiveAppLogoKind;
  /** Asks for an outline when every colour vanishes on one of our grounds. */
  outline?: 'light' | 'dark';
}): string {
  const { teamName, idea, stylePhrase, colors, kind } = input;
  const subject = idea ? `${idea}, drawn as ${stylePhrase}` : stylePhrase;
  const closing = input.outline ? `${OUTLINE[input.outline]} ${ORIGINAL_RULE}` : ORIGINAL_RULE;
  if (kind === 'banner') {
    return (
      `Design a wide team banner for a fantasy football team called "${teamName}". ` +
      `On the left, the team logo: ${subject}. To its right, the team name in big, bold letters. ` +
      `Flat vector style, bold simple shapes, thick clean outlines, colors: ${colors}. ` +
      'No gradients, no photo textures. Transparent background, 1900 × 316 pixels (6:1), ' +
      `with the logo and name filling the height. ${closing}`
    );
  }
  if (kind === 'svg') {
    return (
      `Write one self-contained SVG file (viewBox "0 0 1024 1024") for the logo of a fantasy football team called "${teamName}": ${subject}. ` +
      `Use only these colors: ${colors}. Flat fills and thick outlines, no gradients, no filters, no embedded images, no small text. ` +
      'Leave the background transparent with some empty space around the edges. ' +
      `It must stay recognizable when shrunk to 40 pixels. ${closing} Reply with the SVG code only.`
    );
  }
  return (
    `Design a sports team logo for a fantasy football team called "${teamName}": ${subject}. ` +
    `Flat vector style, bold simple shapes, thick clean outlines, colors: ${colors}. ` +
    'No gradients, no photo textures, no small text. Centered on a transparent background, ' +
    'square 1024 × 1024, with some empty space around the edges. ' +
    `It must stay recognizable when shrunk to 40 pixels. ${closing}`
  );
}

/** NFL club nicknames, plural as the clubs use them ("Packers", "49ers"). */
const NFL_NICKNAMES = Object.values(NFL_TEAM_NAMES).map((full) => full.split(' ').pop() as string);

/**
 * A gentle note when the name or idea names an NFL club. Not a block: an owner
 * may call their team anything, but the art must not borrow the club's mark.
 */
export function nflNameWarning(...texts: string[]): string | undefined {
  const joined = texts.join(' ');
  const hit = NFL_NICKNAMES.find((n) => new RegExp(`\\b${n}\\b`, 'i').test(joined));
  return hit
    ? `“${hit}” is an NFL team’s name. That’s fine for your team, but ask for new art, not their logo or colors.`
    : undefined;
}

export interface BuiltLogoPrompt {
  choice: Required<MflLiveAppLogoChoice>;
  prompt: string;
  warning?: string;
  colorNote: MflLiveAppLogoColorNote;
}

/**
 * Builds the prompt from what the owner sent. Unknown ids fall back to the
 * defaults rather than failing: a stale app build with a retired style still
 * gets a prompt.
 */
export function buildTeamLogoPrompt(
  sent: Partial<MflLiveAppLogoChoice> | null | undefined,
  mflTeamName: string,
): BuiltLogoPrompt {
  const teamName = cleanLogoText(sent?.teamName, NAME_MAX) || cleanLogoText(mflTeamName, NAME_MAX) || 'my team';
  const idea = cleanLogoText(sent?.idea, IDEA_MAX);
  const style = LOGO_STYLES.find((s) => s.id === sent?.style) ?? LOGO_STYLES.find((s) => s.id === DEFAULT_LOGO_CHOICE.style)!;
  const colors = pickLogoColors(sent?.colors);
  const kind = LOGO_KINDS.find((k) => k.id === sent?.kind)?.id ?? DEFAULT_LOGO_CHOICE.kind;

  const advice = logoColorAdvice(colors);

  return {
    choice: { teamName, idea, style: style.id, colors, kind },
    prompt: writeLogoPrompt({
      teamName,
      idea,
      stylePhrase: style.phrase,
      colors: colorsText(colors),
      kind,
      outline: advice.outline,
    }),
    warning: nflNameWarning(teamName, idea),
    colorNote: advice.note,
  };
}

/** The choices as the app lists them (no prompt wording leaves the server). */
export function logoPromptOptions() {
  return {
    styles: LOGO_STYLES.map(({ id, label }) => ({ id, label })),
    colors: LOGO_COLORS,
    suggestions: LOGO_COLOR_SUGGESTIONS,
    maxColors: LOGO_MAX_COLORS,
    kinds: LOGO_KINDS,
  };
}
