/**
 * The team logo prompt builder (MFL Football app and `/live/team-logo`).
 *
 * We do not make images. An owner picks a style, one to three team colors and a
 * kind of art, and this writes the prompt they paste into the AI image tool
 * they already use (ChatGPT, Gemini). An SVG-for-Claude kind was dropped on
 * 2026-10-29: Brandon found its logos looked terrible next to the square icon's. The rules wrapped around their choices are the ones
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
import { findLogoReference, referenceNote, referencePromptLine } from './team-logo-references';
import { AA_LARGE_TEXT_RATIO, contrastRatio } from './team-color-contrast';

/**
 * `hint` is the one line on each style's card, saying in plain words what the
 * label means. `image` is an example logo in that style, shown above the name
 * on the website: Brandon is making these (2026-10-30); until one is set the
 * card shows its name and hint alone. Put the files in
 * `public/assets/team-logo-styles/` and name them here. No hint promises
 * words on the logo: icons carry no team name (`NO_TEXT_RULE`).
 */
export const LOGO_STYLES: Array<MflLiveAppLogoOption & { phrase: string; hint: string; image?: string }> = [
  { id: 'crest', label: 'Classic crest', phrase: 'a classic varsity crest', hint: 'A varsity shield, old-school' },
  { id: 'mascot', label: 'Modern mascot', phrase: 'a modern, minimal mascot head', hint: 'A mascot head in sharp, simple shapes' },
  { id: 'monogram', label: 'Monogram', phrase: 'a bold monogram: one stylized initial of the team name, or two initials interlocked into a single symbol', hint: 'One bold initial, or two joined into one symbol' },
  { id: 'retro', label: 'Retro patch', phrase: 'a retro 1970s embroidered patch', hint: 'A stitched 1970s patch, like on a jacket' },
  { id: 'badge', label: 'Round badge', phrase: 'a round badge with the mascot in the middle', hint: 'A circle with the mascot in the middle' },
];

/**
 * The color grid. The owner taps up to `LOGO_MAX_COLORS` of these, or types
 * any other hex. Names go into the prompt beside the hex so the image tool
 * reads both. White and black are on it, so a team can BE red and black or
 * black and white; whichever of the two the owner did not pick, the prompt
 * still offers on top (`neutralsFor`), because nearly every logo needs them for
 * outlines and lettering (Brandon, 2026-10-28).
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

/**
 * How many team colors an owner may pick. The website asks "2 or 3 colors"
 * first (`LOGO_COLOR_COUNTS`) and caps the grid at that; the server takes up
 * to three either way (Brandon, 2026-10-30: a third color gives a logo more
 * life).
 */
export const LOGO_MAX_COLORS = 3;
export const LOGO_COLOR_COUNTS = [2, 3] as const;
export const DEFAULT_LOGO_COLOR_COUNT = 2;

const WHITE = /^#F{6}$/;
const BLACK = /^#(0{6}|111111)$/;

/** White and black, less whichever the owner already picked as a team color. */
function neutralsFor(hexes: string[]): string[] {
  return [
    ...(hexes.some((h) => WHITE.test(h)) ? [] : ['white']),
    ...(hexes.some((h) => BLACK.test(h)) ? [] : ['black']),
  ];
}

/**
 * Ten ready-made pairs, each shown as ONE square split between its two colors
 * (Brandon, 2026-10-28: a shortcut row, not a wall of buttons; any other pair
 * comes from the grid). Both colors clear `LOGO_MIN_CONTRAST`, which
 * tests/team-logo-prompt.test.ts checks, so a pair added here cannot blur
 * into one blob at 40 px. The label is the square's accessible name.
 */
export const LOGO_COLOR_SUGGESTIONS: MflLiveAppLogoSuggestion[] = [
  { label: 'Red and black', hexes: ['#C8102E', '#111111'] },
  { label: 'Black and white', hexes: ['#111111', '#FFFFFF'] },
  { label: 'Navy and gold', hexes: ['#13294B', '#FFB81C'] },
  { label: 'Royal blue and white', hexes: ['#1D4ED8', '#FFFFFF'] },
  { label: 'Purple and gold', hexes: ['#4C1D95', '#FFB81C'] },
  { label: 'Maroon and gold', hexes: ['#6B1F2A', '#FFB81C'] },
  { label: 'Forest green and gold', hexes: ['#1E5631', '#FFB81C'] },
  { label: 'Navy and orange', hexes: ['#13294B', '#F26B1D'] },
  { label: 'Crimson and cream', hexes: ['#9E1B32', '#F3E9D2'] },
  { label: 'Navy and silver', hexes: ['#13294B', '#A5ACAF'] },
];

