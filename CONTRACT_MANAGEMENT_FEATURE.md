# Contract Management Feature

## Overview

This document outlines the complete contract management feature for the MFL.football.v2 application. This feature enables league owners to set contract years for recently added players during specific contract setting windows.

## Key Features

### 1. Contract Setting Windows

The feature respects two contract setting windows:

- **Offseason Window**: February 15 - 3rd Sunday in August (8:45 PM PT)
- **In-Season Window**: Weeks 1-17

During these windows, owners can modify contract years for eligible players (1-5 years).

### 2. MFL Integration

Contracts are automatically pushed to MyFantasyLeague (MFL) when submitted. The system includes:

- Real-time MFL API integration for pushing contract updates
- Automatic error handling with detailed error messages
- Transaction ID tracking for audit trail
- Failed push notifications with manual sync option

### 3. Transaction Management

All contract submissions are tracked with:

- Unique transaction IDs
- Timestamp of submission
- Player and franchise information
- Old and new contract years
- Submission status (pending, success, failed, retry_pending)
- MFL response data and error messages
- Retry attempt count

### 4. Retry Mechanism

Failed submissions can be retried up to 3 times:

- Manual retry from transaction history page
- Automatic retry counters
- Detailed error messages for diagnostics
- Maximum retry limit prevents infinite loops

### 5. Authorization & Security

- Authentication required for all contract operations
- Owners can only modify their own team's contracts
- League-specific authorization (currently restricted to league 18202 for testing)
- Comprehensive validation of all inputs

## Architecture

### Page Routes

#### `/contracts` - Main Contract Management Page
- Form for submitting contract year changes
- Player selector with current contract years
- Contract window status display
- Recent submissions list (5 most recent)
- Contract setting rules reference

**File**: `src/pages/contracts.astro`

#### `/contracts/history` - Transaction History Page
- Complete list of all contract submissions
- Search and filter capabilities
- Status-based color coding
- Failed transactions highlighted for admin review
- Summary statistics
- Retry and manual sync buttons for failed transactions

**File**: `src/pages/contracts/history.astro`

### API Endpoints

#### `POST /api/contracts/submit` - Submit Contract
Submits a new contract year change for a player.

**Request Body**:
```json
{
  "leagueId": "18202",
  "playerId": "QB001",
  "playerName": "Patrick Mahomes",
  "franchiseId": "FRAN001",
  "oldContractYears": 2,
  "newContractYears": 3,
  "submittedBy": "Owner Name"
}
```

**Response (Success - 200)**:
```json
{
  "success": true,
  "transactionId": "TXN_1700000000000_abc123",
  "status": "success",
  "playerName": "Patrick Mahomes",
  "contractYears": 3,
  "mflResponse": {
    "success": true,
    "mflTransactionId": "MFL_2024_001",
    "message": "Contract updated on MFL"
  },
  "message": "Contract successfully updated on MFL"
}
```

**Response (Partial Success - 202)**:
```json
{
  "success": false,
  "transactionId": "TXN_1700000000000_def456",
  "status": "failed",
  "playerName": "Jonathan Taylor",
  "contractYears": 4,
  "mflResponse": {
    "success": false,
    "error": "Network timeout",
    "message": "Failed to push contract to MFL"
  },
  "message": "Contract saved locally but failed to push to MFL. An admin will manually sync this later."
}
```

**File**: `src/pages/api/contracts/submit.ts`

#### `GET /api/contracts/submit` - Get Transaction History
Retrieves all contract transactions for the authenticated user's league.

**Response**:
```json
{
  "transactions": [
    {
      "id": "TXN_1700000000000_abc123",
      "leagueId": "18202",
      "playerId": "QB001",
      "playerName": "Patrick Mahomes",
      "franchiseId": "FRAN001",
      "oldContractYears": 2,
      "newContractYears": 3,
      "submittedBy": "Owner Name",
      "submittedAt": "2024-11-20T14:30:00Z",
      "status": "success",
      "mflResponse": { /* ... */ },
      "retryCount": 0
    }
  ]
}
```

#### `POST /api/contracts/retry` - Retry Failed Transaction
Retries a previously failed contract submission.

**Request Body**:
```json
{
  "transactionId": "TXN_1700000000000_def456"
}
```

