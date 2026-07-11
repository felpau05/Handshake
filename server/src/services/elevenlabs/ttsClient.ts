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

/**
 * Raw TTS call shared by the in-game narrator (textToSpeech, below) and the
 * standalone ElevenLabs test panel/script. Throws (with the upstream error
 * text) on misconfiguration or API failure — the test panel wants that detail
 * surfaced; textToSpeech() catches it to keep its own null-on-failure contract.
 */
export async function synthesizeSpeechBuffer(text: string): Promise<Buffer> {
  if (!features.elevenlabs) {
    throw new Error('ElevenLabs is not configured (missing ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID)');
  }

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
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Synthesize narration to a playable audio data URL, or null when stubbed/failed. */
export async function textToSpeech(text: string): Promise<string | null> {
  try {
    const buf = await synthesizeSpeechBuffer(text);
    return `data:audio/mpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    console.warn('[elevenlabs] TTS failed:', err);
    return null;
  }
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
