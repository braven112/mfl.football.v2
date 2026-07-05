# Dark-Mode Team Icons

Insights for the per-team dark-mode icon variant system
(`src/utils/team-icon-dark-css.ts`, `src/components/TeamIconDarkStyles.astro`,
`iconDark` field in the league configs).

---

## 2026-07-03 - One generated stylesheet beats touching 20 call sites

**Context:** Teams needed a different icon in dark mode (launch set: nine
teams — Dangsters, Maverick, Dead Cap Walking, Ninjas, Music City, Fire Ready
Aim, Bring The Pain, Wabbits, Computer Jocks), falling back to the regular
icon when no dark variant exists.

**Architecture decision:** Team icons render as plain `<img>` tags in ~20 call
sites spanning three paradigms — Astro components (standings tables,
TeamIconNav, snapshots), React components (trade builder, playoff hero), and
client-side HTML string builders (projected-free-agents, PlayerDetailsModal).
There is NO shared team-icon component. Instead of retrofitting one into every
call site, the swap is a single generated stylesheet:

- `buildTeamIconDarkCss(teams, { franchiseIconDir })` emits, per team with
  `iconDark`, `html.dark img[src="<exact icon src>"] { content: url("<dark>") }`.
- `TeamIconDarkStyles.astro` (included once in `TheLeagueLayout` head) runs it
  over BOTH league configs — exact-src selectors can't collide across leagues,
  so no league branching.
- Teams without `iconDark` get no rule → byte-identical rendering in both
  themes. Old browsers without `content` on `<img>` (pre-2023 Firefox) keep
  the light icon — graceful.

**Why CSS, not a server-side src pick:** with `theme_pref=auto` the server
cannot know the resolved theme; keying on `html.dark` means the swap always
follows the class the pre-paint `ThemeScript` resolves. (The league logo in
`Header.astro` still does an SSR pick off the cookie — known-wrong for 'auto',
owned by the dark-mode branch.)

**Gotcha — franchise-id icon aliases:** `/assets/theleague/icons/0002.png`
etc. are byte-identical copies of the named icons, and some code builds icon
paths from the franchise id directly (`PlayerDetailsModal` builds
`/assets/theleague/icons/{fi}.png`; the standings page renders BOTH named and
numbered srcs on one page). The generator therefore emits a second alias rule
per team via `franchiseIconDir`. If you add a dark icon, you do NOT need a
dark copy of the numbered file — both rules point at the same dark asset.

**Asset conventions:** icons are 100×100 PNG in `public/assets/theleague/icons/`,
dark variant named `{name}_dark.png` next to the light one. GroupMe avatar
variants (400×400) live in `public/assets/theleague/group-me/{name}_dark.png` —
copied for future bot use, not referenced by config yet.

**Tests:** `tests/team-icon-dark-styles.test.ts` locks the generator contract
and validates every `iconDark` in either config points at a real file under
`public/` next to a real light icon.

**Branch prereq gotcha:** the committed `claude/stoic-gauss-85d450` Header
imports `utils/theme-preference` and `components/ThemeToggle.astro`, which
were UNCOMMITTED in that worktree — the branch alone didn't build. This branch
carries copies of `theme-preference.ts`, `ThemeToggle.astro`, and
`ThemeScript.astro` (plus the `class:list` dark wiring in `TheLeagueLayout`)
so the theme system is coherent; expect these to reconcile trivially when the
dark-mode branch lands.
