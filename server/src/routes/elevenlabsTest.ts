// Isolated test endpoints proving the ElevenLabs integration end to end —
// text-to-speech and music generation. Never called from the live game loop;
// exists purely for the standalone test panel/script. The API key stays on
// the server: the client only ever talks to these two routes.
import { Router, type Response } from 'express';
import { z } from 'zod';
import { features } from '../config/env.js';
import { synthesizeSpeechBuffer } from '../services/elevenlabs/ttsClient.js';
import { generateMusic } from '../services/elevenlabs/musicClient.js';

export const elevenlabsTestRouter = Router();

function notConfigured(res: Response) {
  return res.status(503).json({
    configured: false,
    error: 'ElevenLabs is not configured on the server (set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in server/.env).',
  });
}

const ttsBodySchema = z.object({
  text: z.string().min(1).max(1000),
});

elevenlabsTestRouter.post('/tts', async (req, res) => {
  if (!features.elevenlabs) return notConfigured(res);

  const parsed = ttsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
  }

  try {
    const audio = await synthesizeSpeechBuffer(parsed.data.text);
    res.set('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    console.error('[test/tts] failed:', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'TTS request failed' });
  }
});

const musicBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  lengthMs: z.number().int().min(3000).max(600_000).optional(),
});

elevenlabsTestRouter.post('/music', async (req, res) => {
  if (!features.elevenlabs) return notConfigured(res);

  const parsed = musicBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
  }

  try {
    const audio = await generateMusic(parsed.data.prompt, { lengthMs: parsed.data.lengthMs });
    res.set('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    console.error('[test/music] failed:', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Music generation request failed' });
  }
});
