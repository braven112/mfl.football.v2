# Quick Start - Contract Management Testing

## View All Eligible Players

### Option 1: Browser (Easiest)

1. Go to: `http://localhost:3000/contracts`
2. You'll see a grid of all 16 franchises
3. Click any team to see their eligible players
4. Players are grouped by position with their current contract years

### Option 2: View Raw Data in Console

Open browser DevTools (F12) and paste:

```javascript
// Get all franchises and their players
const config = JSON.parse(document.getElementById('contract-config').textContent);

// List all franchises
console.table(config.allFranchises.map(f => ({
  id: f.id,
  name: f.name,
  division: f.division
})));

// Get players for a specific franchise
const franchise = config.allFranchises[0]; // First franchise
const players = config.franchisePlayers.filter(p => p.franchiseId === franchise.id);
console.table(players.map(p => ({
  name: p.name,
  position: p.position,
  contractYears: p.contractYear,
  salary: '$' + p.salary.toLocaleString()
})));
```

---

## Test Authentication

### Method 1: Using X-Auth-User Header (Recommended)

Test with curl to see if authentication works:

```bash
# Test authentication - should succeed
curl -H "X-Auth-User: owner1:0001:13522:John Smith:owner" \
  http://localhost:3000/api/contracts/submit \
  2>/dev/null | jq '.transactions' | head -20

# Test no auth - should return 401
curl http://localhost:3000/api/contracts/submit 2>/dev/null | jq '.'
```

### Method 2: Using X-User-Context Header (JSON)

```bash
# Send user context as JSON
curl -H "X-User-Context: {\"id\":\"owner1\",\"franchiseId\":\"0001\",\"leagueId\":\"13522\",\"name\":\"John Smith\",\"role\":\"owner\"}" \
  http://localhost:3000/api/contracts/submit \
  2>/dev/null | jq '.'
```

### Method 3: Test Authorization (User Can't Modify Other Franchises)

```bash
# User 1 trying to modify franchise 0002 (not theirs) - should fail with 403
curl -X POST http://localhost:3000/api/contracts/submit \
  -H "Content-Type: application/json" \
  -H "X-Auth-User: owner1:0001:13522:John Smith:owner" \
  -d '{
    "leagueId": "13522",
    "franchiseId": "0002",
    "playerId": "13604",
    "playerName": "Barkley, Saquon",
    "oldContractYears": 1,
    "newContractYears": 2,
    "submittedBy": "John Smith"
  }' 2>/dev/null | jq '.'
```

---

## View All Eligible Players by Franchise

### From Browser Console

```javascript
const config = JSON.parse(document.getElementById('contract-config').textContent);

// Show all franchises and their player counts
config.allFranchises.forEach(franchise => {
  const count = config.franchisePlayers.filter(p => p.franchiseId === franchise.id).length;
  console.log(`${franchise.id} - ${franchise.name}: ${count} players`);
});

// Get detailed view of a specific franchise
const franchiseId = '0001'; // Fire Ready Aim
const players = config.franchisePlayers.filter(p => p.franchiseId === franchiseId);
console.log(`\n${franchiseId} Roster (${players.length} players):`);
console.table(players.map(p => ({
  Player: p.name,
  Position: p.position,
  Contract: p.contractYear + ' yr',
  Salary: '$' + (p.salary / 1000000).toFixed(1) + 'M',
  Team: p.team
})));
```

---

## Submit a Real Contract Change

### Step 1: Navigate to Franchise

Visit: `http://localhost:3000/contracts?franchise=0001`

### Step 2: Check Window Status

You should see:
- **If window is OPEN**: "Contract Window Open - You can set contract years now"
- **If window is CLOSED**: "Contract Window Closed - Contract setting is only allowed during..."

### Step 3: Select Player and Submit

1. Click the "Select Player" dropdown
2. Pick a player (e.g., "Barkley, Saquon (RB) - 1 yr")
3. Current years auto-populate (1)
4. Enter new years (2-5)
5. Click "Submit Contract"

