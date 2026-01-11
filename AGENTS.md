# Repository Guidelines

## Project Structure & Module Organization
- `src/` is the Astro app: routes in `src/pages/`, UI in `src/components/`, shared helpers in `src/utils/`, and client scripts in `src/scripts/`.
- `public/` holds static assets served as-is (images, icons, league assets).
- `packages/` contains shared TypeScript packages (`league-utils/`, `shared-utils/`, `shared-types/`, `mfl-data-fetcher/`).
- `tests/` houses Vitest suites plus `tests/e2e-cookie-test.mjs` for the lightweight E2E check.
- `scripts/` provides data sync/build tooling (salary updates, schedule/weather enrich, asset sync).
- `data/` and `src/data/` store MFL feeds and generated salary snapshots.

## Build, Test, and Development Commands
- `pnpm install`: install dependencies.
- `pnpm run dev`: start the Astro dev server.
- `pnpm run build`: run prebuild steps (styles, salary updates, live lineups) and build to `dist/`.
- `pnpm run preview`: serve the production build locally.
- `pnpm run test`: run unit + E2E (`vitest run` and `tests/e2e-cookie-test.mjs`).
- `pnpm run update:salary:all`: refresh salary averages for all leagues.

## Coding Style & Naming Conventions
- TypeScript + ESM (`"type": "module"`), 2-space indentation, semicolons, and named exports.
- Astro + React islands with PostCSS/Sass; keep component and utility names descriptive.
- Keep file names lowercase; tests use `*.test.ts` in `tests/`.
- Formatting appears ad hoc; no enforced formatter script. Match existing style in nearby files.

## Testing Guidelines
- Unit tests use Vitest; run `pnpm run test:unit` or `pnpm run test:watch` for watch mode.
- E2E smoke test: `pnpm run test:e2e`.
- Prefer naming tests by feature (e.g., `matchup-routing.test.ts`).

## Commit & Pull Request Guidelines
- Recent history follows Conventional Commit prefixes (`feat:`, `fix:`, `chore:`), with occasional short messages.
- Ralph automation uses `feat: [US-###] - Title` (see `scripts/ralph/README.md`).
- PRs should include a clear description, linked issue/PRD when relevant, and screenshots/GIFs for UI changes.

## Agent-Specific Instructions
- For complex tasks, read `claude.md` first; it is the source of truth for feature direction.
- Always use `chooseTeamName()` from `src/utils/team-names.ts` when displaying team names.
- New utilities should be reusable/composable and consider the Auction Price Predictor workflows.

## Security & Configuration Tips
- MFL data scripts accept env vars (see `README.md`); keep credentials in `.env` or shell, never in git.
- Generated data files live under `src/data/` and `data/`; avoid manual edits unless debugging.
