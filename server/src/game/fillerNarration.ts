// Small pool of pre-synthesized "hang on" lines, used only to bridge waits
// that genuinely can't be prefetched — the judging result depends on the
// words players actually submitted, so unlike the next prompt reveal (see
// GameRoom's prefetch), there's nothing to precompute ahead of time. Each
// pool is synthesized ONCE (real ElevenLabs audio, cached for the life of the
// process) so playing one costs zero extra latency, no matter how many
// rounds/matches reuse it.
import { textToSpeech } from '../services/elevenlabs/ttsClient.js';

export type FillerKind = 'prompt' | 'resolve';

const FILLER_LINES: Record<FillerKind, string[]> = {
  prompt: ['Get ready…', "Stage is set, here we go…", 'Locking in the next word…'],
  resolve: ['The judges are weighing in…', 'Tallying up the votes…', "Let's see what we've got…"],
};

export interface FillerNarration {
  text: string;
  audioUrl: string | null;
}

const cache: Partial<Record<FillerKind, Promise<FillerNarration[]>>> = {};

function buildPool(kind: FillerKind): Promise<FillerNarration[]> {
  return Promise.all(
    FILLER_LINES[kind].map(async (text) => ({ text, audioUrl: await textToSpeech(text).catch(() => null) })),
  );
}

/** Picks a random cached filler line for `kind`, synthesizing (and caching)
 *  the pool on first use if it wasn't already pre-warmed at startup. */
export async function getFillerNarration(kind: FillerKind): Promise<FillerNarration> {
  if (!cache[kind]) cache[kind] = buildPool(kind);
  const pool = await cache[kind]!;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Call once at server startup so the very first round doesn't pay the
 *  synthesis cost — fire-and-forget; a failure here just means the pool
 *  populates lazily on first real use instead. */
export function prewarmFillerNarration(): void {
  void getFillerNarration('prompt').catch(() => undefined);
  void getFillerNarration('resolve').catch(() => undefined);
}
