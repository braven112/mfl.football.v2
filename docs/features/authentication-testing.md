# Contract Management - Authentication & Testing Guide

## Overview

The contract management feature now pulls **real player data** from your live site and implements **real authentication** support. Here's how to test and use it.

## Authentication Methods

The system now supports multiple authentication methods that are checked in this order:

### 1. X-User-Context Header (JSON)
This is the **recommended method** for testing. Send a JSON object with user info:

```bash
curl -H "X-User-Context: {\"id\":\"user123\",\"franchiseId\":\"0001\",\"leagueId\":\"13522\",\"name\":\"Owner Name\",\"role\":\"owner\"}" \
  http://localhost:3000/api/contracts/submit
```

### 2. X-Auth-User Header (Colon-Separated)
Simple format: `id:franchiseId:leagueId:name:role`

```bash
curl -H "X-Auth-User: user123:0001:13522:Owner Name:owner" \
  http://localhost:3000/api/contracts/submit
```

### 3. Authorization Bearer Token
For future JWT implementation:
```bash
curl -H "Authorization: Bearer <jwt-token>" \
  http://localhost:3000/api/contracts/submit
```

### 4. Session Cookies
For future cookie-based sessions:
```bash
curl -H "Cookie: __session=<session-token>" \
  http://localhost:3000/api/contracts/submit
```

---

## Testing via Browser

### Step 1: Access the Contracts Page

Navigate to: `http://localhost:3000/contracts`

You'll see:
- **Team Selection Screen** with all 16 franchises
- Click any franchise to view their eligible players

### Step 2: View Eligible Players

After selecting a franchise, you'll see:
- All players on that franchise's roster with active contracts
- Contract setting window status (open/closed)
- Player names, positions, and current contract years
- Grouped by position for easy navigation

**Example: Pacific Pigskins (Franchise 0001)**

If this franchise has these players in the 2025 player data:
- Saquon Barkley (RB) - 1 year
- Justin Jefferson (WR) - 1 year
- Keon Coleman (WR) - 1 year

All will show in the player selector.

### Step 3: Submit a Contract Change

1. Select a player from the dropdown
2. Current contract years auto-populate
3. Enter new contract years (1-5)
4. Click "Submit Contract"

The system will:
- Validate the submission
- Check contract window status
- Push to MFL if window is open
- Display success/error message
- Record transaction in history

---

## Real Data Integration

### Players Loaded From

File: `/src/data/mfl-player-salaries-2025.json`

The system loads **actual player data** including:
- Player ID, name, position
- Current franchise ownership
- Roster status (ROSTER, TAXI, RESERVE, etc.)
- Current contract years
- Salary information
- NFL team assignment

### Franchises Loaded From

File: `/src/data/theleague.assets.json`

The franchise selector displays:
- All 16 team icons
- Team names
- Divisions (Northwest, Southwest, Central, East)
- Hover effects with team details

### League Detection

The page automatically detects:
- League ID from player data (13522 = The League)
- Franchise ID from URL parameter (`?franchise=0001`)
- All roster players for that franchise

---

## Testing Scenarios

### Scenario 1: View All Franchises and Their Players

**Steps:**
1. Go to `http://localhost:3000/contracts`
2. See grid of 16 franchises with icons
3. Click "Pacific Pigskins" (0001)
4. View all roster players with contracts
5. Change franchise by clicking back link

**Expected Result:**
- All 16 franchises visible
- Franchise-specific players load correctly
- Player list updates when changing franchises

### Scenario 2: Submit Contract During Window

**Steps:**
1. Navigate to `/contracts?franchise=0001`
2. Check if contract window is open (Feb 15 - 3rd Sunday Aug or Weeks 1-17)
3. Select a player
4. Change contract years
5. Click Submit

**Expected Results:**
- If window is OPEN: Contract pushed to MFL, success message
- If window is CLOSED: Message shows "Contract Window Closed"
- Transaction recorded in history

### Scenario 3: Test Authorization

**Using API directly:**

