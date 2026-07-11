// GET /api/leaderboard — top players by total coins (Mongo or in-memory).
import { Router } from 'express';
import { getTopPlayers } from '../services/mongo/leaderboard.js';

export const leaderboardRouter = Router();

leaderboardRouter.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  try {
    const players = await getTopPlayers(limit);
    res.json({ players });
  } catch (err) {
    console.error('[leaderboard] fetch failed:', err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});
