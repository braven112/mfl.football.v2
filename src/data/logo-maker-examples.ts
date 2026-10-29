/**
 * The example logos on the free logo maker (`/fantasy-football-logo-maker`).
 *
 * Each one is a real logo an AI image tool made from this tool's prompt
 * (Brandon's, 2026-10-29: hand-drawn SVG stand-ins were rejected as not good
 * enough to sell the tool, so only real output goes here). "Use this prompt"
 * fills the builder with the same choices, so a visitor starts from a logo
 * they can already see.
 *
 * Text-free only (Brandon, 2026-10-29): the prompt forbids words on an icon,
 * so an example with the team name on it would teach the opposite. Empty
 * until one arrives; the page hides the section while it is.
 *
 * Never a real player's or club's name or mark (tests/logo-maker.test.ts
 * checks the names against the NFL warning and every color against the
 * tool's grid).
 */
import type { MflLiveAppLogoKind } from '../../packages/shared-types/src/mfl-live-app-logo';

export interface LogoMakerExample {
	teamName: string;
	idea: string;
	style: string;
	colors: string[];
	kind: MflLiveAppLogoKind;
	/** Under `public/`. */
	image: string;
	alt: string;
}

export const LOGO_MAKER_EXAMPLES: LogoMakerExample[] = [];