/**
 * Ten ready-made trios for the three-color mode, shown as one square split in
 * three. Each passes `logoColorAdvice`: the first two clear 3:1 like a pair,
 * and the third clears 3:1 against at least one of them, so it always has a
 * color to sit on (tests/team-logo-prompt.test.ts).
 */
export const LOGO_COLOR_TRIOS: MflLiveAppLogoSuggestion[] = [
  { label: 'Red, white and navy', hexes: ['#C8102E', '#FFFFFF', '#13294B'] },
  { label: 'Navy, gold and red', hexes: ['#13294B', '#FFB81C', '#C8102E'] },
  { label: 'Teal, black and orange', hexes: ['#0F766E', '#111111', '#F26B1D'] },
  { label: 'Navy, orange and silver', hexes: ['#13294B', '#F26B1D', '#A5ACAF'] },
  { label: 'Red, black and silver', hexes: ['#C8102E', '#111111', '#A5ACAF'] },
  { label: 'Crimson, cream and black', hexes: ['#9E1B32', '#F3E9D2', '#111111'] },
  { label: 'Purple, gold and white', hexes: ['#4C1D95', '#FFB81C', '#FFFFFF'] },
  { label: 'Forest green, gold and white', hexes: ['#1E5631', '#FFB81C', '#FFFFFF'] },
  { label: 'Sky blue, navy and white', hexes: ['#4FA3E0', '#13294B', '#FFFFFF'] },
  { label: 'Brown, orange and cream', hexes: ['#4E3629', '#F26B1D', '#F3E9D2'] },
];

/**
 * Two colors in a logo must differ by at least WCAG's 3:1 for graphics
 * (1.4.11, the same bar as large text), or they merge when the logo is small.
 */
export const LOGO_MIN_CONTRAST = AA_LARGE_TEXT_RATIO;

export const LOGO_KINDS: Array<MflLiveAppLogoOption<MflLiveAppLogoKind>> = [
  { id: 'icon', label: 'Square icon' },
  { id: 'banner', label: 'Wide banner' },
];

export const DEFAULT_LOGO_CHOICE = { style: 'crest', colors: ['#C8102E'], kind: 'icon' } as const;

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

/** The owner's team colors, cleaned: valid hexes only, no repeats, at most three. */
export function pickLogoColors(sent: unknown): string[] {
  const list = Array.isArray(sent) ? sent : [];
  const hexes = [...new Set(list.map(normalizeHex).filter((h): h is string => !!h))].slice(0, LOGO_MAX_COLORS);
  return hexes.length ? hexes : [...DEFAULT_LOGO_CHOICE.colors];
}

/** "navy #13294B and gold #FFB81C"; a typed hex goes in on its own. */
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
 * Whether the owner's colors work together, in words. The first two must
 * stand apart (3:1), or they merge on a small logo. A third color is an
 * accent: it only needs one of the other two to sit on, so red, white and
 * navy passes even though red and navy alone are close. White and black come
 * with every prompt, so one color alone is a complete look, not a gap.
 */
export function logoColorAdvice(hexes: string[]): { note: MflLiveAppLogoColorNote } {
  if (hexes.length < 2) {
    return {
      note: {
        tone: 'good',
        text: `${capital(colorName(hexes[0] ?? DEFAULT_LOGO_CHOICE.colors[0]))} with ${neutralsFor(hexes).join(' and ')} is a classic look.`,
      },
    };
  }
  const [a, b, c] = hexes;
  const ratio = contrastRatio(a, b);
  if (ratio < LOGO_MIN_CONTRAST) {
    return {
      note: {
        tone: 'weak',
        text:
          `${capital(colorName(a))} and ${colorName(b)} are too close to tell apart on a small logo ` +
          `(${ratio.toFixed(1)}:1, aim for 3:1). Swap one for a much lighter or darker color, or tap a suggestion.`,
      },
    };
  }
  if (c && Math.max(contrastRatio(c, a), contrastRatio(c, b)) < LOGO_MIN_CONTRAST) {
    return {
      note: {
        tone: 'weak',
        text:
          `${capital(colorName(c))} is too close to both ${colorName(a)} and ${colorName(b)} to stand out on a small logo. ` +
          'Swap it for a much lighter or darker color, or tap a suggestion.',
      },
    };
  }
  return { note: { tone: 'good', text: 'Good contrast: these colors stay distinct even when the logo is tiny.' } };
}

/**
 * Icons are pictures only: our site shows team marks, never
 * wordmarks, and image tools add the team name in big letters unless told not
 * to (Brandon, 2026-10-29). The banner is the one kind that asks for the name.
 */
const NO_TEXT_RULE =
  'Do not write the team name or any other words, letters or numbers anywhere in the logo: it is a picture-only mark.';

