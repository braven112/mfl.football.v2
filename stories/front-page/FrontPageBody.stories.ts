import FrontPageBody from '../../src/components/shared/front-page/FrontPageBody.astro';
import { themeModes } from '../../.storybook/modes';
import { guestModel, rivalryOverlays, signedInModel } from '../fixtures/front-page';

/**
 * The front-page homepage style (registry `homeStyle: 'front-page'`, Archie's
 * first): score strip, the viewer's team band, a lead story beside the
 * headlines, story cards, the race and the NFL wire. One story renders every
 * piece of the style, so it doubles as the showcase a prospective league is
 * shown next to the classic homepage.
 */
export default {
  title: 'Shared/Front page/Home',
  component: FrontPageBody,
  parameters: { layout: 'fullscreen', chromatic: { modes: themeModes } },
};

const base = { cardsTitle: "This week in Archie's", overlays: rivalryOverlays, wireHref: '#news' };

/** A signed-in owner in a doubleheader week: two rivalries pinned to the headlines. */
export const SignedIn = { args: { ...base, model: signedInModel } };

/** A visitor: the band becomes a sign-in prompt and the strip shows the top games. */
export const Guest = { args: { ...base, model: guestModel } };
