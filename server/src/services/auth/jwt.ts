// Session tokens: a JWT carrying only the user id, stored in an httpOnly
// cookie so client-side JS never sees it (mitigates XSS token theft). The
// cookie itself is what proves identity to the server on every request/socket
// connection — see routes/auth.ts and sockets/handlers.ts.
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export const AUTH_COOKIE_NAME = 'rps_auth';
const TOKEN_TTL = '30d';

export function signAuthToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.AUTH_JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/** Returns the user id encoded in a valid token, or null if missing/invalid/expired. */
export function verifyAuthToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.AUTH_JWT_SECRET);
    if (typeof decoded === 'object' && typeof decoded.sub === 'string') return decoded.sub;
    return null;
  } catch {
    return null;
  }
}

/** Pulls the auth cookie out of a raw `Cookie` header string (used for the Socket.IO handshake, which isn't parsed by cookie-parser). */
export function readAuthCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${AUTH_COOKIE_NAME}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(AUTH_COOKIE_NAME.length + 1));
}
