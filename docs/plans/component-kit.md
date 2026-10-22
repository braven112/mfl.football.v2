# Component kit — one look per building block, forks for the rest

Status: in progress (Oct 2026). Owner's plan doc:
<https://claude.ai/artifact/WnT8espNJNnHmreDLqeWvX>. Rules:
`docs/claude/rules/theming-and-assets.md` § "Component kit".

## Why

Consistency across components, without losing what makes this platform
different: every league can have its own version of anything. In Oct 2026 the
site carried ~110 hand-rolled badge classes, ~130 card classes, ~22 tab sets,
~20 modal shells and 81 files styling their own `<table>`, each restating the
same shape with its own padding and its own dark-mode colours.

shadcn/ui was considered and rejected: it is React + Tailwind + Radix, and
this repo is ~600 `.astro` files to 126 `.tsx`, styled by CSS tokens with a
site-style layer (Editorial / Primetime) on top. It would have been a second
styling system. What it does well — accessible primitives — can still be
borrowed under a hard widget (combobox, popover) without its styling.

## The shape: a CSS class pattern, like `cta.css`

Each kit component is a global stylesheet of `:where()` rules (zero
specificity) imported by every base layout and by Storybook:

| Component | Stylesheet | Class | Guard |
| --- | --- | --- | --- |
| CTA (predates the kit) | `src/styles/cta.css` | `cta cta--primary` … | `tests/cta-pattern.test.ts` |
| Badge | `src/styles/badge.css` | `ui-badge`, `--caps`, `--inline`, tones | `tests/component-kit.test.ts` |
| Card | `src/styles/card.css` | `ui-card` | `tests/component-kit.test.ts` |

Why classes and not `.astro` components: the same markup is written in
`.astro` templates, React `className`s, and HTML strings that page scripts
build — and Astro's scoped CSS never reaches an element a script created. A
class works in all three.

Why `:where()`: a component's own class (`.seed-badge`) always out-ranks the
kit, so a page keeps its exact look by writing only what differs. That is
the mechanism behind the owner's two rules below.

## The two rules (owner's decisions, 2026-10-22)

1. **Props only when every league benefits.** A modifier (`ui-badge--caps`,
   a tone) is added to the kit only when it is useful to every league.
   Otherwise the league's version is a **fork**: its own class, written down
   in `tests/fixtures/component-kit-forks.json` with the reason. A fork may
   cover a whole league or one page within a league. Nothing it does touches
   anyone else.
2. **Migration is pixel-identical.** Moving a page onto the kit may not move
   a pixel. Where a page differs from the kit default, its own class keeps the
   difference (a prop if every league benefits, otherwise a fork).
3. **Modal, Tabs and Table unify instead (2026-10-22).** Their instances share
   too little for a pixel-identical kit, so the owner chose one look per
   component — the most common existing one — and every changed page goes in
   front of him as before/after phone screenshots, light and dark, before the
   PR merges. Rule 2 governs Badge and Card only.

A migrated badge's own rule therefore reads as a list of what differs:

```css
.seed-badge {
  /* Kit: ui-badge supplies the shared badge shape; what follows is this badge's own look. */
  padding: 0.2rem 0.55rem;
  font-size: 0.65rem;
}
```

## How a migration is verified

Pixel identity is checked mechanically, not by eye: every static page of every
league (plus one example of each dynamic route), in light and dark, signed in,
is loaded before and after, and the computed style and box size of every
element whose class names the component is compared. A migration lands only
when that diff is empty. (The harness lives outside the repo; the method is
what matters: compare computed styles of every instance across every page,
not screenshots of a few.)

## Order

Badge → Card → Modal → Tabs → Table, one component per PR. Migrations are
staged in the weekly changelog as internal polish (Fixes & polish), not as
features.

## Modal (shipped as the first unified kit)

`src/styles/modal.css`: `ui-modal` on the panel (or the `<dialog>`, whose
`::backdrop` is the scrim) and `ui-scrim` on a hand-built overlay. The kit
owns ground (`--card-bg`), ink, corner (`--radius-lg`), lift
(`--modal-shadow`: `--shadow-xl`, plus a hairline `--style-card-ring` in dark)
and the scrim (`--modal-scrim` with the mandated 2px blur). Width, padding,
position, the phone bottom sheet and the entrance animation stay each
component's own; a sheet squares its lower corners with
`var(--radius-lg) var(--radius-lg) 0 0`. What moved: corners from 8-12px and
24px to 16px, six different scrim tints became one (with the blur that four
of them lacked), outlines on the draft-room dialogs dropped, and the
trade-builder dialogs gained the dark-mode scrim they never had. The panel
lays `--card-bg` over the solid `--card-surface`, because some dark themes'
card gradient is translucent and the page showed through a `<dialog>`.

2. **Migration is pixel-identical.** Moving a page onto the kit may not move
   a pixel. Where a page differs from the kit default, its own class keeps the
   difference (a prop if every league benefits, otherwise a fork).
3. **Modal, Tabs and Table unify instead (2026-10-22).** Their instances share
   too little for a pixel-identical kit, so the owner chose one look per
   component — the most common existing one — and every changed page goes in
   front of him as before/after phone screenshots, light and dark, before the
   PR merges. Rule 2 governs Badge and Card only.


Fixes to the kit (a contrast fix in a tone, a Primetime surface change) do not
reach a fork. The registry is how that is managed: when the kit changes, the
registry lists who might want the change, and that league decides.
