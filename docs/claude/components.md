# Component Patterns

## Framework Overview

This codebase uses **Astro** as the primary framework with **React** for interactive components.

- **Astro pages** (`.astro`) - Server-rendered, static pages
- **Astro components** (`.astro`) - Reusable server-side components
- **React components** (`.tsx`) - Client-side interactivity

## Astro Page Structure

```astro
---
// Frontmatter: Server-side JavaScript (runs at build time)
import Layout from '../../layouts/TheLeagueLayout.astro';
import data from '../../data/theleague/rosters.json';

export const prerender = true; // Static generation

// Process data
const processedData = data.rosters.franchise.map(/* ... */);
---

<!-- Template: HTML with Astro expressions -->
<Layout title="Page Title">
  <main>
    {processedData.map(item => (
      <div>{item.name}</div>
    ))}
  </main>
</Layout>

<style>
  /* Scoped styles - only apply to this component */
  main {
    padding: 2rem;
  }
</style>
```

## Layouts

### TheLeague Layout
```typescript
import TheLeagueLayout from '../../layouts/TheLeagueLayout.astro';
```
Used for all TheLeague pages. Includes navigation, header, footer.

### AFL Layout
```typescript
import AflLayout from '../../layouts/AflLayout.astro';
```
Used for all AFL Fantasy pages.

## React Integration

### Adding Client-Side Interactivity
```astro
---
import MyReactComponent from '../components/MyReactComponent';
---

<!-- client:load - Hydrate immediately on page load -->
<MyReactComponent client:load data={someData} />

<!-- client:visible - Hydrate when visible in viewport -->
<MyReactComponent client:visible data={someData} />

<!-- client:idle - Hydrate when browser is idle -->
<MyReactComponent client:idle data={someData} />
```

### React Component Example
```tsx
// src/components/MyComponent.tsx
interface Props {
  data: SomeType[];
  onAction?: (id: string) => void;
}

export default function MyComponent({ data, onAction }: Props) {
  const [state, setState] = useState(initialState);

  return (
    <div className="my-component">
      {/* Component JSX */}
    </div>
  );
}
```

## Common Patterns

### Data Fetching in Astro
```astro
---
// Import JSON data directly (resolved at build time)
import rostersData from '../../data/theleague/rosters.json';
import playersData from '../../data/theleague/players.json';

// Or fetch dynamically (for SSR pages)
const response = await fetch('https://api.example.com/data');
const data = await response.json();
---
```

### Conditional Rendering
```astro
{condition && <div>Shown when true</div>}

{condition ? (
  <div>True case</div>
) : (
  <div>False case</div>
)}
```

### Mapping Arrays
```astro
{items.map((item, index) => (
  <div key={item.id || index}>
    {item.name}
  </div>
))}
```

## Styling Approaches

### Scoped Styles (Preferred)
```astro
<style>
  /* Automatically scoped to this component */
  .card {
    padding: 1rem;
    border-radius: 8px;
  }
</style>
```

### Global Styles
```astro
<style is:global>
  /* Applies globally - use sparingly */
  body {
    font-family: system-ui;
  }
</style>
```

### CSS Variables
Use CSS custom properties defined in global styles:
```css
.card {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}
```

### Shadow System