**Response**:
```json
{
  "success": true,
  "transactionId": "TXN_1700000000000_def456",
  "status": "success",
  "retryCount": 1,
  "playerName": "Jonathan Taylor",
  "mflResponse": { /* ... */ },
  "message": "Contract successfully updated on MFL"
}
```

**File**: `src/pages/api/contracts/retry.ts`

### Utility Modules

#### Contract Validation (`src/utils/contract-validation.ts`)

**Functions**:
- `getContractWindow(now?: Date)` - Determines if currently in a valid contract setting window
- `validateContractSubmission(...)` - Validates all contract submission rules

**Validation Rules**:
- League must be 18202 (test league)
- Contract years must be 1-5 (positive integer)
- New contract years must differ from current
- Required fields: playerId, franchiseId
- Must be within contract setting window

#### Authentication (`src/utils/auth.ts`)

**Functions**:
- `getAuthUser(request)` - Extract authenticated user from request
- `requireAuth(user)` - Type guard for authenticated users
- `isFranchiseOwner(user, franchiseId)` - Verify franchise ownership
- `isAuthorizedForLeague(user, leagueId)` - Verify league authorization

**Note**: Currently placeholder. Will be implemented when message board authentication is replaced.

### Type Definitions (`src/types/contracts.ts`)

```typescript
interface ContractTransaction {
  id: string;
  leagueId: string;
  playerId: string;
  playerName: string;
  franchiseId: string;
  oldContractYears: number;
  newContractYears: number;
  submittedBy: string;
  submittedAt: Date;
  status: 'pending' | 'success' | 'failed' | 'retry_pending';
  mflResponse?: {
    success: boolean;
    message?: string;
    mflTransactionId?: string;
    error?: string;
  };
  retryCount: number;
  lastRetryAt?: Date;
}

interface ContractSubmissionRequest {
  leagueId: string;
  playerId: string;
  playerName: string;
  franchiseId: string;
  oldContractYears: number;
  newContractYears: number;
  submittedBy: string;
}

interface ContractValidationError {
  field: string;
  message: string;
}

interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationError[];
  windowStatus?: {
    inWindow: boolean;
    windowType?: 'offseason' | 'in-season';
    reason?: string;
  };
}
```

## Implementation Details

### Contract Window Calculation

The 3rd Sunday in August is calculated dynamically:

1. Get August 1st of the current year
2. Calculate the first Sunday of August
3. Add 14 days to get the third Sunday
4. Set time to 8:45 PM PT

This ensures the window calculation is always accurate regardless of year.

### MFL API Integration

The feature communicates with MFL using:

- **Endpoint**: `https://www{leagueId % 50}.myfantasyleague.com/{year}/export`
- **Method**: POST
- **Content-Type**: application/x-www-form-urlencoded
- **Parameters**:
  - `TYPE`: "playerContract"
  - `L`: League ID
  - `FRANCHISE_ID`: Franchise ID
  - `PLAYER_ID`: Player ID
  - `CONTRACT_YEARS`: New contract years
  - `JSON`: "1" (request JSON response)

### Error Handling

The system handles various error scenarios:

1. **Authentication Errors** (401): User not logged in
2. **Authorization Errors** (403): User not authorized for league or franchise
3. **Validation Errors** (400): Invalid input data or closed contract window
4. **Network Errors**: Gracefully handled with retry capability
5. **MFL API Errors**: Captured and stored for diagnostics

Failed submissions are stored locally even if MFL push fails, allowing manual admin intervention.

### Storage & Persistence

**Current**: In-memory Map storage (for development)

**TODO**: Replace with persistent database:
- PostgreSQL, MongoDB, or similar
- Transaction history retention policy
- Audit logging
- Admin query capabilities

## Testing

### Test League

All testing should be done with league **18202** (designated test league).

### Manual Testing Steps

1. **Test Contract Submission**:
   - Navigate to `/contracts`
   - Select a player from the eligible players list
   - Change contract years (1-5)
   - Submit and verify success message
   - Check `/contracts/history` for transaction record

2. **Test Window Validation**:
   - System clock set to non-window date
   - Attempt contract submission
   - Verify "Contract Window Closed" message
   - Navigate to offseason window date
   - Verify submission succeeds

3. **Test Retry Mechanism**:
   - (Simulate MFL API failure by disconnecting network)
   - Submit contract during failure
   - Transaction should show "failed" status
   - Navigate to `/contracts/history`
   - Click "Retry" button
   - Verify retry attempt is tracked
   - Verify up to 3 attempts allowed

