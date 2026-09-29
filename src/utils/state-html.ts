/**
 * Empty / error state markup — ONE builder behind every surface.
 *
 * `EmptyState.astro`, `ErrorState.astro` and `states-react.tsx` render the
 * markup from this module, and client `<script>` code that builds markup at
 * runtime calls `buildEmptyStateHTML` / `buildErrorStateHTML` directly. The
 * class names are styled by the GLOBAL `src/styles/states.css`, so a state a
 * script injects looks identical to one the server rendered.
 *
 * Copy rules live in docs/claude/rules/theming-and-assets.md § "Empty and
 * error states". In short: say what is missing and when it fills (empty), or
 * what failed and how to recover (error); action labels are verb + object.
 */

export type StateKind = 'empty' | 'error';

export interface StateAction {
  /** Verb + object: "Set your lineup", "Try again" — never "OK" / "Submit". */
  label: string;
  /** Renders a link. Omit for a `<button>` a script wires up. */
  href?: string;
  /** Set on the button as `data-state-action`, for a script to find it. */
  id?: string;
}

export interface StateOptions {
  title: string;
  /** Optional second line. Plain text; escaped. */
  body?: string;
  actions?: StateAction[];
  /** Inside a card or a cell: no dashed panel, left-aligned. */
  compact?: boolean;
  /** Trusted SVG markup for the icon slot. NOT escaped — pass only literals. */
  iconSvg?: string;
  class?: string;
}

/** Escape a string for safe interpolation into an HTML attribute or text node. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Stroke icons, sized by `.ui-state__icon`. `currentColor` follows the theme. */
export const STATE_ICONS: Record<StateKind, string> = {
  empty:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13h4l2 3h6l2-3h4"/><path d="M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>',
};

/** The class list for a state's root element. */
export function stateClassName(kind: StateKind, opts: Pick<StateOptions, 'compact' | 'class'>): string {
  return ['ui-state', `ui-state--${kind}`, opts.compact ? 'ui-state--compact' : '', opts.class ?? '']
    .filter(Boolean)
    .join(' ');
}

/** An error is announced as it appears; an empty state is a quiet status. */
export function stateRole(kind: StateKind): 'alert' | 'status' {
  return kind === 'error' ? 'alert' : 'status';
}

function buildActionHTML(action: StateAction): string {
  if (action.href) {
    return `<a class="ui-state__action" href="${esc(action.href)}">${esc(action.label)}</a>`;
  }
  const idAttr = action.id ? ` data-state-action="${esc(action.id)}"` : '';
  return `<button type="button" class="ui-state__action"${idAttr}>${esc(action.label)}</button>`;
}

export function buildStateHTML(kind: StateKind, opts: StateOptions): string {
  const icon = opts.compact ? '' : `<span class="ui-state__icon">${opts.iconSvg ?? STATE_ICONS[kind]}</span>`;
  const body = opts.body ? `<p class="ui-state__body">${esc(opts.body)}</p>` : '';
  const actions = opts.actions?.length
    ? `<div class="ui-state__actions">${opts.actions.map(buildActionHTML).join('')}</div>`
    : '';
  return (
    `<div class="${esc(stateClassName(kind, opts))}" role="${stateRole(kind)}">` +
    `${icon}<p class="ui-state__title">${esc(opts.title)}</p>${body}${actions}</div>`
  );
}

export function buildEmptyStateHTML(opts: StateOptions): string {
  return buildStateHTML('empty', opts);
}

export function buildErrorStateHTML(opts: StateOptions): string {
  return buildStateHTML('error', opts);
}
