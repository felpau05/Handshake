// Standalone proof that the ElevenLabs TTS key + call work, independent of
// any UI: synthesizes a hardcoded line and saves it as an .mp3 locally.
//
// Run: npm -w server run test:elevenlabs
// Requires ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID in server/.env.
// Does not touch the live game loop.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../src/config/env.js';
import { synthesizeSpeechBuffer } from '../src/services/elevenlabs/ttsClient.js';

const SAMPLE_LINE = "Rock, paper, scissors — shoot! And the gamemaster calls it for the challenger!";

async function main() {
  if (!features.elevenlabs) {
    throw new Error(
      'ElevenLabs is not configured — set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in server/.env.',
    );
  }

  console.log(`Sample line: "${SAMPLE_LINE}"`);
  console.log('Calling ElevenLabs text-to-speech (eleven_flash_v2_5)...');

  const audio = await synthesizeSpeechBuffer(SAMPLE_LINE);

  const outDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'tts-test.mp3');
  fs.writeFileSync(outPath, audio);

  console.log(`\nSuccess — wrote ${audio.length} bytes.`);
  console.log(`File: ${outPath}`);
}

main().catch((err) => {
  console.error('TTS test failed:', err);
  process.exitCode = 1;
});
