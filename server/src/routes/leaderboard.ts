// GET /api/leaderboard — top players by total coins (Mongo or in-memory),
// enriched with each player's LIVE devnet SOL balance so the board reflects
// real on-chain money, not just the virtual coin tally.
import { Router } from 'express';
import { getTopPlayers } from '../services/mongo/leaderboard.js';
import { findUserById } from '../services/auth/userStore.js';
import { getWalletBalanceSol } from '../services/solana/ledger.js';

export const leaderboardRouter = Router();

// Balance lookups hit the devnet RPC once per player per request — cache them
// briefly so a lobby full of refreshing clients doesn't get rate-limited.
const BALANCE_TTL_MS = 10_000;
const balanceCache = new Map<string, { balanceSol: number | null; at: number }>();

async function cachedBalance(walletAddress: string): Promise<number | null> {
  const hit = balanceCache.get(walletAddress);
  if (hit && Date.now() - hit.at < BALANCE_TTL_MS) return hit.balanceSol;
  const balanceSol = await getWalletBalanceSol(walletAddress);
  balanceCache.set(walletAddress, { balanceSol, at: Date.now() });
  return balanceSol;
}

leaderboardRouter.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  try {
    const players = await getTopPlayers(limit);
    const enriched = await Promise.all(
      players.map(async (p) => {
        const user = await findUserById(p.playerId).catch(() => null);
        const walletBalanceSol = user?.walletAddress ? await cachedBalance(user.walletAddress) : null;
        return { ...p, walletBalanceSol };
      }),
    );
    res.json({ players: enriched });
  } catch (err) {
    console.error('[leaderboard] fetch failed:', err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});
