# The viewer's preferred team

Which franchise a page treats as "yours". It drives row highlighting on
standings and playoffs, which bracket auto-opens, which roster loads first,
which chair the draft room puts you in, and which side of a trade the builder
offers players from.

One resolver answers it: `resolveFranchiseSelection(league, params)` in
`src/utils/team-preferences.ts`, with `resolveTeamSelection` (TheLeague) and
`resolveAFLTeamSelection` (AFL) as thin wrappers over the same body.

Priority, highest first:

| Slot | Source |
|---|---|
| `myTeamParam` | `?myteam=` — an explicit, sticky choice (the pages also write the cookie) |
| `franchiseParam` | `?franchise=` / `?team=` / `?franchiseId=` — a one-off browse-as link |
| `cookiePreference` | the franchise id out of this league's preference cookie |
| `authUserFranchise` | the signed-in owner's franchise **in this league** |
| `defaultTeam` | an explicit, caller-chosen fallback |

## The rules

**There is no implicit default, and "nobody" is a real answer.** The resolver
returns `string | undefined`. Omit `defaultTeam` and a viewer with no param, no
cookie and no session resolves to `undefined` — highlight nobody.

Both resolvers used to end with a literal `return '0001'`. Three call sites
asked for exactly this and got the league's first franchise instead: Pacific
Pigskins in TheLeague, Smokane FC in the AFL, presented to a signed-out
stranger as their own team. `src/pages/theleague/standings.astro` said so in a
comment (`// Don't default if no preference`) and two sites appended
`|| undefined` to opt out — which cannot work, because `'0001'` is truthy. The
defect survived because **both leagues have a franchise 0001**, so the wrong
answer is always a real team and never an obvious blank.

Pass a `defaultTeam` only on a surface that cannot render without a team at
all — `rosters.astro` IS a team's roster, and the two front-office hubs render
one club's panel. Name the fallback at the call site, where a reader can see
it, not inside the resolver where it overrides everyone. Do not "fix" a
`string | undefined` by reinstating `'0001'` at a site that wanted nobody.

Guard: `tests/preferred-team-resolution-guard.test.ts`.

**The session goes in `authUserFranchise` — never smuggled through another
slot.** `resolveAFLTeamSelection` shipped without the parameter at all while
TheLeague's twin had it, and its six call sites invented four different
workarounds: two ignored the session entirely, one passed it as `defaultTeam`,
two as `cookiePreference`. Both smuggles silently reorder the priority. A
session is not a stated preference, so through `cookiePreference` it outranks
a real cookie choice; it is not a last-resort fallback either, so through
`defaultTeam` it loses to one.

Guard: `tests/preferred-team-resolution-guard.test.ts`.

**Derive the session id with `franchiseIdForLeague(user, league.id)`.** Never a
bare `user.franchiseId`, and never an inline `leagueId` comparison. Franchise
0001 exists in both leagues, so an ungated id matches a TheLeague owner to an
AFL roster — the same class of bug as #971. `franchiseIdForLeague`
(`src/utils/auth.ts`) collapses all three "not an owner here" cases — signed
out, signed in to the other league, no franchise — to `null`.

Guard: `tests/preferred-team-resolution-guard.test.ts`.

**`cookiePreference` takes the id, not the preference object.**
`getTheLeaguePreference` / `getAFLPreference` return
`{ franchiseId, lastUpdated, … }`; the slot wants `?.franchiseId`. TheLeague's
draft room and mock room passed the whole object (through a second argument
`getTheLeaguePreference` does not even accept), which stringified to
`"[object Object]"`, failed validation, and silently dropped the cookie at
both sites — a preference that looked saved and was never read.

**A page that writes the cookie does it in the ROUTE's frontmatter.**
`setTheLeaguePreference` / `rememberAflTeamChoice` call `Astro.cookies.set()`,
which throws `ResponseSentError` from an imported component and blanks the
page. Reading is safe anywhere. See `docs/claude/rules/viewer-preferences.md`
for the same boundary on clocks and country.

## Siblings drift here

The two leagues' copies of these pages must agree on what "no preference"
means. They did not: TheLeague's `standings` and `draft/order` asked for
nobody while the AFL's twins passed `defaultTeam: '0001'`, and the AFL's
`playoffs` asked for nobody but had no session slot to ask with. When you
change one league's answer, change the twin — `sibling-drift-checker` and
`tests/page-fork-ratchet.test.ts` exist for this.

## Severity, for the next person who finds one of these

Check whether the value reaches a WRITE before deciding scope. As of Sep 2026
it does not: `/api/trades/submit` re-derives the franchise from the session
(`user.franchiseId`) and verifies roster ownership, `/api/draft-list` likewise,
and the real draft room submits no picks at all — it links out to MFL's own
pick page. So a wrong preferred team is a display defect.

The one place the id is an actor identity is the mock draft, where
`userTeamId` becomes `franchiseId` on the PartyKit messages in
`src/components/theleague/draft-room/DraftRoom.tsx`. `party/draft-room.ts`
trusts that field with no authentication — but that is a property of an
unauthenticated websocket, not of this resolver: any client can send any id
regardless of what the page rendered, and the mock routes are behind a
sign-in gate. Do not read the resolver as the boundary there.