Our shadow tokens use a **layered shadow** approach based on [Josh Comeau's shadow design principles](https://www.joshwcomeau.com/css/designing-shadows/).

#### Key Principles

| Principle | Implementation |
|-----------|----------------|
| **Layered depth** | Multiple shadow layers, each doubling offset/blur |
| **Directional light** | 1:2 horizontal:vertical ratio (simulates overhead light) |
| **Tinted color** | `220deg` blue hue instead of pure black |
| **Opacity scaling** | Lower opacity per layer as elevation increases |

#### Available Tokens

| Token | Layers | Use Case |
|-------|--------|----------|
| `--shadow-sm` | 1 | Subtle elevation (buttons, inputs) |
| `--shadow-md` | 3 | Moderate elevation (cards, dropdowns) |
| `--shadow-lg` | 5 | High elevation (modals, popovers) |
| `--shadow-xl` | 6 | Maximum elevation (dialogs, overlays) |

#### Usage
```css
.card {
  box-shadow: var(--shadow-md);
}

.modal {
  box-shadow: var(--shadow-lg);
}
```

#### Customizing Shadow Color

The `--shadow-color` variable controls the shadow tint. Override it for different contexts:

```css
/* Default blue tint */
--shadow-color: 220deg 3% 15%;

/* Warmer tint for accent sections */
.warm-section {
  --shadow-color: 30deg 5% 20%;
}

/* Neutral gray for dark mode */
.dark-mode {
  --shadow-color: 0deg 0% 10%;
}
```

#### Why Layered Shadows?

Single-layer shadows look flat and artificial. Layered shadows mimic how real light behaves:

```css
/* ❌ Flat, artificial */
box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);

/* ✅ Realistic depth (--shadow-lg) */
box-shadow:
  1px 2px 2px hsl(var(--shadow-color) / 0.15),
  2px 4px 4px hsl(var(--shadow-color) / 0.15),
  4px 8px 8px hsl(var(--shadow-color) / 0.15),
  8px 16px 16px hsl(var(--shadow-color) / 0.15),
  16px 32px 32px hsl(var(--shadow-color) / 0.15);
```

#### Performance Note

Layered shadows increase rendering load. Avoid animating shadow tokens directly. Instead, use opacity or transform animations on the element itself.

## Editorial Design Standard

All new pages and components must follow the **editorial design language** established by the PlayerDetailsModal and related modal components. This creates a consistent, data-dense, sports-editorial feel across the site.

**Canonical reference:** `src/components/shared/PlayerDetailsModal.astro`
**Full pattern catalog:** `docs/claude/insights/domains/design-system.md` (search "Editorial Design Standard")

### Quick Reference

**Section titles** — The signature editorial element:
```css
font-size: var(--font-size-xs);
font-weight: 700;
text-transform: uppercase;
letter-spacing: var(--tracking-caps);
padding-left: 0.625rem;
border-left: 2px solid var(--color-primary, #1c497c);
```

The 2px left stripe is a DELIBERATE house-style exception. Impeccable's design
guidance (and much "AI slop" critique) bans coloured side-stripe borders; this
repo keeps it on editorial section titles only, by decision (Sep 2026). Don't
spread it to cards, callouts or list items.

**Typography scale** (most commonly used):
| Role | Size | Weight |
|------|------|--------|
| Page/hero title | 1.35rem | 700 |
| Section title | `--font-size-xs` (0.75rem) | 700, uppercase |
| Body text | `--font-size-sm` (0.875rem) | 400–500 |
| Detail label | `--font-size-xs` (0.75rem) | 600, uppercase, gray-400 |
| Micro label | `--font-size-2xs` (0.6875rem) | 600, uppercase |
| Table header | `--font-size-3xs` (0.625rem) | 600, uppercase, gray-400 |

Every uppercase role above also takes `letter-spacing: var(--tracking-caps)`.

**Key metrics** — 3-column grid with gray-50 background cards, tabular-nums values

**Detail rows** — Flex rows with fixed-width right-aligned labels (4.5rem) and flexible values, separated by gray-50 borders

**Tables** — Sticky uppercase headers (gray-50 bg, gray-400 text), hover rows, tabular-nums, color-coded values

**Badges/pills** — Rounded (`radius-full`), gray-100 bg, 0.8125rem, weight 600. Semantic variants use light bg + dark text pairs.

**Numbers** — Always use `font-variant-numeric: tabular-nums` for alignment

**Defensive CSS** — Always include fallback values: `var(--color-gray-700, #374151)`

### Page Layout Checklist

When building a new page following the editorial standard:

- [ ] Section titles use uppercase + left border accent pattern
- [ ] Typography follows the scale above (no ad-hoc sizes)
- [ ] Numbers use `tabular-nums`
- [ ] Colors reference tokens with fallbacks
- [ ] Tables use sticky headers with uppercase gray-400 labels
- [ ] Mobile (≤640px) reduces padding and hides low-priority columns
- [ ] Interactive selections use left border accent + subtle gradient
- [ ] Shadows use token scale (`--shadow-sm` through `--shadow-xl`)

---

## Component Organization

```
src/components/
├── shared/              # Rendered by MORE THAN ONE league (or by a shared
│   │                    # layout) — site chrome, theme helpers, page bodies
│   ├── PlayerCell.astro
│   ├── ThemeToggle.astro
│   ├── lineup/LineupPage.astro
│   └── standings/StandingsTable.astro
├── theleague/           # Rendered by TheLeague ALONE
├── afl/  afl-fantasy/   # Rendered by the AFL alone
├── keeper/  best-ball/  bigleague/
├── nav/  schefter/      # Feature folders
└── (no loose files)     # tests/components-root-guard.test.ts
```

A component moves to `shared/` in the change that gives it a second
league. Nothing lives loose at the root of `src/components/`.

## Props Typing

### Astro Components
```astro
---
interface Props {
  title: string;
  items: Item[];
  showHeader?: boolean;
}

const { title, items, showHeader = true } = Astro.props;
---
```

### React Components
```tsx
interface Props {
  data: DataType;
  onSelect: (id: string) => void;
  className?: string;
}

export default function Component({ data, onSelect, className }: Props) {
  // ...
}
```

## Team Name Display

Always use `chooseTeamName()` for team names to prevent overflow:

```typescript
import { chooseTeamName } from '../../utils/team-names';

// Object format (recommended)
const displayName = chooseTeamName({
  fullName: team.name,
  nameMedium: assets?.nameMedium,
  nameShort: assets?.nameShort,
  abbrev: assets?.abbrev
}, 'default'); // 'default' | 'short' | 'abbrev'
```

See CLAUDE.md for complete team name display standards.

## Player Display (Player Lockup)

All player lists, cards, and tables **must** use the standard Player Lockup pattern.
See **CLAUDE.md > Player Display** for the full specification.

**Component:** `src/components/shared/PlayerCell.astro`

**Quick checklist:**
- [ ] Using `PlayerCell.astro` (or React equivalent for `.tsx` contexts)?
- [ ] DEF players: avatar = team logo, nflLogo = undefined?
- [ ] NFL codes normalized via `normalizeTeamCode()`?
- [ ] Logo path: `/assets/nfl-logos/${normalizeTeamCode(code)}.svg`?

**Existing implementations for reference:**
- Roster table: `src/pages/theleague/rosters.astro` (lines ~5890-5894, DEF swap logic)
- Potential Targets: `src/components/shared/FreeAgentNeedsCard.astro`
- Trade builder: `src/components/theleague/trade-builder/PlayerCard.tsx`
- Free agents table: `src/pages/theleague/players.astro` (inline p-row pattern)
