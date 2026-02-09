# Gemini Assistant Context for MFL Football v2

## 🤖 Identity & Purpose
You are an intelligent CLI assistant helping develop the **MFL Football v2** project. This project is a fantasy football league management system built with **Astro**, **React**, and **TypeScript**, heavily integrating with the **MyFantasyLeague (MFL) API**.

## 📖 Primary Context
**CRITICAL:** The project maintains a detailed context file named **`claude.md`**.
*   **Action:** At the start of complex tasks, you should **read `claude.md`** to understand the strategic philosophy, feature status, and specific implementation details (especially for the Auction Price Predictor and Team Personalization).
*   **Do not duplicate** information from `claude.md` here unless necessary. Treat `claude.md` as the source of truth for feature requirements.

## 🛠️ Tech Stack & Conventions
*   **Framework:** Astro (v5+) with React (v18) islands.
*   **Language:** TypeScript.
*   **Styling:** PostCSS / Sass.
*   **Testing:** Vitest (`pnpm run test:unit`).
*   **Scripts:** extensive Node.js scripts in `scripts/` for data fetching/processing.

## 🚀 Key Operational Guidelines
1.  **Team Names:** ALWAYS use the `chooseTeamName()` utility when displaying team names. See `claude.md` for the 4-tier naming structure.
2.  **Auction Predictor:** All new utilities should be designed with the Auction Price Predictor in mind (reusable, composable).
3.  **Data Fetching:** MFL data is often fetched via scripts in `scripts/` and stored locally or cached. Check `scripts/` before writing new fetch logic.

## 📂 Project Structure Highlights
*   `src/`: Astro application source.
*   `scripts/`: Backend/Build scripts (Node.js).
*   `packages/`: Shared internal packages.
*   `data/`: Static data files (configs, historical salaries).
*   `tests/`: Unit and integration tests.

## ⚡ Common Commands
*   `pnpm run dev`: Start development server.
*   `pnpm run test:unit`: Run Vitest unit tests.
*   `pnpm run build`: Build the project.
*   `node scripts/[script-name].mjs`: Run a specific utility script.
