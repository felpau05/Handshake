// ElevenLabs = the gamemaster's voice. textToSpeech() returns a data URL the
// client can drop straight into an <audio> element. With no API key it returns
// null and the game simply shows narration text — no audio.
//
// NOTE: we call the REST API with fetch to avoid adding an SDK dependency; swap
// for @elevenlabs/elevenlabs-js if you prefer. STT / conversational banter
// ("understands the players") is intentionally left as a stub — see below.
import { env, features } from '../../config/env.js';

const TTS_URL = (voiceId: string) =>
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

/** Synthesize narration to a playable audio data URL, or null when stubbed. */
export async function textToSpeech(text: string): Promise<string | null> {
  if (!features.elevenlabs) return null;

  const res = await fetch(TTS_URL(env.ELEVENLABS_VOICE_ID!), {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2_5', // low-latency model for live narration
    }),
  });
  if (!res.ok) {
    console.warn('[elevenlabs] TTS failed:', res.status, await res.text());
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:audio/mpeg;base64,${buf.toString('base64')}`;
}

/**
 * STRETCH / STUB: conversational banter — "understand" a player's spoken line
 * and reply. Left unimplemented on purpose; wire ElevenLabs Conversational AI
 * (or STT + Gemini + TTS) here if time allows.
 */
export async function understandAndReply(_audio: Buffer): Promise<string | null> {
  // TODO(team, stretch): speech-to-text → Gemini banter → textToSpeech.
  return null;
}