### What Happens Next

- **If window is OPEN and network OK**: ✅ Contract pushed to MFL, success message
- **If window is OPEN but network fails**: ⚠️ Transaction recorded locally (202 status)
- **If window is CLOSED**: ❌ Submission rejected with message

---

## List All Players by Franchise

### Quick View - All Franchises

```bash
# Show franchise IDs and player counts
curl -s http://localhost:3000/contracts 2>/dev/null | \
  grep -oP 'franchise.id.*?0\d{3}' | sort -u | head -16
```

### Detailed JSON Query

```bash
# Get all player data
curl -s http://localhost:3000 2>/dev/null | \
  jq '.franchisePlayers[] | {name, position, contractYear, franchiseId}' | head -50
```

---

## Contract Window Status

Current contract windows (automatically calculated):

- **Offseason**: February 15 → 3rd Sunday in August (8:45 PM PT)
- **In-Season**: September 1 → February 14 (Weeks 1-17)

Check status with:

```javascript
const config = JSON.parse(document.getElementById('contract-config').textContent);
console.log(config.windowStatus);
// {
//   inWindow: true/false,
//   windowType: "offseason" or "in-season",
//   reason: "explanation if closed"
// }
```

---

## View Transaction History

### Browser

Visit: `http://localhost:3000/contracts/history`

You'll see:
- All past contract submissions
- Success/failed status indicators
- Retry buttons for failed transactions
- Statistics dashboard

### API

```bash
# Get all transactions for authenticated user's league
curl -H "X-Auth-User: owner1:0001:13522:John Smith:owner" \
  http://localhost:3000/api/contracts/submit 2>/dev/null | jq '.transactions'
```

---

## Franchise Reference

### Quick ID Lookup

```bash
# Get franchise name from ID
case $1 in
  0001) echo "Fire Ready Aim" ;;
  0002) echo "Wascawy Wabbits" ;;
  0003) echo "Pacific Pigskins" ;;
  0004) echo "Heavy Chevy" ;;
  0005) echo "Dark Magicians" ;;
  0006) echo "Music City Mafia" ;;
  0007) echo "Midwestside Connection" ;;
  0008) echo "Bring The Pain" ;;
  0009) echo "The Mariachi Ninjas" ;;
  0010) echo "Computer Jocks" ;;
  0011) echo "Da Dangsters" ;;
  0012) echo "Cowboy Up" ;;
  0013) echo "Gridiron Geeks" ;;
  0014) echo "Maverick" ;;
  0015) echo "Running Down The Dream" ;;
  0016) echo "Vitside Mafia" ;;
esac
```

---

## Test Checklist

- [ ] Visit `/contracts` and see all 16 teams
- [ ] Click a team and see their roster players
- [ ] See player names, positions, and current contract years
- [ ] Select a player and see current years auto-populate
- [ ] Try changing contract years (1-5)
- [ ] Submit and see result (success or window closed message)
- [ ] Visit `/contracts/history` and see submission recorded
- [ ] Test authorization by trying to modify different franchise
- [ ] Use cURL to test authentication headers

---

## Expected Test Data

### Sample Players (will vary based on 2025 roster)

League: **13522 (The League)**
Season: **2025**

Players from Franchise 0001 (Fire Ready Aim):
- Saquon Barkley (RB) - 1 year contract
- Justin Jefferson (WR) - 1 year contract
- Keon Coleman (WR) - 1 year contract
- (200+ total players across all franchises)

All data is **live from your site** in `/src/data/mfl-player-salaries-2025.json`

---

## Still Working / Future Enhancements

✅ Real player data loading
✅ Real franchise data loading
✅ Real authentication headers
✅ Contract window validation
✅ Authorization checking
✅ MFL API push (placeholder)
⏳ Database persistence (currently in-memory)
⏳ Message board integration
⏳ Actual user login system

---

**Ready to test?** Go to `http://localhost:3000/contracts`
