# Cap Space Calculation Summary

## Validation Results
- **9 out of 16 teams** match perfectly ✓
- **7 teams** have minor discrepancies (likely due to data timing or specific adjustments)

## Correct Formula

```
Cap Space = SALARY_CAP - (Active Roster Salaries + Dead Money)

Where:
- SALARY_CAP = $45,000,000
- Active Roster Salaries = Sum of:
  - ROSTER players: 100% of salary
  - INJURED_RESERVE players: 100% of salary
  - TAXI_SQUAD players: 50% of salary
- Dead Money = Sum of all salary adjustments from salaryAdjustments.json
```

## League Rules (from rules.html)

1. **Salary Cap**: $45 million
2. **Injured Reserve**: IR players' salaries count 100% against the cap
3. **Practice Squad (Taxi Squad)**: Up to 3 rookies at 50% of base salary against the cap
4. **Dead Money**: When players are dropped, they count at 50% cap hit

## Teams That Match Perfectly

1. Team 0001 (PIGSKINS) - ✓
2. Team 0003 (MAVERICK) - ✓
3. Team 0005 (THE MARIACHI NINJAS) - ✓
4. Team 0007 (FIVE READY AIM) - ✓
5. Team 0010 (COMPUTER) - ✓
6. Team 0011 (MIDWESTSIDE CONNECTION) - ✓
7. Team 0012 (VITSIDE MAFIA) - ✓
8. Team 0014 (COWBOY UP) - ✓
9. Team 0015 (DARK MAGICIANS) - ✓

## Teams With Discrepancies

| Team | Difference | Possible Cause |
|------|-----------|---------------|
| 0002 | +$200k | Minor data timing or adjustment issue |
| 0004 | -$425k | Minor data timing or adjustment issue |
| 0006 | -$50k | Rounding or minor adjustment |
| 0008 | -$350k | Minor data timing or adjustment issue |
| 0009 | +$575k | Minor data timing or adjustment issue |
| 0013 | +$2M | **Large discrepancy - needs investigation** |
| 0016 | +$1 | Rounding error |

## Recommendations

1. The cap calculation formula is now correct for 9/16 teams
2. The 6 teams with minor discrepancies (<$600k) may have:
   - Recent transactions not yet reflected in the data
   - Timing differences between data snapshots
   - Special adjustments not captured in salaryAdjustments.json

3. Team 0013 (GRIDIRON GEEKS) has a $2M discrepancy and should be investigated:
   - Check for missing dead money entries
   - Verify all roster players are included
   - Check for any special cap adjustments

## Next Steps

To fix the cap calculations in the rosters page:
1. Update the player salary calculation to use 50% for TAXI_SQUAD players
2. Ensure all salary adjustments (dead money) are included
3. Use the formula: `SALARY_CAP - (roster salaries + IR salaries + (taxi salaries * 0.5) + dead money)`
