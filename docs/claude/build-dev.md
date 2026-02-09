# Build & Development Guide

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## NPM Scripts Reference

### Development
| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Astro dev server with hot reload |
| `pnpm test:watch` | Run tests in watch mode |

### Build & Deploy
| Command | Description |
|---------|-------------|
| `pnpm build` | Full production build (styles + packages + apps) |
| `pnpm build:apps` | Build Astro site only |
| `pnpm build:styles` | Build CSS/SCSS styles |
| `pnpm build:tools` | Build league tools bundle |

### Testing
| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests (unit + e2e) |
| `pnpm test:unit` | Run Vitest unit tests |
| `pnpm test:e2e` | Run e2e cookie tests |
| `pnpm test:coverage` | Run tests with coverage report |

### Data Sync & Fetch
| Command | Description |
|---------|-------------|
| `pnpm sync:all` | Sync assets for both leagues |
| `pnpm sync:theleague` | Sync TheLeague team assets from MFL |
| `pnpm sync:afl` | Sync AFL Fantasy team assets |
| `pnpm fetch:live:lineups` | Fetch current NFL lineup data |
| `pnpm fetch:live:odds` | Fetch current betting odds |
| `pnpm fetch:espn:schedule` | Fetch ESPN NFL schedule |
| `pnpm fetch:weather` | Enrich schedule with weather data |
| `pnpm update:salary:all` | Update salary averages for both leagues |

### Watchers
| Command | Description |
|---------|-------------|
| `pnpm watch:theleague` | Watch and sync TheLeague assets on change |
| `pnpm watch:afl` | Watch and sync AFL assets on change |

### Quality Checks
| Command | Description |
|---------|-------------|
| `pnpm check:bundle` | Check bundle size limits |
| `pnpm check:bundle:src` | Check src bundle size (runs on predeploy) |
| `pnpm type-check` | TypeScript type checking |

## Pre-build Steps (Automatic)

The `prebuild` script automatically runs before `build`:
1. `build:styles` - Compiles SCSS/CSS
2. `update:salary:all` - Updates salary calculation data
3. `fetch:live:lineups` - Gets current NFL lineups

## Environment Variables

Create `.env` file (see `.env.example`):

```bash
# MFL API Configuration
MFL_YEAR=2025
MFL_LEAGUE_ID=13522
MFL_API_KEY=your_api_key

# Optional: Override base year for testing
PUBLIC_BASE_YEAR=2025
```

## Directory Structure

```
mfl.football.v2/
├── src/
│   ├── pages/           # Astro pages (routes)
│   ├── layouts/         # Astro layouts
│   ├── components/      # UI components (Astro + React)
│   ├── utils/           # Utility functions
│   ├── data/            # Static data files
│   └── styles/          # Global styles
├── scripts/             # Build and data scripts
├── tests/               # Test files
├── data/                # League-specific data
│   └── afl-fantasy/     # AFL Fantasy data
└── public/              # Static assets
```

## Common Development Tasks

### Adding a New Page
1. Create `.astro` file in `src/pages/{league}/`
2. Use appropriate layout (`TheLeagueLayout` or `AflLayout`)
3. Set `export const prerender = true` for static pages

### Running Specific Scripts
```bash
# Direct script execution
node scripts/fetch-mfl-feeds.mjs

# With environment variables
MFL_LEAGUE_SLUG=theleague node scripts/update-salary-averages.mjs
MFL_LEAGUE_ID=19621 MFL_LEAGUE_SLUG=afl node scripts/update-salary-averages.mjs
```

### Testing Date-Dependent Features
Add `?testDate=YYYY-MM-DD` URL parameter to simulate different dates for year rollover logic.
