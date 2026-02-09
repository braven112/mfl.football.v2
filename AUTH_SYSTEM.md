# Authentication System Documentation

## Overview

The authentication system provides secure, persistent login for The League using MFL (MyFantasyLeague) credentials. Users log in once and remain authenticated for **90 days**.

### Key Features

✅ **Persistent Sessions** - 90-day JWT tokens stored in httpOnly cookies
✅ **MFL Credential Validation** - Real verification against MFL API
✅ **Secure** - Passwords never stored, only validated against MFL
✅ **Cross-Domain Ready** - Sessions maintained across your domain
✅ **Fraud Prevention** - Prevents owners from submitting wrong team salaries

---

## Architecture

### Authentication Flow

```
1. User visits /theleague
   ↓
2. No session → Redirect to /login
   ↓
3. User enters MFL username/password
   ↓
4. POST to /api/auth/login
   ↓
5. Validate credentials with MFL API
   ↓
6. Create JWT token (expires in 90 days)
   ↓
7. Set httpOnly cookie on user's browser
   ↓
8. Redirect to /theleague
   ↓
9. Future requests: Session JWT automatically included in cookies
   ↓
10. Auth checks pass → Access /theleague
```

### Session Token (JWT)

The system uses **JWT (JSON Web Tokens)** with HS256 signing:

```
Header:    { "alg": "HS256", "typ": "JWT" }
Payload:   {
  "userId": "user123",
  "username": "john.doe",
  "franchiseId": "456",
  "leagueId": "13522",
  "role": "owner",
  "issuedAt": 1700000000,
  "expiresAt": 1707780000   // 90 days later
}
Signature: HMAC-SHA256(header.payload, JWT_SECRET)
```

---

## Files Created

### Session Management
- **[src/utils/session.ts](src/utils/session.ts)** - JWT token creation, validation, cookie handling
- **[src/utils/mfl-login.ts](src/utils/mfl-login.ts)** - MFL API authentication

### API Endpoints
- **[src/pages/api/auth/login.ts](src/pages/api/auth/login.ts)** - POST endpoint for login (validates MFL credentials, creates session)
- **[src/pages/api/auth/me.ts](src/pages/api/auth/me.ts)** - GET endpoint for checking current auth status
- **[src/pages/api/auth/logout.ts](src/pages/api/auth/logout.ts)** - POST endpoint to clear session

### UI Components
- **[src/pages/login.astro](src/pages/login.astro)** - Login page layout
- **[src/components/LoginForm.tsx](src/components/LoginForm.tsx)** - Login form component (username/password input)
- **[src/components/AuthContext.tsx](src/components/AuthContext.tsx)** - React context for auth state across components

### Protected Routes
- **[src/pages/theleague.astro](src/pages/theleague.astro)** - Updated to require authentication

### Updated Files
- **[src/utils/auth.ts](src/utils/auth.ts)** - Updated to check JWT cookies first (highest priority)

---

## API Endpoints

### POST /api/auth/login

**Authenticate user and create session**

Request:
```json
{
  "username": "john.doe",
  "password": "mypassword",
  "leagueId": "13522"  // optional
}
```

Response (Success):
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "username": "john.doe",
    "userId": "user123",
    "franchiseId": "456",
    "leagueId": "13522",
    "role": "owner"
  }
}
```

Response (Failure):
```json
{
  "error": "Authentication failed",
  "message": "Invalid username or password"
}
```

**Side Effects:**
- Sets `session_token` httpOnly cookie (expires in 90 days)
- Cookie is Secure (HTTPS only) and SameSite=Lax in production
- Cookie is HttpOnly (no JavaScript access for security)

---

### GET /api/auth/me

**Check current authentication status**

Request:
```
GET /api/auth/me
Cookie: session_token=<jwt_token>
```

Response (Authenticated):
```json
{
  "authenticated": true,
  "user": {
    "userId": "user123",
    "username": "john.doe",
    "franchiseId": "456",
    "leagueId": "13522",
    "role": "owner"
  },
  "expiresAt": 1707780000
}
```

Response (Not Authenticated):
```json
{
  "authenticated": false,
  "user": null
}
```

---

### POST /api/auth/logout

**Clear session and log out user**

Request:
```
POST /api/auth/logout
```

Response:
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

**Side Effects:**
- Clears `session_token` cookie (sets expiration to past date)

---

## Protected Routes

### /theleague

**Requires authentication. Redirects to /login if not authenticated.**

```astro
// src/pages/theleague.astro
import { getSessionTokenFromCookie, validateSessionToken } from '../utils/session';

const cookieHeader = Astro.request.headers.get('cookie');
const sessionToken = getSessionTokenFromCookie(cookieHeader);
const sessionData = sessionToken ? validateSessionToken(sessionToken) : null;

if (!sessionData) {
  return Astro.redirect('/login');
}
```

---

## Using Authentication in Components

### React Components (Client-Side)

Use the `useAuth` hook:

```tsx
import { useAuth } from '../components/AuthContext';

