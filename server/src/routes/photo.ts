// POST /api/photo — the winner client uploads a captured frame. We turn it into
// a themed AI portrait (or passthrough when stubbed), attach it as the player's
// leaderboard avatar, and record the win. Returns the avatar so the client can
// show it immediately.
import { Router } from 'express';
import { z } from 'zod';
import { generateStylizedPortrait } from '../services/imagegen/imageGenClient.js';
import { setPlayerAvatar, upsertPlayerResult } from '../services/mongo/leaderboard.js';

export const photoRouter = Router();

const bodySchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1),
  /** data URL or raw base64 of the winner's captured frame. */
  photo: z.string().min(1),
  /** Coins won this match (already computed client/server-side). */
  deltaCoins: z.number().default(0),
});

photoRouter.post('/', async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid photo payload', details: parsed.error.flatten() });
  }
  const { playerId, displayName, photo, deltaCoins } = parsed.data;

  try {
    const avatarUrl = await generateStylizedPortrait(photo);
    const entry = await upsertPlayerResult({
      playerId,
      displayName,
      deltaCoins,
      won: true,
      avatarUrl,
    });
    // Ensure the avatar sticks even if the upsert path didn't set it.
    await setPlayerAvatar(playerId, avatarUrl);
    res.json({ avatarUrl, entry });
  } catch (err) {
    console.error('[photo] processing failed:', err);
    res.status(500).json({ error: 'Failed to process winner photo' });
  }
});
