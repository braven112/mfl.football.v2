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

## Component Organization

```
src/components/
├── shared/              # Shared across leagues
│   ├── Card.astro
│   ├── Button.astro
│   └── DataTable.astro
├── theleague/           # TheLeague-specific
│   ├── RosterCard.astro
│   └── StandingsTable.astro
├── afl-fantasy/         # AFL-specific
│   └── DraftBoard.astro
└── AuthContext.tsx      # React context provider
```

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
