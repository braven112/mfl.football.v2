# Cap Projection — Gap Analysis vs. Idea #13

## Original idea

Multi-year cap simulator where you toggle extensions, cuts, and tags and see resulting cap space across the next 3 seasons.

## What the rosters page already does

Audited `src/pages/theleague/rosters.astro` and the supporting components. Current capabilities:

| Capability | Where | Notes |
|---|---|---|
| Per-team **2026 cap projection** | `TeamCapAnalysis.astro` | Single year, all 16 teams, championship windows |
| **Veteran extension candidates** | `VeteranExtensionCandidates.astro` (in League Planner section) | Lists eligible players + extension cost per year, doesn't simulate scenarios |
| **Free-agent needs** analysis | `FreeAgentNeedsCard.astro` + `analyzeFreeAgentNeeds` util | Per-position needs vs roster, single year |
| **Budget Planner** with what-if scenarios | `BudgetPlannerPanel.astro` | Auction-prep, target lists, scenario buttons (Aggressive / Conservative / Balanced) but **single year** |
| **Draft picks** for 2026 + 2027 | `DraftCapitalTable.astro` | Reference data, not interactive |
| **Multi-year cap impact for a TRADE** | `MultiYearCapTable.tsx` (in Trade Builder, not roster page) | Shows cap delta across N years for one specific proposed trade |
| **Salary escalation** (10% annual) | Embedded in roster calcs | Applied automatically to multi-year contracts |
| **Cap opportunity cost** | `cap-opportunity-cost.md` (docs); calc helpers exist | Used in trade analysis |

## Gap vs. the original idea

The existing tooling is mostly **single-year + reactive**. The idea was **multi-year + proactive scenario planning**. Specific gaps:

1. **No 3-year side-by-side cap projection on the roster page itself.**
   The MultiYearCapTable component exists for trades, but the rosters page only displays 2026 numbers. An owner planning their off-season can't see 2027/2028 implications without running individual trades.

2. **No "what if I extend everyone eligible" toggle.**
   VeteranExtensionCandidates lists candidates but you can't click a checkbox to apply the extension and watch your 2027/2028 cap re-compute.

3. **No "what if I cut player X today" simulation.**
   Roster shows the cut would generate dead money, but doesn't fold that into the multi-year cap projection.

4. **No "what if I franchise-tag player Y" simulation.**
   FranchiseTagPanel exists but isn't wired into a multi-year cap projection view.

5. **No saved scenarios.**
   You can fiddle in the BudgetPlanner (single year), but you can't save "scenario A: aggressive cut + extend top 3" vs "scenario B: hoard cap, let everyone walk" and compare them side-by-side.

6. **No comp-pick projection** when an FA walks.
   The roster shows projected free agents but doesn't say "if you let this guy walk, here's the comp pick you'd get and when."

7. **No "your team vs rival X" side-by-side projection.**
   Useful for trade leverage and championship-window analysis. Lives in TeamCapAnalysis as 16 separate cards, not pairwise compare.

## Recommendation

Treat #13 as a **set of small follow-up enhancements to the existing planner section**, not a new page. Most of the data pipes already exist — the work is mostly UI wiring.

### Phase 1 (highest value, lowest effort)

- **Add 3-year cap projection table** to the existing TeamCapAnalysis card. Display 2026 / 2027 / 2028 columns side-by-side. Reuse `MultiYearCapTable.tsx` data shape and salary escalation logic.

### Phase 2 (interactive scenario toggles)

- **Add toggle UI to VeteranExtensionCandidates** so each row has an "apply extension" checkbox. Toggling re-runs the multi-year cap projection in place.
- **Same toggle for cuts** — each rostered player gets a "simulate cut" checkbox.
- **Same for franchise tags** — FranchiseTagPanel toggles flow into the projection.

### Phase 3 (saved scenarios)

- **Scenario save/load** in the planner. Each scenario is a named bag of toggles (cut/extend/tag selections). Stored in localStorage initially, then in the existing `data/<league>/contract-declarations.json` if Brandon wants commish-visibility.
- **Side-by-side compare:** pick two saved scenarios, see cap projection delta across 3 years.

### Phase 4 (comp picks + rivals)

- **Comp-pick projection** — when an FA walks in a scenario, project the comp pick (round + year) per the league rule.
- **Pairwise team compare** — pick two teams, see their 3-year cap projections side-by-side.

## Open questions

- Confirm with Brandon: is the 3-year projection (idea #13) genuinely missing, or did he expect the existing single-year planner to cover this and found it sufficient? Quick chat before scoping further.
- Salary escalation rule: 10% annual is current — confirm that applies to all contract types (extensions, FA contracts, draft picks).
- Comp pick formula: should be in the constitution (`docs/claude/league-rules.md`); the projection logic must match exactly.
