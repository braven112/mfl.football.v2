/**
 * Loading HTML builders — client-side string equivalents of the Astro
 * loading components, for code that builds markup in `<script>` tags.
 *
 * These emit the SAME class names as `src/styles/loading.css` and the
 * `src/components/shared/loading/*` components, so the shared stylesheet
 * applies identically. Kept in lockstep with the Astro components by
 * convention (mirrors the PlayerCell.astro / player-cell-html.ts pattern).
 *
 * See docs/claude/loading-standards.md.
 */

/** Escape a string for safe interpolation into an HTML attribute or text node. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SpinnerOptions {
  size?: 'compact' | 'default' | 'large';
  label?: string;
  class?: string;
}

/** Tier 2/3 spinner. Mirrors Spinner.astro. */
export function buildSpinnerHTML(opts: SpinnerOptions = {}): string {
  const { size = 'default', label = 'Loading', class: className = '' } = opts;
  const sizeClass =
    size === 'compact' ? 'loading-spinner--compact' :
    size === 'large' ? 'loading-spinner--large' : '';
  const cls = ['loading-spinner', sizeClass, className].filter(Boolean).join(' ');
  return `<span class="${cls}" role="status" aria-live="polite" aria-label="${esc(label)}"></span>`;
}

export interface SkeletonOptions {
  variant?: 'block' | 'text' | 'title' | 'circle';
  width?: string;
  height?: string;
  radius?: string;
  count?: number;
  label?: string;
  class?: string;
}

/** Tier 4 skeleton. Mirrors Skeleton.astro. */
export function buildSkeletonHTML(opts: SkeletonOptions = {}): string {
  const {
    variant = 'block',
    width,
    height,
    radius,
    count = 1,
    label = 'Loading content',
    class: className = '',
  } = opts;

  const variantClass = variant !== 'block' ? `loading-skeleton--${variant}` : '';

  const styleParts: string[] = [];
  if (width) styleParts.push(`width:${width}`);
  if (height) styleParts.push(`--skeleton-height:${height}`);
  if (radius) styleParts.push(`--skeleton-radius:${radius}`);
  const styleAttr = styleParts.length ? ` style="${esc(styleParts.join(';'))}"` : '';

  const blockCls = ['loading-skeleton', variantClass].filter(Boolean).join(' ');

  if (count > 1) {
    const groupCls = ['loading-skeleton-group', className].filter(Boolean).join(' ');
    const blocks = Array.from({ length: count })
      .map(() => `<span class="${blockCls}"${styleAttr}></span>`)
      .join('');
    return `<div class="${groupCls}" role="status" aria-busy="true" aria-live="polite" aria-label="${esc(label)}">${blocks}</div>`;
  }

  const cls = [blockCls, className].filter(Boolean).join(' ');
  return `<span class="${cls}"${styleAttr} role="status" aria-busy="true" aria-live="polite" aria-label="${esc(label)}"></span>`;
}

export interface ThinkingDotsOptions {
  label?: string;
  class?: string;
}

/** Tier 5 thinking dots. Mirrors ThinkingDots.astro. */
export function buildThinkingDotsHTML(opts: ThinkingDotsOptions = {}): string {
  const { label, class: className = '' } = opts;
  const cls = ['loading-dots', className].filter(Boolean).join(' ');
  const text = label ? `<span class="loading-dots__text">${esc(label)}</span>` : '';
  return (
    `<span class="${cls}" role="status" aria-live="polite" aria-label="${esc(label ?? 'Working')}">` +
    text +
    `<span class="loading-dots__dots" aria-hidden="true">` +
    `<span class="loading-dots__dot"></span>` +
    `<span class="loading-dots__dot"></span>` +
    `<span class="loading-dots__dot"></span>` +
    `</span></span>`
  );
}
