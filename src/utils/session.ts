/**
 * Session Management Utilities
 * Handles JWT token creation, validation, and storage
 * Supports both local file storage (dev) and Upstash Redis (production)
 */

import { createHmac, randomBytes } from 'crypto';

export interface SessionData {
  userId: string;
  username: string;
  franchiseId: string;
  leagueId: string;
  role: 'owner' | 'commissioner' | 'admin';
  issuedAt: number;
  expiresAt: number;
}

interface JWTPayload extends SessionData {
  iat: number;
  exp: number;
}

// Get JWT secret from environment variable
// CRITICAL: Must be consistent across all invocations
let JWT_SECRET: string | null = null;

function getJWTSecret(): string {
  // Return cached secret if available
  if (JWT_SECRET) {
    return JWT_SECRET;
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    // In production, this is a fatal error
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      throw new Error(
        'FATAL: JWT_SECRET environment variable is not set. ' +
        'Set JWT_SECRET in your Vercel environment variables before deploying.'
      );
    }

    // In development, generate a random secret and warn
    console.warn('⚠️  JWT_SECRET not set - using random secret. This will invalidate sessions on restart!');
    JWT_SECRET = randomBytes(32).toString('hex');
  } else {
    JWT_SECRET = secret;
  }

  return JWT_SECRET;
}

/**
 * Create a JWT token for session
 * Token expires in 90 days
 */
export function createSessionToken(sessionData: Omit<SessionData, 'issuedAt' | 'expiresAt'>): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 90 * 24 * 60 * 60; // 90 days in seconds

  const payload: JWTPayload = {
    ...sessionData,
    issuedAt: now,
    expiresAt: now + expiresIn,
    iat: now,
    exp: now + expiresIn,
  };

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  // Simple JWT implementation (header.payload.signature)
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const secret = getJWTSecret();
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Validate and decode a JWT token
 * Returns session data if valid, null if invalid or expired
 */
export function validateSessionToken(token: string): SessionData | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [encodedHeader, encodedPayload, signature] = parts;

    // Verify signature
    const secret = getJWTSecret();
    const expectedSignature = createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf-8')
    ) as JWTPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    return {
      userId: payload.userId,
      username: payload.username,
      franchiseId: payload.franchiseId,
      leagueId: payload.leagueId,
      role: payload.role,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Extract session token from cookie header
 * Cookie format: "session_token=<token>; other=value"
 */
export function getSessionTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const sessionCookie = cookies.find((c) => c.startsWith('session_token='));

  if (!sessionCookie) return null;

  return sessionCookie.substring('session_token='.length);
}

/**
 * Create Set-Cookie header value with security flags
 * httpOnly: prevents JavaScript access
 * Secure: only sent over HTTPS
 * SameSite: prevents CSRF attacks
 */
export function createSessionCookie(token: string, isDev: boolean = false): string {
  const expiresDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString();

  let cookie = `session_token=${token}; Path=/; Expires=${expiresDate}; HttpOnly; SameSite=Lax`;

  // Add Secure flag only in production
  if (!isDev) {
    cookie += '; Secure';
  }

  return cookie;
}

/**
 * Create Set-Cookie header values for MFL credentials.
 * These are stored as httpOnly cookies so server-side API routes
 * can use them for MFL write operations (trades, contracts, etc).
 */
export function createMFLCookies(
  mflUserId: string,
  commishCookie: string | undefined,
  isDev: boolean = false,
): string[] {
  const expiresDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString();
  const secure = isDev ? '' : '; Secure';

  const cookies = [
    `mfl_user_id=${mflUserId}; Path=/; Expires=${expiresDate}; HttpOnly; SameSite=Lax${secure}`,
  ];

  if (commishCookie) {
    cookies.push(
      `mfl_is_commish=${commishCookie}; Path=/; Expires=${expiresDate}; HttpOnly; SameSite=Lax${secure}`,
    );
  }

  return cookies;
}

/**
 * Extract MFL credentials from a request's cookie header.
 * Returns the raw MFL_USER_ID and MFL_IS_COMMISH values for MFL API calls.
 */
export function getMFLCookiesFromRequest(request: Request): {
  mflUserId: string | null;
  mflIsCommish: string | null;
} {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return { mflUserId: null, mflIsCommish: null };

  const cookies = cookieHeader.split(';').map(c => c.trim());

  let mflUserId: string | null = null;
  let mflIsCommish: string | null = null;

  for (const cookie of cookies) {
    if (cookie.startsWith('mfl_user_id=')) {
      mflUserId = cookie.substring('mfl_user_id='.length);
    } else if (cookie.startsWith('mfl_is_commish=')) {
      mflIsCommish = cookie.substring('mfl_is_commish='.length);
    }
  }

  return { mflUserId, mflIsCommish };
}
