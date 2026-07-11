// POST /api/photo — the winner client uploads a captured frame. We turn it into
// a themed AI portrait (or passthrough when stubbed) and attach it as the
// player's leaderboard avatar. Coins + win/loss are already settled server-side
// at MATCH_END (see GameRoom.settleMatch), so this route ONLY sets the avatar —
// it must not double-count the wager.
import { Router } from 'express';
import { z } from 'zod';
import { generateStylizedPortrait } from '../services/imagegen/imageGenClient.js';
import { setPlayerAvatar } from '../services/mongo/leaderboard.js';

export const photoRouter = Router();

const bodySchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1),
  /** data URL or raw base64 of the winner's captured frame. */
  photo: z.string().min(1),
});

photoRouter.post('/', async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid photo payload', details: parsed.error.flatten() });
  }
  const { playerId, photo } = parsed.data;

  try {
    const avatarUrl = await generateStylizedPortrait(photo);
    await setPlayerAvatar(playerId, avatarUrl);
    res.json({ avatarUrl });
  } catch (err) {
    console.error('[photo] processing failed:', err);
    res.status(500).json({ error: 'Failed to process winner photo' });
  }
});
