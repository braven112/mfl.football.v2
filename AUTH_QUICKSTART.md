# Authentication System - Quick Start Guide

## What Was Built

A complete authentication system that:
- ✅ Validates users against MyFantasyLeague API
- ✅ Creates 90-day persistent sessions
- ✅ Protects the `/theleague` route
- ✅ Provides login/logout functionality
- ✅ Uses secure httpOnly cookies

---

## Files & What They Do

| File | Purpose |
|------|---------|
| `src/utils/session.ts` | Creates and validates JWT tokens |
| `src/utils/mfl-login.ts` | Talks to MFL API to validate credentials |
| `src/pages/api/auth/login.ts` | Login endpoint - validates credentials, creates session |
| `src/pages/api/auth/me.ts` | Check auth status endpoint |
| `src/pages/api/auth/logout.ts` | Logout endpoint - clears session |
| `src/pages/login.astro` | Login page |
| `src/components/LoginForm.tsx` | Login form component |
| `src/components/AuthContext.tsx` | React context for auth state |
| `src/pages/theleague.astro` | Updated to require login |
| `src/utils/auth.ts` | Updated to check JWT cookies |

---

## How It Works (User's Perspective)

1. **First Visit**
   ```
   User goes to /theleague
   ↓
   Not logged in → Redirect to /login
   ↓
   User enters MFL username/password
   ↓
   User clicks "Sign In"
   ```

2. **After Login**
   ```
   Session created (90-day cookie)
   ↓
   Redirect to /theleague
   ↓
   Access granted
   ```

3. **Return Visits (within 90 days)**
   ```
   User goes to /theleague
   ↓
   Session cookie found
   ↓
   Session validated
   ↓
   Access granted (no login needed)
   ```

4. **After 90 Days**
   ```
   Session expires
   ↓
   User redirected to /login
   ↓
   User logs in again
   ```

---

## Testing Locally

### 1. Start Development Server
```bash
npm run dev
```

### 2. Visit Login Page
```
http://localhost:3000/login
```

### 3. Test Login
Enter your MFL credentials:
- Username: your MFL username
- Password: your MFL password
- League ID: 13522 (or your league number)

### 4. Verify It Works
After clicking "Sign In", you should:
- Be redirected to `/theleague`
- See the league assets page
- Have a `session_token` cookie (check DevTools)
- Stay logged in after page refresh

---

## Production Deployment

### 1. Set Environment Variable

Add to your Vercel environment variables:
```
JWT_SECRET=<generate-a-strong-random-string>
```

Generate a random secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Deploy

```bash
git add .
git commit -m "feat: add MFL authentication system"
git push origin main
```

Vercel will automatically deploy with the auth system.

### 3. Test on Production

Visit: `https://mflfootballv2.vercel.app/login`

---

## What Changed in Existing Files

### `src/pages/theleague.astro`
- Added authentication check
- Redirects to `/login` if not authenticated
- Changed `export const prerender = true` to `false` (server-rendered now)

### `src/utils/auth.ts`
- Added JWT cookie validation (highest priority)
- Still supports old header-based auth (X-Auth-User, X-User-Context)

---

## API Endpoints

All endpoints are at `/api/auth/`:

### `POST /api/auth/login`
**Input:**
```json
{
  "username": "john.doe",
  "password": "password",
  "leagueId": "13522"
}
```
**Output:**
```json
{
  "success": true,
  "user": { "username": "john.doe", "leagueId": "13522", ... }
}
```

### `GET /api/auth/me`
**Output:**
```json
{
  "authenticated": true,
  "user": { "username": "john.doe", ... }
}
```

### `POST /api/auth/logout`
Clears session cookie

---

## Using Auth in Your Components

### In React Components
```tsx
import { useAuth } from '../components/AuthContext';

export default function MyComponent() {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) return <p>Not logged in</p>;
  return <p>Hello, {user.username}!</p>;
}
```

### In Astro Pages
```astro
---
import { getSessionTokenFromCookie, validateSessionToken } from '../utils/session';

const sessionToken = getSessionTokenFromCookie(Astro.request.headers.get('cookie'));
const user = sessionToken ? validateSessionToken(sessionToken) : null;

if (!user) return Astro.redirect('/login');
---
```

### In API Routes
```typescript
import { getAuthUser, requireAuth } from '../utils/auth';

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!requireAuth(user)) {
    return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 401 });
  }

  // user is guaranteed to exist here
};
```

---

## Key Features

✅ **90-Day Sessions** - Users stay logged in for 90 days
✅ **Persistent Across Devices** - Session survives browser restart
✅ **Secure** - httpOnly cookies, HTTPS in production, HMAC signed tokens
✅ **No Password Storage** - Passwords validated directly with MFL
✅ **One-Time Login** - No need to log in to MFL separately
✅ **Fraud Prevention** - Only logged-in users can submit salaries

---

## Security Notes

- ✅ Passwords are never saved anywhere
- ✅ Only validation happens with MFL API
- ✅ Session tokens are signed and validated server-side
- ✅ httpOnly cookies prevent JavaScript from accessing tokens
- ✅ Secure flag (production) prevents transmission over HTTP
- ✅ SameSite=Lax flag prevents CSRF attacks

---

## Troubleshooting

**Q: "Invalid username or password" error**
A: Check your MFL credentials at myfantasyleague.com

**Q: Login form not appearing**
A: Make sure you're visiting `http://localhost:3000/login`

**Q: Session not persisting**
A: Check that cookies are enabled in your browser
   Check DevTools → Application → Cookies for `session_token`

**Q: Can't deploy to Vercel**
A: Make sure `JWT_SECRET` environment variable is set in Vercel

---

## Next Steps (Optional)

1. **Customize Login Page** - Update [src/pages/login.astro](src/pages/login.astro) styling
2. **Add "Remember Me"** - Extend session duration option
3. **Database Integration** - Store sessions in Redis/Supabase instead of JWT
4. **Audit Logging** - Log all login/logout events
5. **Multi-League Support** - Let users switch between leagues
6. **OAuth** - Add "Login with Google" option

---

## Questions?

See the full documentation in [AUTH_SYSTEM.md](AUTH_SYSTEM.md)
