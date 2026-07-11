// ElevenLabs music generation — separate capability from narration TTS
// (ttsClient.ts). This is a slow, batch-style call (can take tens of seconds),
// not a low-latency one, so it's kept in its own wrapper/route and is never
// called from the live game loop.
//
// Endpoint confirmed against ElevenLabs docs (elevenlabs.io/docs/api-reference/
// music/compose): POST /v1/music, header xi-api-key, JSON body
// { prompt, model_id, music_length_ms }, response is raw audio bytes
// (application/octet-stream, MP3 by default).
import { env, features } from '../../config/env.js';

const MUSIC_URL = 'https://api.elevenlabs.io/v1/music';

/** Generous timeout — music composition can take a while server-side. */
const MUSIC_TIMEOUT_MS = 120_000;

export interface GenerateMusicOptions {
  /** Song duration in ms. ElevenLabs range: 3000–600000. */
  lengthMs?: number;
}

/**
 * Compose a short music clip from a text prompt. Throws (with the upstream
 * error text) on misconfiguration or API failure — callers decide how to
 * surface that; this is a test-only wrapper with no in-game caller.
 */
export async function generateMusic(
  prompt: string,
  opts: GenerateMusicOptions = {},
): Promise<Buffer> {
  if (!features.elevenlabs) {
    throw new Error('ElevenLabs is not configured (missing ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID)');
  }

  const res = await fetch(MUSIC_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      prompt,
      model_id: 'music_v1',
      music_length_ms: opts.lengthMs ?? 10_000,
    }),
    signal: AbortSignal.timeout(MUSIC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs music generation failed (${res.status}): ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
