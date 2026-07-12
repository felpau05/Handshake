// Resolves a spell round with a single Gemini call: judgeRound() validates
// both words against the prompt, scores complexity/relatedness, decides the
// winner, and writes the narration together. This module just normalizes the
// raw submitted words and reshapes Gemini's judgment into the broadcast
// WordOutcome shape — no separate length-comparison step, since the winner
// comes straight from the judgment.
import { normalizeWord, type PlayerSlot, type WordOutcome } from '@app/shared';
import { judgeRound, type WordJudgment } from '../services/gemini/geminiClient.js';

export interface ResolveInput {
  prompt: string;
  words: Record<PlayerSlot, string | null>;
}

export interface ResolveOutput {
  winner: PlayerSlot | null;
  tie: boolean;
  outcomes: Record<PlayerSlot, WordOutcome>;
  narration: string;
}

/** Judge both words together and reshape the result for GameRoom. */
export async function resolveWordBattle(input: ResolveInput): Promise<ResolveOutput> {
  const { prompt, words } = input;
  const normalized: Record<PlayerSlot, string> = {
    p1: normalizeWord(words.p1 ?? ''),
    p2: normalizeWord(words.p2 ?? ''),
  };

  const judgment = await judgeRound(prompt, normalized);

  return {
    winner: judgment.roundWinner,
    tie: judgment.roundWinner === null,
    outcomes: { p1: toOutcome(judgment.player1), p2: toOutcome(judgment.player2) },
    narration: judgment.narration,
  };
}

function toOutcome(w: WordJudgment): WordOutcome {
  return {
    word: w.word,
    valid: w.valid,
    length: w.valid ? w.word.length : 0,
    complexity: w.complexity,
    relatedness: w.relatedness,
    verdict: w.verdict,
  };
}
