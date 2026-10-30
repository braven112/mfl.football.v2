/**
 * The team logo prompt builder — what `/api/mfl-live/logo-prompt` answers the
 * MFL Football app.
 *
 * The app does not make images. It helps an owner write a prompt for an AI
 * image tool they already use (ChatGPT, Gemini) or an SVG for Claude, wrapped
 * in our logo rules so the result works at our sizes and stays an original
 * mark. Every word of the prompt is the SERVER's (`src/utils/team-logo-prompt.ts`);
 * the app shows the choices it is sent and the prompt it gets back.
 *
 * Types only, no runtime code — the app imports this with `import type`, and
 * the server's builder is typed against it.
 */

export type MflLiveAppLogoKind = 'icon' | 'banner' | 'svg';

/** One tappable choice: a style or a kind of artwork. */
export interface MflLiveAppLogoOption<Id extends string = string> {
  id: Id;
  label: string;
  /** A style's one-line description, in plain words. */
  hint?: string;
}

/** One color in the grid the owner picks from. */
export interface MflLiveAppLogoColor {
  name: string;
  /** `#RRGGBB`. */
  hex: string;
}

/** A one-tap suggestion: a pair that clears 3:1, or a trio whose third color clears 3:1 against one of the others. */
export interface MflLiveAppLogoSuggestion {
  label: string;
  hexes: string[];
}

/** Whether the picked colors work together, in a sentence. */
export interface MflLiveAppLogoColorNote {
  /** good: distinct; weak: two are too close; tip: kept for older app builds (one color is now "good"). */
  tone: 'good' | 'weak' | 'tip';
  text: string;
}

/** The owner's choices, as the app sends them. */
export interface MflLiveAppLogoChoice {
  /** The team name to draw. Empty means the team's MFL name. */
  teamName?: string;
  /** Mascot or idea, free text. Trimmed to 120 characters by the server. */
  idea?: string;
  style: string;
  /** One to three `#RRGGBB` team colors, main color first: from the grid or typed by the owner. Either may be white or black; the prompt offers whichever of those is not picked. */
  colors: string[];
  kind: MflLiveAppLogoKind;
}

/** `GET /api/mfl-live/logo-prompt?league=<id>` and the POST's answer. */
export interface MflLiveAppLogoPrompt {
  ok: true;
  /** The team's name on MFL, to pre-fill the field. */
  teamName: string;
  styles: MflLiveAppLogoOption[];
  /** The color grid. Any other hex the owner types is accepted too. */
  colors: MflLiveAppLogoColor[];
  /** Colour sets that read well together, shown above the grid. */
  suggestions: MflLiveAppLogoSuggestion[];
  /** Ready-made three-color sets, for an owner who wants a third color. */
  trios?: MflLiveAppLogoSuggestion[];
  /** Most team colors an owner may pick (3). The prompt offers white and black on top. */
  maxColors: number;
  kinds: MflLiveAppLogoOption<MflLiveAppLogoKind>[];
  /** The choice this prompt was built from (the defaults on a GET). */
  choice: Required<MflLiveAppLogoChoice>;
  /** The finished prompt to copy or share. */
  prompt: string;
  /** How well the picked colors stand apart. */
  colorNote: MflLiveAppLogoColorNote;
  /** Set when the name or idea nods to a real NFL player or club: the prompt hints at it without copying a face or a team mark. */
  warning?: string;
}
