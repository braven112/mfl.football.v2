import { createElement } from 'react';
import type { ReactElement } from 'react';

/**
 * Every rule in draft-room.css hangs off a `.draft-room` ancestor (its tokens
 * live there too), so a story needs one. The real root is a full-viewport
 * flex column with `overflow: hidden` — right for the page, wrong for one
 * component on a canvas — so the wrapper resets it to natural height.
 */
export const draftRoomDecorator =
  (maxWidth?: string) =>
  (Story: () => ReactElement) =>
    createElement(
      'div',
      { className: 'draft-room', style: { height: 'auto', overflow: 'visible', ...(maxWidth ? { maxWidth } : {}) } },
      createElement(Story),
    );
