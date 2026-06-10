# Authentication & Authorization

## Overview

The **session JWT in the httpOnly cookie is the only identity source.**

> ⚠️ **Removed (June 2026):** the `X-User-Context` and `X-Auth-User` header
> fallbacks were deleted from `getAuthUser()`. They accepted unsigned identity
> from any client, which allowed full auth bypass / privilege escalation
> (claim any franchise or the admin role with a curl header). Any docs or
> examples below that still show those headers are historical — they no longer
> work. For local testing, log in through the normal flow or mint a session
> token with `createSessionToken()` from `src/utils/session.ts`.

## Core Auth Utilities

Location: `src/utils/auth.ts`

### AuthUser Interface
```typescript
interface AuthUser {
  id: string;           // User identifier
  name: string;         // Display name
  franchiseId: string;  // 4-digit franchise ID (e.g., "0001")
  leagueId: string;     // League identifier
  role: 'owner' | 'commissioner' | 'admin';
}
```

### Key Functions

```typescript
// Get authenticated user from request
getAuthUser(request: Request): AuthUser | null

// Verify user is authenticated
requireAuth(user: AuthUser | null): user is AuthUser

// Verify user owns the franchise
isFranchiseOwner(user: AuthUser, franchiseId: string): boolean

// Verify user is authorized for league
isAuthorizedForLeague(user: AuthUser, leagueId: string): boolean
```

## Session Management

Location: `src/utils/session.ts`

### Session Functions
```typescript
// Extract session token from cookie header
getSessionTokenFromCookie(cookieHeader: string | null): string | null

// Validate and decode session token
validateSessionToken(token: string): SessionData | null
```

## Franchise ID Normalization

Franchise IDs are always normalized to 4-digit strings:
- `"1"` → `"0001"`
- `"15"` → `"0015"`
- `"0007"` → `"0007"`

```typescript
const normalizeFranchise = (value: string | null | undefined): string => {
  if (!value) return '';
  const trimmed = `${value}`.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
};
```

## Team Preferences (Cookies)

Location: `src/utils/team-preferences.ts`

For anonymous users, preferences are stored in cookies.

### Cookie System
```typescript
// Get preferred team from cookie
getPreferredTeam(cookies: AstroCookies, league: string): string | null

// Set preferred team cookie
setPreferredTeam(cookies: AstroCookies, league: string, franchiseId: string): void
```

### URL Parameters
Two parameter systems:
- `?myteam=0001` - Sets user's team preference cookie
- `?franchise=0005` - View-only mode (doesn't update preference)

See `PERSONALIZATION.md` for complete cookie system documentation.

## Using Auth in Pages

### Astro Pages
```astro
---
import { getAuthUser } from '../utils/auth';

const user = getAuthUser(Astro.request);

if (!user) {
  return Astro.redirect('/login');
}

// User is authenticated
const { franchiseId, leagueId, role } = user;
---
```

### API Endpoints
```typescript
// src/pages/api/my-endpoint.ts
import type { APIRoute } from 'astro';
import { getAuthUser, isFranchiseOwner } from '../../utils/auth';

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { franchiseId } = await request.json();

  if (!isFranchiseOwner(user, franchiseId)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Process authorized request
  return new Response(JSON.stringify({ success: true }));
};
```

## Testing Auth

### X-Auth-User Header Format
For testing, use colon-delimited format:
```
X-Auth-User: userId:franchiseId:leagueId:name:role
```

Example:
```
X-Auth-User: user123:0001:13522:TestUser:owner
```

### X-User-Context Header Format
JSON format for message board integration:
```json
{
  "id": "user123",
  "name": "TestUser",
  "franchiseId": "0001",
  "leagueId": "13522",
  "role": "owner"
}
```

## MFL Login Integration

Location: `src/utils/mfl-login.ts`

For MFL API authentication (separate from app auth):
```typescript
// Authenticate with MFL for API access
mflLogin(username: string, password: string): Promise<MflSession>
```

Used for write operations that require MFL authentication.
