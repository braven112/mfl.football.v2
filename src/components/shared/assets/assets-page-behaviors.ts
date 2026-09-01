/**
 * Asset-library page behaviors — team filter, image dimensions, copy buttons.
 *
 * Extracted from a 101-line `is:inline` block in AssetsPage.astro. It is a
 * BUNDLED module now, which buys three things the inline version could not
 * have: TypeScript (so `astro check` covers it and the type baseline counts
 * it), imports, and module scope.
 *
 * It is deliberately NOT a React island. The DOM it drives — team cards, asset
 * cards, copy buttons — is server-rendered across the whole page and no single
 * component owns it; making an island own it would mean re-rendering static
 * markup on the client for nothing. The rule is in
 * docs/claude/rules/client-data.md: an island when a component owns the state,
 * a bundled module when the page is server-rendered and the script is
 * progressive enhancement. Inline is neither.
 *
 * **ClientRouter is the thing to get right here.** A module is evaluated once
 * per session, so anything done at module scope does NOT re-run when the owner
 * soft-navigates back to this page — and the elements it bound to were
 * replaced during the swap. So:
 *
 *   - per-element wiring runs on every `astro:page-load` (which also fires on
 *     the first load, so there is no separate init path);
 *   - document-level delegation registers exactly ONCE, guarded by a module
 *     -scope flag. The inline version needed `window.__assetCopyDelegation`
 *     for this because it had no module scope to keep a flag in; re-running it
 *     without that guard stacked a duplicate click handler per navigation.
 */

const COPIED_MS = 1500;

/** Fields a team card can be matched on. All are stamped as data attributes. */
const TEAM_HAYSTACK = ['name', 'franchiseId', 'conference', 'division', 'tier', 'aliases'] as const;

function filterTeamCards(query: string): void {
  const needle = query.trim().toLowerCase();
  // Array.from, not spread or a bare for-of: this repo's tsconfig lib is
  // ["ES2022", "DOM"] without "DOM.Iterable", so a NodeList is not iterable to
  // the type-checker even though it is at runtime. Same reason below.
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.team-grid .team-card'));

  for (const card of cards) {
    const haystack = [...TEAM_HAYSTACK.map((k) => card.dataset[k]), card.id]
      .join(' ')
      .toLowerCase();
    card.style.display = needle === '' || haystack.includes(needle) ? '' : 'none';
  }

  // Hide a section header once the filter has emptied its grid — a lone
  // heading over nothing reads as a broken page rather than an empty result.
  const sections = Array.from(
    document.querySelectorAll<HTMLElement>('.library-section--teams'),
  );
  for (const section of sections) {
    const anyVisible = Array.from(
      section.querySelectorAll<HTMLElement>('.team-card'),
    ).some((card) => card.style.display !== 'none');
    section.style.display = anyVisible ? '' : 'none';
  }
}

function dimensionsSlot(img: HTMLImageElement): HTMLElement | null {
  return img.closest('.asset-card')?.querySelector<HTMLElement>('.asset-dimensions') ?? null;
}

function showDimensions(img: HTMLImageElement): void {
  const slot = dimensionsSlot(img);
  if (!slot) return;
  // A decoded image with no intrinsic size is a real state (a broken SVG, an
  // HTML error page served as an image), and it is not the same as "failed to
  // load" — say so rather than printing "0 × 0px".
  slot.textContent =
    img.naturalWidth && img.naturalHeight
      ? `${img.naturalWidth} × ${img.naturalHeight}px`
      : 'Size unavailable';
}

function wireDimensions(): void {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('.asset-card img'));
  for (const img of images) {
    if (img.complete && img.naturalWidth) {
      showDimensions(img);
      continue;
    }
    img.addEventListener('load', () => showDimensions(img), { once: true });
    img.addEventListener(
      'error',
      () => {
        const slot = dimensionsSlot(img);
        if (slot) slot.textContent = 'Failed to load';
      },
      { once: true },
    );
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // http:// dev fallback — the clipboard API requires a secure context.
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.style.position = 'fixed';
  scratch.style.opacity = '0';
  document.body.appendChild(scratch);
  scratch.select();
  document.execCommand('copy');
  scratch.remove();
}

/** Per-button "Copied" timers, so a rapid second click restarts the window. */
const copiedTimers = new WeakMap<HTMLElement, number>();

function onDocumentClick(event: MouseEvent): void {
  const btn = (event.target as HTMLElement | null)?.closest<HTMLElement>('.copy-btn');
  const value = btn?.dataset.copy;
  if (!btn || !value) return;

  void copyText(value)
    .then(() => {
      btn.classList.add('copied');
      const pending = copiedTimers.get(btn);
      if (pending !== undefined) window.clearTimeout(pending);
      copiedTimers.set(
        btn,
        window.setTimeout(() => btn.classList.remove('copied'), COPIED_MS),
      );
      const status = document.getElementById('copy-status');
      if (status) {
        status.textContent = (btn.getAttribute('aria-label') || 'Copy').replace('Copy', 'Copied');
      }
    })
    .catch(() => {
      // Clipboard denied. The URL input stays selectable by hand, so there is
      // a way through — announcing a failure here would be noise.
    });
}

function onDocumentFocusIn(event: FocusEvent): void {
  const target = event.target as HTMLElement | null;
  if (target instanceof HTMLInputElement && target.matches('.asset-meta input[type="text"]')) {
    target.select();
  }
}

/**
 * Module scope, not a window global: this module is evaluated once per session,
 * so the flag survives every soft navigation without leaking a name onto
 * `window` for another script to collide with.
 */
let delegationRegistered = false;

function registerDelegationOnce(): void {
  if (delegationRegistered) return;
  delegationRegistered = true;
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('focusin', onDocumentFocusIn);
}

/** Re-runs on every navigation into this page; safe to call repeatedly. */
export function initAssetsPage(): void {
  const input = document.querySelector<HTMLInputElement>('#team-filter');
  if (input) {
    // The value survives a bfcache restore, so apply it rather than assuming
    // the box is empty.
    filterTeamCards(input.value);
    input.addEventListener('input', () => filterTeamCards(input.value));
  }
  wireDimensions();
  registerDelegationOnce();
}

// `astro:page-load` fires on the first load AND after every ClientRouter swap,
// so this is the only entry point needed.
document.addEventListener('astro:page-load', initAssetsPage);