export default function MyComponent() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();

  if (isLoading) return <p>Loading...</p>;

  if (!isAuthenticated) {
    return <p>Not logged in</p>;
  }

  return (
    <div>
      <p>Welcome, {user.username}!</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Astro Pages (Server-Side)

Check session in frontmatter:

```astro
---
import { getSessionTokenFromCookie, validateSessionToken } from '../utils/session';

const cookieHeader = Astro.request.headers.get('cookie');
const sessionToken = getSessionTokenFromCookie(cookieHeader);
const sessionData = sessionToken ? validateSessionToken(sessionToken) : null;

if (!sessionData) {
  return Astro.redirect('/login');
}

// sessionData contains: userId, username, franchiseId, leagueId, role
---
```

### API Routes (Server-Side)

Use the `getAuthUser` function:

```typescript
import { getAuthUser, requireAuth } from '../utils/auth';

export const POST: APIRoute = async ({ request }) => {
  const authUser = getAuthUser(request);
  if (!requireAuth(authUser)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401
    });
  }

  // authUser is now guaranteed to be AuthUser (not null)
  console.log(`User ${authUser.name} submitted a contract`);
};
```

---

## Environment Variables

### Development

No environment variables needed for local development. The system will:
- Generate a random JWT_SECRET at startup
- Use non-Secure cookies (HTTP OK for localhost)
- Allow development authentication

### Production (Vercel)

Add to your environment variables:

```
JWT_SECRET=<strong-random-secret-key>
NODE_ENV=production
```

The JWT_SECRET should be a strong, random string. Generate one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Security Considerations

### Password Handling
- ✅ Passwords are **never stored** on your server
- ✅ Passwords are transmitted only to MFL API via HTTPS POST
- ✅ Passwords are validated directly against MFL's authentication
- ✅ Only a JWT token is stored (encrypted session identifier)

### Session Token
- ✅ JWT tokens are signed with HMAC-SHA256
- ✅ Tokens are stored in **httpOnly cookies** (JavaScript cannot access)
- ✅ Tokens are marked **Secure** in production (HTTPS only)
- ✅ Tokens use **SameSite=Lax** to prevent CSRF attacks
- ✅ Tokens expire in 90 days (user must re-login)

### Authorization
- ✅ Sessions are validated server-side on every request
- ✅ Expired tokens are rejected
- ✅ Invalid tokens are rejected
- ✅ API endpoints verify user owns/can access the franchise/league

---

## Testing the Authentication System

### 1. Start the Development Server

```bash
npm run dev
```

### 2. Visit Login Page

Open `http://localhost:3000/login` in your browser

### 3. Test Login

Enter your MFL credentials:
- Username: Your MFL username
- Password: Your MFL password
- League ID: 13522 (or your league ID)

Click "Sign In"

### 4. Verify Session

After successful login:
- You should be redirected to `/theleague`
- Cookie `session_token` should be set (check browser DevTools → Application → Cookies)
- Refreshing the page should keep you logged in
- Closing browser and returning should keep session alive (90 days)

### 5. Test Logout

Call the logout endpoint:
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Content-Type: application/json" \
  -b "session_token=<your_token>"
```

### 6. Test /api/auth/me

Check current authentication status:
```bash
curl http://localhost:3000/api/auth/me \
  -b "session_token=<your_token>"
```

---

## Troubleshooting

### "Invalid username or password" error

**Cause:** MFL credentials are incorrect

**Solution:**
- Verify username and password on myfantasyleague.com
- Check if you're using the correct league ID

### Session cookie not being set

**In Development:**
- Check browser DevTools → Console for errors
- Verify `NODE_ENV` is not set to production

**In Production:**
- Verify `JWT_SECRET` environment variable is set
- Check that your domain is HTTPS
- Clear browser cookies and try again

### User redirected to login after page refresh

**Cause:** Session token expired (90 days passed)

**Solution:** User needs to log in again

---

## Future Enhancements

Potential improvements:

1. **Session Storage** - Move from in-memory to database:
   - Upstash Redis for serverless
   - Supabase PostgreSQL for more features
   - Allow invalidating sessions server-side

2. **Multi-League Support** - Allow users to switch between leagues

3. **Role-Based Access Control** - Restrict features based on role:
   - `owner` - Full access
   - `commissioner` - League-wide access
   - `admin` - System-wide access

4. **Audit Logging** - Track login/logout events for security

5. **OAuth Integration** - Allow "Login with Google" or similar

6. **Refresh Tokens** - Extend sessions without re-authentication

---

## References

- [JWT.io - Introduction to JWT](https://jwt.io/introduction)
- [OWASP - Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [MDN - HTTP Cookies](https://developer.mozilla.org/en-us/docs/Web/HTTP/Headers/Set-Cookie)
- [Astro - Middleware](https://docs.astro.build/en/guides/middleware/)
