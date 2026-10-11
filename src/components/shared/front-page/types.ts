/**
 * The front-page homepage's view model: everything a league's adapter resolves
 * before the components render (src/utils/front-page.ts builds the stories;
 * the adapter adds art and links). The components hold markup only, so any
 * league — classic or package — can render this style by building one of these.
 */
import type { FrontStory, ScoreStrip, WireItem } from '../../../utils/front-page';

/** One franchise's art, resolved server-side for both kinds of surface. */
export interface FrontTeamArt {
  franchiseId: string;
  name: string;
  /** The theme-following mark, for cards and lists (swapped in dark mode site-wide). */
  icon: string;
  /** The franchise's own colours, for surfaces dark in both themes. */
  gradient: string;
  /** The crest for those dark surfaces ('' when the team has no art). */
  crest: string;
  crestFilter?: string;
  /** The crest is a banner crop: draw it as a circle. */
  round: boolean;
  href: string;
  /** "4-1", for strips and bands. */
  record?: string;
}

export interface FrontPlayerArt {
  name: string;
  /** ESPN's transparent cut-out, drawn straight on the franchise's colours. */
  headshot: string;
}

export interface TeamBandModel {
  team: FrontTeamArt;
  /** "2nd in the Payton Manning Division". */
  standing: string;
  week: number | null;
  /** This week's opponents (two in a doubleheader). */
  opponents: FrontTeamArt[];
  links: Array<{ label: string; href: string }>;
}

export interface RaceEntry {
  place: number;
  team: FrontTeamArt;
  line: string;
  star: FrontPlayerArt | null;
}

export interface FrontPageModel {
  leagueName: string;
  strip: ScoreStrip | null;
  stripHref: string | null;
  band: TeamBandModel | null;
  signInHref: string | null;
  lead: FrontStory | null;
  headlines: FrontStory[];
  cards: FrontStory[];
  race: RaceEntry[];
  raceTitle: string;
  raceHref: string;
  wire: WireItem[];
  teams: Record<string, FrontTeamArt>;
  /**
   * The league's own mark, for a story about no team in particular: `light`
   * for a theme-following card, `dark` for the story art (dark in both themes).
   */
  leagueMark: { light: string; dark: string };
  /**
   * When each story was written, in the viewer's clock (`formatForViewer`):
   * `line` for the lead ("Wed 2:07 PM PT"), `day` for a headline ("Wed").
   * Keyed by story id; resolved by the adapter, which can read the viewer.
   */
  times: Record<string, { line: string; day: string }>;
}
