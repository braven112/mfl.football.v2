# Roster Feature Spec

Authoritative list of roster features we will support (legacy parity + new UX). Use this to scope builds, tests, and API contracts.

## 1) Cap Math & Salary Engine
- Supports salary escalation modes: fixed % per year, variable % array (cumulative toggle), fixed $ per year, variable $ array (cumulative toggle), or per-year salary schedule from contract info (`[y1,y2,...]` or `salary/salary` string).
- Signing bonus handling: amortize evenly across contract length or year-one-only; expose total and remaining bonus; configurable rounding (none/off/up/down, decimal precision).
- Buyout/Trade penalties: rules for current-year-only, all-years, per-year multipliers; rollover/cutoff dates shifting penalties to next season; retained salary %; custom carryover keywords.
- Cap adjustments: season-level adjustments (absolute or multiplier); placeholder salary for open roster slots with include/exclude IR/Taxi toggles.
- Formatting: display presets (compact m/k, commas, raw, rounded) for base, adjustments, totals, and summary.

## 2) Roster Buckets & Summary Strip
- Buckets: Active, Practice Squad (Taxi), Injured Reserve. Configurable cap inclusion % per bucket per season; toggles for current vs future seasons.
- Counts: rostered, practice, injured, open spots, contract-years count, longest contract remaining.
- Summary fields: cap used per year, cap space per year, open slots allowance impact on cap, roster limit.
- Behavior:
  - Each bucket has a configurable cap inclusion percent for the current year and future years (e.g., Taxi 50% current, 100% future; IR 50% current, 100% future).
  - When “exclude current year” is toggled, the current season disappears from tables and summaries (used for next-year planning).
  - Promotion/demotion between buckets re-runs cap math with the bucket’s percent applied.
  - Roster limit applies to Active only; Practice/IR do not block open roster slots but still have cap implications per bucket rules.
- Summary strip fields (per selected team):
  - Cap used (current year), Cap space (current year), Projected cap space (next year), Open roster spots, Practice count, IR count, Contract-years total, Longest contract remaining.
  - Optional: a “Cap with open slots filled” field that reserves placeholder salary for open roster spots when configured.
- Table labeling:
  - Rows are grouped by bucket with visual dividers and legends.
  - Bucket color chips: Active (green), Practice (blue), IR (red); variants follow theme tokens.

## 3) Contract Metadata & Badges
- Contract types: Rookie, Extension, Franchise/Tag, Standard, Practice, Injured.
- Status parsing: contract length from status/info (slash `1/4`, decimal `1.4`, or numeric), option/tag markers (status/info contains tokens), audition windows, drafted metadata.
- Free-agency flags: RFA/UFA determination via ruleset (everyone RFA, everyone UFA, minus-one-year, whitelist by status/info tokens, case-sensitive variants); optional hide.
- Salary splits: base, guaranteed, signing bonus; remaining totals per split; RFA potential salaries (multiplier array).
- Injury/Draft meta: injury note abbreviations, draft round/pick for Taxi salary rules.

## 4) Player Actions & Simulations
- Cut/Trade toggles per player: recompute cap hits, dead money, and contract-year counts across seasons; support reverse/uncheck flows.
- Buyout and trade rollover logic: applies penalties to current vs next season based on configured dates; retained signing bonus options.
- Promote from Practice: moves player bucket, updates cap %, and roster counts; selectable target year for promotion impact.
- Assign Contract action: multi-year assignment for eligible players (typically 1-year deals); updates cap and contract-year totals.
- Exclude Current Year switch: hides current year from projections when toggled; adjusts summaries.
- Dead money panel: toggle show/hide; lists adjustments with per-year impact; counts adjustments.

## 5) Salary Timeline & Visualization
- SalaryStrip for 7 years (configurable): highlights current year, labels UFA/RFA when contract ends, shows option/tag styling.
- Cells still show numeric values; hovering shows base/bonus split and option/tag context.
- Styling hooks for guaranteed, option year, option exercised/not exercised, tag years.

## 6) League-Wide Summary Grid
- Franchise vs Year matrix: contract count and cap space per team per season.
- Clicking franchise switches detailed roster view.
- Honors per-year cap adjustments and open-slot placeholders.

## 7) UI Integration (per design spec)
- AppShell with top nav, breadcrumbs, and sidebar entries: My Roster, Extensions & Cap, Scoreboard, History, Playoffs, GroupMe.
- Action bar: Add/Drop, IR, Practice Squad, Offer Trade, Trading Block, Extensions, League Summary.
- Column toggles for table; sticky header; mobile horizontal scroll; dark/light theme tokens.

## 8) Extension Workflow
- “Open Extension Calculator” pre-fills selected player (salary, years, contract type).
- Outputs new year-by-year salaries (next 7 yrs) and cap impact deltas; supports league-specific escalation rules and cap limits per year.

## 9) Data & Performance
- Data shape includes: id, name, position, nflTeam, byeWeek, salary, contractYears, contractStatus, contractInfo, contractType, draftYear/round/pick, status/bucket, points, headshot/nflLogo URLs, base/guaranteed/bonus if available.
- Caching: optional client-side caching of MFL exports; graceful fallback to local snapshots.
- Loading states: show overlay/spinner during data fetch or recalculation; debounce expensive recomputes on rapid toggles.
