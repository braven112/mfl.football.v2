Start the dev server and provide a clickable localhost link to the page currently being worked on.

## Steps

1. **Identify the current page** — Figure out which page file is being worked on by checking:
   - The conversation context (what files were just edited or discussed)
   - If unclear, run `git diff --name-only` and look for `.astro` page files in `src/pages/`
   - If still unclear, ask the user which page they want to preview

2. **Start the dev server** — Use the `preview_start` MCP tool with name `"dev"` (configured in `.claude/launch.json`). If the server is already running, skip this step.

3. **Build the URL** — Convert the page file path to a localhost URL:
   - Strip `src/pages/` prefix
   - Strip `.astro` extension
   - Strip `/index` suffix (index pages map to the directory root)
   - Prepend `http://localhost:4322/`
   - Examples:
     - `src/pages/theleague/rosters.astro` → `http://localhost:4322/theleague/rosters`
     - `src/pages/theleague/index.astro` → `http://localhost:4322/theleague`
     - `src/pages/index.astro` → `http://localhost:4322/`
     - `src/pages/theleague/whats-new/index.astro` → `http://localhost:4322/theleague/whats-new`

4. **Output the link** — Print the URL as a clickable markdown link. Keep it short:
   ```
   **→ [http://localhost:4322/theleague/rosters](http://localhost:4322/theleague/rosters)**
   ```