/**
 * One stylized letter is a graphic, not text (Brandon, 2026-10-29: "an M or
 * an S, which is a great way to incorporate a letter and a logo in one"), and
 * so are two letters interlocked into one symbol, the way a city's cap logo
 * joins its initials: "we really just want one symbol". A word is what fails,
 * because it cannot be read once the logo is shrunk. So a monogram, or an idea
 * that asks for a letter ("a stylized M"), gets letters that form ONE symbol;
 * the flat no-letters rule contradicted both.
 */
const INITIALS_RULE =
  'The letters must form one symbol: a single stylized initial, or two initials interlocked into one mark. Do not write the team name or any other words, letters or numbers in the logo.';

/** The owner's idea asks for a letter in the mark: "a stylized M", "initials", "monogram". */
export function ideaAsksForInitials(idea: string): boolean {
  return /\b(?:letter|letters|initial|initials|monogram|interlocking|interlocked)\b/i.test(idea) || /\b(?:stylized|stylised|big|bold|block|script)\s+[A-Z]\b/.test(idea);
}

/**
 * Every prompt ends here. Team names riff on real players, clubs and news, and
 * Brandon wants the art to hint at them as much as possible (2026-10-30), so
 * the rule invites the reference and draws the line only at a real face and at
 * a team's actual marks.
 */
const ORIGINAL_RULE =
  'If the name or idea refers to a real player, team, celebrity or news moment, capture its spirit as strongly as you can ' +
  "(the joke, the moment, the personality, the colors), but never draw a real person's face or likeness, " +
  'and do not copy or resemble any NFL, college or professional team logo, helmet, uniform, shield or wordmark.';

/**
 * The prompt for one set of choices. `colors` is already phrased ("crimson
 * #B3122E and gold #F2B705"), so the Brand Book can pass a `[colors]`
 * placeholder through the same sentence. `neutrals` is what the logo may use
 * on top of them: white and black unless the owner picked one as a team color.
 */
export function writeLogoPrompt(input: {
  teamName: string;
  idea: string;
  stylePhrase: string;
  colors: string;
  kind: MflLiveAppLogoKind;
  neutrals?: string[];
  /** A sentence about the real player or club the name nods to (`referencePromptLine`). */
  reference?: string;
  /** The mark is built on the team's initials (`INITIALS_RULE`), not a picture alone. */
  initials?: boolean;
}): string {
  const { teamName, idea, stylePhrase, kind, neutrals = ['white', 'black'], initials = false } = input;
  const rule = input.reference ? `${input.reference} ${ORIGINAL_RULE}` : ORIGINAL_RULE;
  const subject = idea ? `${idea}, drawn as ${stylePhrase}` : stylePhrase;
  const uses = kind === 'banner' ? 'outlines, lettering and contrast' : 'outlines and contrast';
  const colors = neutrals.length
    ? `${input.colors}, plus ${neutrals.join(' and ')} wherever the logo needs ${neutrals.length > 1 ? 'them' : 'it'} for ${uses}`
    : input.colors;
  if (kind === 'banner') {
    return (
      `Design a wide team banner for a fantasy football team called "${teamName}". ` +
      `On the left, the team logo: ${subject}. To its right, the team name in big, bold letters. ` +
      `Flat vector style, bold simple shapes, thick clean outlines, colors: ${colors}. ` +
      'No gradients, no photo textures. Transparent background, 1900 × 316 pixels (6:1), ' +
      `with the logo and name filling the height. ${rule}`
    );
  }
  return (
    `Design a sports team logo for a fantasy football team called "${teamName}": ${subject}. ` +
    `Flat vector style, bold simple shapes, thick clean outlines, colors: ${colors}. ` +
    'No gradients, no photo textures. Centered on a transparent background, ' +
    'square 1024 × 1024, with some empty space around the edges. ' +
    `It must stay recognizable when shrunk to 40 pixels. ${initials ? INITIALS_RULE : NO_TEXT_RULE} ${rule}`
  );
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
  const reference = findLogoReference(teamName, idea);

  return {
    choice: { teamName, idea, style: style.id, colors, kind },
    prompt: writeLogoPrompt({
      teamName,
      idea,
      stylePhrase: style.phrase,
      colors: colorsText(colors),
      kind,
      neutrals: neutralsFor(colors),
      reference: reference && referencePromptLine(reference),
      initials: style.id === 'monogram' || ideaAsksForInitials(idea),
    }),
    warning: reference && referenceNote(reference),
    colorNote: logoColorAdvice(colors).note,
  };
}

/** The choices as the app lists them (no prompt wording leaves the server). */
export function logoPromptOptions() {
  return {
    styles: LOGO_STYLES.map(({ id, label, hint }) => ({ id, label, hint })),
    colors: LOGO_COLORS,
    suggestions: LOGO_COLOR_SUGGESTIONS,
    trios: LOGO_COLOR_TRIOS,
    maxColors: LOGO_MAX_COLORS,
    kinds: LOGO_KINDS,
  };
}
