# Free Agents Value — Insights

## 2026-02-28 - Blend Historical Curves With Position-Tier Benchmarks

**Context:** Estimated cost on `/theleague/players` Value view was collapsing toward minimum-tier prices, making surplus values untrustworthy for top players.

**Insight:** A single global-rank multiplier is not enough for auction pricing. Reliable estimates come from combining:
1. Historical position salary curves (`historical-salary-curves.json`)
2. Current league benchmark bands (`top3Average`, `top5Average`)
3. Position-specific comparable salaries near the same rank

Top 3-5 positional players need explicit benchmark anchoring, while rookie deals must still show actual salary.

**Evidence:** `src/utils/surplus-value.ts` now computes:
- position ranks (WR1, WR2, etc.) from rank signals
- historical-curve modeled costs
- top-tier floors tied to top3/top5 averages
- same-position comparable blending
- rookie-deal exception (`estimatedCost = actual salary`)

Verified in page output: `estimatedCost` now has broad spread (not flat), with top non-rookie players near franchise-level numbers.

**Recommendation:** Keep benchmark anchors and rookie exception in place. If price outputs drift low again, first inspect position-rank assignment and comparable sample windows before changing curve weights.

## 2026-02-28 - Value View Needs Context Columns for Price Calibration

**Context:** Users needed to validate estimated costs against real historical player pricing directly on the Value table.

**Insight:** Showing model output without a historical reference makes tuning subjective. Users preferred per-year visibility over an aggregate metric.

**Evidence:** `src/pages/theleague/players.astro` now adds three sortable Value columns (`2025`, `2024`, `2023` as of league year 2026), sourced from `mfl-player-salaries-*.json` for those exact years (`salaryYear1/2/3` fields in row data).

**Recommendation:** Keep explicit year columns instead of a single historical aggregate. It prevents hidden averaging effects and makes contract-era context obvious.