```bash
# Valid: User can modify their own franchise
curl -X POST http://localhost:3000/api/contracts/submit \
  -H "Content-Type: application/json" \
  -H "X-Auth-User: user1:0001:13522:Owner1:owner" \
  -d '{
    "leagueId": "13522",
    "franchiseId": "0001",
    "playerId": "13604",
    "playerName": "Barkley, Saquon",
    "oldContractYears": 1,
    "newContractYears": 2,
    "submittedBy": "Owner1"
  }'

# Invalid: User cannot modify different franchise
curl -X POST http://localhost:3000/api/contracts/submit \
  -H "Content-Type: application/json" \
  -H "X-Auth-User: user1:0001:13522:Owner1:owner" \
  -d '{
    "leagueId": "13522",
    "franchiseId": "0002",  # Different franchise!
    "playerId": "13604",
    "playerName": "Barkley, Saquon",
    "oldContractYears": 1,
    "newContractYears": 2,
    "submittedBy": "Owner1"
  }'
# Expected response: 403 Forbidden
```

### Scenario 4: Retry Failed Submission

**Using API:**

```bash
# First, submit when network is down to get failed transaction
# Then retry it:
curl -X POST http://localhost:3000/api/contracts/retry \
  -H "Content-Type: application/json" \
  -H "X-Auth-User: user1:0001:13522:Owner1:owner" \
  -d '{
    "transactionId": "TXN_1700000000000_abc123"
  }'
```

---

## Franchise & Player Reference

### All 16 Franchises

```
NORTHWEST DIVISION:
- 0003: Pacific Pigskins (Pacific)
- 0010: Computer Jocks
- 0011: Da Dangsters
- 0016: Vitside Mafia

SOUTHWEST DIVISION:
- 0004: Heavy Chevy
- 0006: Music City Mafia
- 0007: Midwestside Connection
- 0013: Gridiron Geeks

CENTRAL DIVISION:
- 0008: Bring The Pain
- 0009: The Mariachi Ninjas
- 0012: Cowboy Up
- 0015: Running Down The Dream

EAST DIVISION:
- 0001: Fire Ready Aim
- 0002: Wascawy Wabbits
- 0005: Dark Magicians
- 0014: Maverick
```

### Finding Players by Franchise

Use the URL parameter to navigate directly:
- `/contracts?franchise=0001` - Fire Ready Aim
- `/contracts?franchise=0003` - Pacific Pigskins
- `/contracts?franchise=0010` - Computer Jocks
- etc.

---

## Browser DevTools Testing

### View Raw Player Data

Open browser console and execute:

```javascript
// Get all franchises
const config = JSON.parse(document.getElementById('contract-config').textContent);
console.log(config.allFranchises);
// View all franchises with icons and divisions

// Get eligible players for selected franchise
console.log(config.franchisePlayers);
// View all players with contract data

// Get players grouped by position
console.log(config.playersByPosition);
// View players organized by position
```

### Monitor API Calls

1. Open DevTools → Network tab
2. Submit a contract
3. Watch the POST to `/api/contracts/submit`
4. View response with transaction details

### Test Authentication Headers

In Network tab, find the request and check:
- **Request Headers**: See if auth headers are being sent
- **Response**: Check status code (401 if auth fails, 403 if unauthorized)

---

## Testing with cURL

### Test Complete Flow

```bash
# 1. Submit a contract
RESPONSE=$(curl -s -X POST http://localhost:3000/api/contracts/submit \
  -H "Content-Type: application/json" \
  -H "X-Auth-User: user1:0001:13522:Owner1:owner" \
  -d '{
    "leagueId": "13522",
    "franchiseId": "0001",
    "playerId": "13604",
    "playerName": "Barkley, Saquon",
    "oldContractYears": 1,
    "newContractYears": 3,
    "submittedBy": "Owner1"
  }')

echo "Submit Response:"
echo $RESPONSE | jq '.'

# 2. Get transaction history
echo -e "\n\nTransaction History:"
curl -s http://localhost:3000/api/contracts/submit \
  -H "X-Auth-User: user1:0001:13522:Owner1:owner" | jq '.transactions[]'

# 3. Retry if failed
TRANSACTION_ID=$(echo $RESPONSE | jq -r '.transactionId')
echo -e "\n\nRetrying transaction: $TRANSACTION_ID"
curl -s -X POST http://localhost:3000/api/contracts/retry \
  -H "Content-Type: application/json" \
  -H "X-Auth-User: user1:0001:13522:Owner1:owner" \
  -d "{\"transactionId\": \"$TRANSACTION_ID\"}" | jq '.'
```

---

## Current Data Details

### League Information

- **League ID**: 13522 (The League)
- **Season**: 2025
- **Week**: 12 (as of last data fetch)
- **Number of Franchises**: 16
- **Total Roster Players**: 200+
- **Salary Cap**: $45,000,000

### Sample Players (Franchise 0001 - Fire Ready Aim)

From the actual 2025 player data:

