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
}

/** One colour in the grid the owner picks from. */
export interface MflLiveAppLogoColor {
  name: string;
  /** `#RRGGBB`. */
  hex: string;
}

/** A one-tap colour set whose colours all clear 3:1 against each other. */
export interface MflLiveAppLogoSuggestion {
  label: string;
  hexes: string[];
}

/** Whether the picked colours work together, in a sentence. */
export interface MflLiveAppLogoColorNote {
  /** good: distinct; weak: two are too close; tip: one colour only. */
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
  /** One to three `#RRGGBB` colours, main colour first: from the grid or typed by the owner. */
  colors: string[];
  kind: MflLiveAppLogoKind;
}

/** `GET /api/mfl-live/logo-prompt?league=<id>` and the POST's answer. */
export interface MflLiveAppLogoPrompt {
  ok: true;
  /** The team's name on MFL, to pre-fill the field. */
  teamName: string;
  styles: MflLiveAppLogoOption[];
  /** The colour grid. Any other hex the owner types is accepted too. */
  colors: MflLiveAppLogoColor[];
  /** Colour sets that read well together, shown above the grid. */
  suggestions: MflLiveAppLogoSuggestion[];
  /** Most colours an owner may pick: a logo needs two or three to read when small. */
  maxColors: number;
  kinds: MflLiveAppLogoOption<MflLiveAppLogoKind>[];
  /** The choice this prompt was built from (the defaults on a GET). */
  choice: Required<MflLiveAppLogoChoice>;
  /** The finished prompt to copy or share. */
  prompt: string;
  /** How well the picked colours stand apart. */
  colorNote: MflLiveAppLogoColorNote;
  /** Set when the name or idea reads like an NFL club, which the art must not copy. */
  warning?: string;
}
