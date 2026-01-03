# Auction Price Predictor – Parameterized Model

This model uses your historical auction curves plus market/context signals to generate per-player price bands for the upcoming auction. All levers below are tunable per league.

## Inputs
- `rankSlotPrice[position][slot]`: historical price table by position and rank slot (from 2020-2024 auctions; use per-slot max/avg/min as bounds).
- `consensusRank`: blended dynasty/redraft rank (weighted by `dynastyWeight`).
- `positionScarcity[position]`: supply/demand index (e.g., demand / quality supply).
- `tagProbability[playerId]`: likelihood player is removed from market.
- `capDistribution`: league cap totals, cap Gini, discretionary cap after min roster fill.
- `teamNeeds[franchiseId][position]`: open starter spots/priority.
- `rookieImpact[position]`: expected demand reduction + cap usage from draft picks.
- `riskFlags`: injury/suspension/durability markers.
- `age`: used for contract-length elasticity, not for base price.
- `auctionMomentum[position]`: recent close vs. model (percentage).
- `contractLength`: desired years (1-5).

## Parameters (weights)
```json
{
  "dynastyWeight": 0.6,
  "rankCurve": "max",               // max|avg|min from rankSlotPrice
  "scarcityWeight": 0.25,           // how much scarcity inflates/deflates
  "tagPenalty": 0.35,               // price reduction when tagProbability=1
  "capLiquidityWeight": 0.20,       // effect of high discretionary cap
  "rookieDemandWeight": 0.15,       // demand reduction from rookie fills
  "momentumWeight": 0.10,           // anchoring to recent closes
  "riskDiscount": {                 // multiplicative discounts
    "injury": 0.90,
    "suspension": 0.85,
    "durability": 0.95
  },
  "lengthElasticity": {             // premium vs. 1-year baseline
    "2": 1.05,
    "3": 1.10,
    "4": 1.15,
    "5": 1.20
  },
  "scarcityCap": 1.4,               // max scarcity multiplier
  "oversupplyFloor": 0.85,          // min scarcity multiplier
  "liquidityCap": 1.15,             // max liquidity bump
  "momentumCap": 1.10               // max momentum bump
}
```

## Calculation Steps (per player)
1. **Rank slot lookup**: determine position rank slot from `consensusRank` within position; get `basePrice` from `rankSlotPrice[position][slot][rankCurve]`.
2. **Scarcity multiplier**: `scarcityMult = clamp(1 + scarcityWeight * (positionScarcity - 1), oversupplyFloor, scarcityCap)`.
3. **Tag adjustment**: `tagMult = 1 - tagProbability * tagPenalty`.
4. **Cap liquidity**: compute discretionary cap per open spot league-wide; map to `liquidityMult` in [1, liquidityCap] using `capDistribution`.
5. **Rookie demand adjustment**: `rookieMult = 1 - rookieImpact[position] * rookieDemandWeight`.
6. **Momentum anchoring**: if recent closes differ from model, `momentumMult = clamp(1 + momentumWeight * recentDelta, 1/momentumCap, momentumCap)`.
7. **Risk discounts**: multiply by applicable `riskDiscount` factors.
8. **Contract length elasticity**: apply `lengthElasticity[contractLength]` to reflect willingness to pay for control; keep separate reporting for 1-5 years.
9. **Price assembly**: `price = basePrice * scarcityMult * tagMult * liquidityMult * rookieMult * momentumMult * riskMult * lengthMult`.
10. **Bounds**: floor at league minimum; optionally cap at historical max for that rank slot to avoid outliers.
11. **Confidence**: set confidence from data density (samples for that slot/position) and rank-source agreement.

## Outputs
- `priceByLength`: 1-5 year prices.
- `factors`: breakdown of each multiplier and the basePrice used.
- `confidence`: 0-1 score for band width.

## Tuning Notes
- Use `rankCurve: "max"` for bullish markets; `avg` for neutral; `min` for bearish.
- Raise `scarcityWeight` when supply is thin and cap is high; lower it when many viable starters exist.
- Increase `tagPenalty` if tags are very predictable; decrease if owners often surprise.
- Calibrate `lengthElasticity` with your multi-year contract history (pay more for control if churn is rare).
- Momentum is most useful in live auctions; keep it small for pre-draft modeling.
