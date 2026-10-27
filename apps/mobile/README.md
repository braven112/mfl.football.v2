# MFL Football — the mobile app

Expo (React Native) app for any MyFantasyLeague owner. Plan of record:
`docs/plans/mfl-live-store-app.md`.

- **Two screens, no router:** MFL sign-in, then your live matchups across
  every league. The app talks only to our server (`mfl.football`), which
  reads MFL; it never calls MFL directly.
- **Store mode only:** the board is fetched with `?source=mfl` — MFL data
  only, per the store plan's Legal section. `tests/mfl-live-mobile-guard.test.ts`
  enforces it.
- **Its own install.** `apps/mobile` is excluded from the website's pnpm
  workspace and has its own `pnpm-workspace.yaml` + `pnpm-lock.yaml`, so React
  Native never enters the site's Vercel or CI install. Shared packages are
  reused through `import type` only (see `tsconfig.json` paths), which is
  erased at build time.
- **Builds run in the cloud** on Expo EAS (`eas.json`: `preview` = installable
  APK, `production` = signed AAB for Play). Nobody builds this on a computer.
- **Dependencies:** add them with `npx expo install <pkg>` from this folder so
  versions match the Expo SDK.