4. **Test Authorization**:
   - Log in as owner of franchise A
   - Attempt to modify franchise B contract
   - Verify authorization error
   - Verify only own franchise contracts visible

## Future Enhancements

### High Priority
- [ ] Replace in-memory storage with persistent database
- [ ] Implement actual authentication system (replace message board)
- [ ] Integrate with real league player data
- [ ] Build eligible players list from league data
- [ ] Implement "mark as manually synced" API endpoint

### Medium Priority
- [ ] Add pagination to transaction history
- [ ] Implement transaction filtering by date range
- [ ] Add export functionality (CSV, PDF)
- [ ] Create admin dashboard for failed transactions
- [ ] Add email notifications for failed pushes
- [ ] Implement automatic retry scheduler

### Low Priority
- [ ] Add bulk contract submission
- [ ] Create contract history analytics
- [ ] Build contract setting templates
- [ ] Add undo/rollback functionality
- [ ] Create detailed transaction audit log

## Known Issues & TODOs

1. **Database Storage** (Critical)
   - Replace `Map<string, ContractTransaction>` in submit.ts and retry.ts
   - Implement transaction persistence
   - Add indexes on leagueId, franchiseId, status

2. **Authentication** (Critical)
   - Implement actual auth in `getAuthUser()` function
   - Will replace message board authentication when ready

3. **MFL API Verification** (High)
   - Verify exact API endpoint and parameters with MFL
   - Test error response formats
   - Confirm transactionId format

4. **Duplicate Code** (Medium)
   - Extract `pushToMFL()` function into shared utility module
   - Used in both submit.ts and retry.ts
   - Create `src/utils/mfl-api.ts`

5. **Eligible Players** (High)
   - Currently using mock data
   - Implement logic to determine eligible players from league data
   - Track when players were added to determine eligibility

6. **Manual Sync Endpoint** (Medium)
   - Create `/api/contracts/mark-synced` endpoint
   - Implement admin verification workflow
   - Track manual sync status and audit trail

## File Structure

```
src/
├── pages/
│   ├── contracts.astro                  # Main contract management page
│   ├── contracts/
│   │   └── history.astro               # Transaction history page
│   └── api/
│       └── contracts/
│           ├── submit.ts               # Submit contract endpoint
│           └── retry.ts                # Retry failed submission endpoint
├── utils/
│   ├── contract-validation.ts          # Contract validation logic
│   └── auth.ts                         # Authentication utilities
├── types/
│   └── contracts.ts                    # Contract-related TypeScript types
└── layouts/
    └── TheLeagueLayout.astro           # Base layout (used by contract pages)
```

## Deployment Checklist

Before deploying to production:

- [ ] Replace in-memory storage with database
- [ ] Implement real authentication
- [ ] Update eligible players logic
- [ ] Verify MFL API integration with production endpoints
- [ ] Test with multiple leagues
- [ ] Implement admin dashboard for failed transactions
- [ ] Set up monitoring and alerting for failed pushes
- [ ] Document manual sync procedures for admins
- [ ] Train admins on contract management process
- [ ] Create user documentation
- [ ] Set up database backups and recovery procedures

## Support & Troubleshooting

### Common Issues

**Problem**: "Contract Window Closed" message displayed
- **Solution**: Verify current date is within offseason (Feb 15 - 3rd Sunday Aug) or in-season (Weeks 1-17)
- **Code**: Check `getContractWindow()` in `src/utils/contract-validation.ts`

**Problem**: Transaction shows "failed" status
- **Solution**: Check MFL API errors in browser console
- **Action**: Navigate to `/contracts/history` and click "Retry" button

**Problem**: User can't modify other owner's contracts
- **Solution**: Verify user authentication and franchise ownership
- **Code**: Check `isFranchiseOwner()` and `isAuthorizedForLeague()` in `src/utils/auth.ts`

### Debug Logs

Enable debug logging in browser console to monitor:
1. Contract form submission data
2. MFL API request/response
3. Transaction storage updates
4. Retry mechanism attempts

Look for console messages with "Pushing contract to MFL" prefix.

---

**Last Updated**: November 2024
**Status**: Complete - Ready for Testing
**Next Phase**: Database Integration & Authentication Implementation
