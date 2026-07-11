// Resolves a spell round: validate each player's word against the prompt (Gemini,
// or the offline stub), then decide the winner by effective word length. Pure
// orchestration — the length comparison is the shared, unit-tested decideBattle;
// this module just gathers validity and builds the per-player outcomes.
import {
  decideBattle,
  effectiveLength,
  normalizeWord,
  type PlayerSlot,
  type WordOutcome,
} from '@app/shared';
import { validateWord } from '../services/gemini/geminiClient.js';

export interface ResolveInput {
  prompt: string;
  words: Record<PlayerSlot, string | null>;
}

export interface ResolveOutput {
  winner: PlayerSlot | null;
  tie: boolean;
  outcomes: Record<PlayerSlot, WordOutcome>;
}

/** Validate both words (in parallel) and decide the round. */
export async function resolveWordBattle(input: ResolveInput): Promise<ResolveOutput> {
  const { prompt, words } = input;

  const [p1, p2] = await Promise.all([
    buildOutcome(prompt, words.p1),
    buildOutcome(prompt, words.p2),
  ]);

  const { winner, tie } = decideBattle(p1, p2);
  return { winner, tie, outcomes: { p1, p2 } };
}

async function buildOutcome(prompt: string, raw: string | null): Promise<WordOutcome> {
  const word = normalizeWord(raw ?? '');
  if (!word) return { word: '', valid: false, length: 0 };
  const { valid } = await validateWord(word, prompt).catch(() => ({ valid: false }));
  return { word, valid, length: effectiveLength(word, valid) };
}