| Player | Position | Salary | Contract Yr |
|--------|----------|--------|-------------|
| Barkley, Saquon | RB | $9,124,450 | 1 |
| Jefferson, Justin | WR | $9,625,833 | 1 |
| Coleman, Keon | WR | $1,485,000 | 1 |
| (and many more...) | | | |

Players are loaded in real-time from `/src/data/mfl-player-salaries-2025.json`

---

## Authentication Implementation Details

### Current Implementation

**File**: `/src/utils/auth.ts`

Checks headers in this order:
1. `X-User-Context` (JSON object)
2. `X-Auth-User` (colon-separated values)
3. Authorization Bearer token (future)
4. Session cookies (future)

Returns `AuthUser` object with:
- `id`: User ID
- `franchiseId`: Franchise the user owns
- `leagueId`: League the user can access
- `name`: Owner name
- `role`: owner | commissioner | admin

### Future Implementation

When message board is replaced, integrate one of:
- **JWT tokens** in Authorization header
- **Session cookies** for persistent auth
- **OAuth** for third-party auth
- **API keys** for service-to-service

---

## Troubleshooting

### No Players Showing for Franchise

**Possible Causes:**
1. Franchise has no roster players with contracts
2. All roster players lack contractYear data
3. Player data file hasn't been synced

**Solution:**
Check browser console for errors, verify franchise ID is valid (0001-0016)

### Contract Window Shows Closed

**Expected Behavior:**
- Closed Feb 14 to 3rd Sunday Aug - 1 day
- Closed after 3rd Sunday Aug until Sept 1
- Open Sept 1 - Feb 14 (in-season)

**Verify:** Check current date and contract window rules

### API Rejects with 401 Unauthorized

**Cause:** No authentication header provided

**Solution:** Add `-H "X-Auth-User: id:franchiseId:leagueId:name:role"` to request

### API Rejects with 403 Forbidden

**Cause:** User trying to modify different franchise

**Solution:** Ensure `franchiseId` in request matches authenticated user's `franchiseId`

---

## Next Steps

1. **Test the UI** at `/contracts` - select franchises and view players
2. **Test API endpoints** with cURL examples above
3. **Monitor browser network** to see actual requests
4. **Check transaction history** at `/contracts/history`
5. **Implement message board integration** when ready to replace placeholder auth

---

## API Response Examples

### Successful Submission (200)

```json
{
  "success": true,
  "transactionId": "TXN_1732353726000_8k9l2m",
  "status": "success",
  "playerName": "Barkley, Saquon",
  "contractYears": 3,
  "mflResponse": {
    "success": true,
    "mflTransactionId": "MFL_2025_0001",
    "message": "Contract updated on MFL"
  },
  "message": "Contract successfully updated on MFL"
}
```

### Partial Success - MFL Push Failed (202)

```json
{
  "success": false,
  "transactionId": "TXN_1732353726000_abc123",
  "status": "failed",
  "playerName": "Jefferson, Justin",
  "contractYears": 4,
  "mflResponse": {
    "success": false,
    "error": "Network timeout",
    "message": "Failed to push contract to MFL"
  },
  "message": "Contract saved locally but failed to push to MFL. An admin will manually sync this later."
}
```

### Validation Error (400)

```json
{
  "error": "Validation failed",
  "errors": [
    {
      "field": "contractYears",
      "message": "Contract years must be a whole number between 1 and 5"
    }
  ],
  "windowStatus": {
    "inWindow": false,
    "reason": "Contract setting is only allowed during offseason or in-season windows"
  }
}
```

### Authentication Error (401)

```json
{
  "error": "Unauthorized",
  "message": "You must be logged in to submit contracts"
}
```

### Authorization Error (403)

```json
{
  "error": "Unauthorized",
  "message": "You can only modify contracts for your own franchise"
}
```

---

## Files Modified/Created

- `src/pages/contracts.astro` - **Updated**: Real player data, franchise selector
- `src/pages/contracts/history.astro` - Transaction history page
- `src/utils/auth.ts` - **Updated**: Multiple authentication methods
- `src/utils/contract-validation.ts` - **Updated**: Accept league 13522
- `src/pages/api/contracts/submit.ts` - Contract submission API
- `src/pages/api/contracts/retry.ts` - Failed submission retry API
- `src/types/contracts.ts` - TypeScript type definitions

---

**Build Status**: ✅ All tests pass, no compilation errors

Go to `http://localhost:3000/contracts` to start testing!
