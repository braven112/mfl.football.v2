# Rankings Import Quick Start Guide

## How to Import Rankings and Enable Full Analysis

### Step 1: Get Rankings Data

#### Option A: Dynasty League Football (DLF)
1. Go to https://dynastyleaguefootball.com/rankings/
2. Export or copy the rankings table
3. Should be in format: `Rank, Name, Position, Team, Age, ...`

#### Option B: FootballGuys  
1. Go to FootballGuys dynasty rankings
2. Copy the rankings table
3. Should be in format: `Player Name TEAM#` (e.g., "Ja'Marr Chase CIN1")

### Step 2: Import into Auction Predictor

1. Navigate to **Rankings** tab in auction predictor
2. Paste your rankings into the appropriate textarea:
   - **DLF rankings** → Dynasty section
   - **FootballGuys rankings** → Redraft section
3. Click **"Import DLF Rankings"** or **"Import Rankings"**
4. Wait for success message showing match rate

### Step 3: Verify Import

Check the import results:
- **Total Players**: How many rankings were in your file
- **Matched**: How many matched to your MFL roster
- **Match Rate**: Should be 70%+ for good results
- **Unmatched Players**: List of players that couldn't be matched

### Step 4: What Happens Next

Once rankings are imported:
1. ✅ **Championship windows recalculate automatically**
2. ✅ **Team Cap Analysis** updates with real window classifications
3. ✅ **Player prices** use rankings for valuation
4. ✅ **Roster strength** based on actual player rankings (not just salaries)

### What You'll See

**Before Rankings**:
- All teams show "neutral" window
- Scores clustered around 50-55
- Analysis says "requires rankings"

**After Rankings**:
- Teams classified as Contending/Neutral/Rebuilding
- Scores spread 20-90 based on actual roster quality
- Detailed reasoning:
  - "Elite roster (avg rank: 45)"
  - "2 elite players (top 20 overall)"
  - "Young core (avg age: 24.5)"
  - Etc.

## Example Rankings Format

### DLF CSV Format
```csv
Rank,Avg,Pos,Name,Team,Age
1,1.17,WR1,Ja'Marr Chase,CIN,25
2,2.45,WR2,Justin Jefferson,MIN,25
3,3.12,RB1,Breece Hall,NYJ,24
```

### FootballGuys Tab-Separated
```
1	Ja'Marr Chase CIN1
2	Justin Jefferson MIN1
3	Breece Hall NYJ2
```

## Troubleshooting

### Low Match Rate (<70%)
- Check player name format (remove Jr/Sr/III manually if needed)
- Ensure team codes are present (helps matching)
- Look at "Unmatched Players" list to see what's failing

### No Players Matched
- Wrong format - check you copied the right data
- Header row included - rankings should start with rank 1
- Try the other format (DLF vs FootballGuys)

### Rankings Don't Persist
- Check localStorage is enabled in browser
- Check console for errors
- Try clearing and re-importing

## Advanced: Name Matching

The system uses fuzzy matching to handle:
- Name variations (A.J. Brown vs AJ Brown)
- Team codes (CIN vs CIN1)
- Suffixes (Harold Fannin Jr. vs Harold Fannin)
- Initials (D Smith vs DaRon Smith)

Confidence threshold: **0.65** (65% similarity required)

## After Import - Recalculation

The system automatically:
1. Calculates composite rank (average of DLF + FootballGuys)
2. Recalculates championship windows using rankings
3. Updates all 16 team cards with new analysis
4. Saves to localStorage (persists across page reloads)

## Storage Keys

Rankings are saved to localStorage:
- `auctionPredictor.dlfRankings` - DLF dynasty rankings
- `auctionPredictor.footballguysRankings` - FootballGuys rankings

You can clear them anytime with the "Clear" button.

---

**Ready to test!** 🚀

Paste your rankings in the Rankings tab and watch the championship window analysis come alive!
