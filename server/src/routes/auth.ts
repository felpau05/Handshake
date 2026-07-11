// Account auth: register / login / logout / me / wallet address. Sessions are
// an httpOnly JWT cookie (see services/auth/jwt.ts) — the client never handles
// the token directly, only ever the public user profile.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { AUTH_COOKIE_NAME, signAuthToken, verifyAuthToken } from '../services/auth/jwt.js';
import { verifyPassword } from '../services/auth/passwords.js';
import {
  EmailAlreadyRegisteredError,
  InvalidWalletAddressError,
  findUserByEmailInternal,
  findUserById,
  registerUser,
  updateWalletAddress,
} from '../services/auth/userStore.js';

export const authRouter = Router();

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches the JWT TTL

function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

/** Rejects with 401 unless a valid session cookie is present; attaches req.userId. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = verifyAuthToken(req.cookies?.[AUTH_COOKIE_NAME]);
  if (!userId) return res.status(401).json({ error: 'Not logged in.' });
  req.userId = userId;
  next();
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  displayName: z.string().min(1).max(40),
  walletAddress: z.string().min(1).optional(),
});

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  try {
    const user = await registerUser(parsed.data);
    setAuthCookie(res, signAuthToken(user.id));
    res.status(201).json({ user });
  } catch (err) {
    if (err instanceof EmailAlreadyRegisteredError || err instanceof InvalidWalletAddressError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[auth] register failed:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid email or password.' });
  }
  try {
    const user = await findUserByEmailInternal(parsed.data.email);
    const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
    if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password.' });

    const { passwordHash: _passwordHash, ...publicUser } = user;
    setAuthCookie(res, signAuthToken(user.id));
    res.json({ user: publicUser });
  } catch (err) {
    console.error('[auth] login failed:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.userId!);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user });
});

const walletSchema = z.object({
  walletAddress: z.string().min(1).nullable(),
});

authRouter.patch('/wallet', requireAuth, async (req, res) => {
  const parsed = walletSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  try {
    const user = await updateWalletAddress(req.userId!, parsed.data.walletAddress);
    if (!user) return res.status(401).json({ error: 'Not logged in.' });
    res.json({ user });
  } catch (err) {
    if (err instanceof InvalidWalletAddressError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[auth] wallet update failed:', err);
    res.status(500).json({ error: 'Failed to update wallet address.' });
  }
});
