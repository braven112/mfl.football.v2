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
function getJWTSecret(): string {
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
    return randomBytes(32).toString('hex');
  }

  return secret;
}

const JWT_SECRET = getJWTSecret();

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

  const signature = createHmac('sha256', JWT_SECRET)
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
    const expectedSignature = createHmac('sha256', JWT_SECRET)
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

  let cookie = `session_token=${token}; Path=/; Expires=${expiresDate}; HttpOnly`;

  // Add Secure flag only in production
  if (!isDev) {
    cookie += '; Secure; SameSite=Lax';
  }

  return cookie;
}
