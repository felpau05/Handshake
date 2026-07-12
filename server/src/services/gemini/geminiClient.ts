// Gemini = the gamemaster brain for ASL Word Battle. Jobs:
//   1. announcePrompt() → an energetic reveal line for a prompt word
//   2. judgeRound()     → ONE call that validates + scores BOTH words, decides
//                         the round winner, and writes the narration together
//                         (replaces the old separate validateWord()/narrate()
//                         pair, which cost 3 Gemini calls per round for 1).
//   3. suggestMove()    → a hint of a good word to sign ("says what move to use")
// All degrade gracefully: with no GEMINI_API_KEY they return canned/stub results
// so the game is fully playable offline. Fill in prompt tuning where marked TODO.
import type { PlayerSlot } from '@app/shared';
import { env } from '../../config/env.js';
import { createGeminiClient } from './client.js';

const ai = createGeminiClient();

/** Gemini's judgment of a single player's word. */
export interface WordJudgment {
  word: string;
  /** A real word AND related to the prompt. Invalid words can't win the round. */
  valid: boolean;
  /** 0–10: how sophisticated/impressive the word is. 0 when invalid. */
  complexity: number;
  /** 0–10: how well the word relates to the prompt. 0 when invalid. */
  relatedness: number;
  /** One short punchy line judging this specific word. */
  verdict: string;
}

/** The full judged outcome of a round — one Gemini call produces all of this. */
export interface RoundJudgment {
  player1: WordJudgment;
  player2: WordJudgment;
  /** null means a genuine tie/toss-up → GameRoom triggers sudden death. */
  roundWinner: PlayerSlot | null;
  /** One hype sentence announcing the round outcome, naming both words. */
  narration: string;
}

/** Reveal line for a fresh prompt word (voiced by ElevenLabs). */
export async function announcePrompt(prompt: string, suddenDeath: boolean): Promise<string> {
  if (!ai) return cannedPromptLine(prompt, suddenDeath);
  const flavor = suddenDeath
    ? 'This is SUDDEN DEATH — raise the stakes, sound a little unhinged about it. '
    : '';
  const res = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents:
      `You're a snarky, high-energy game-show host with zero patience for boring ` +
      `words. ${flavor}The theme is "${prompt}". In ONE short, funny sentence, ` +
      `reveal it and dare both players to sign the biggest, most impressive ` +
      `related word they've got — sound like you're already expecting someone to ` +
      `embarrass themselves. No emojis, no markdown/asterisks — this gets read ` +
      `aloud and shown as plain text.`,
  });
  return (res.text ?? cannedPromptLine(prompt, suddenDeath)).trim();
}

/**
 * ONE call that judges an entire round: validates both words against the
 * prompt, scores each on complexity + relatedness, decides the winner
 * (invalid/unrelated loses regardless of raw length), and writes the
 * narration — all in the same response, so a round costs one Gemini call
 * instead of three. Never throws: any failure (no key, bad JSON, network)
 * degrades to a deterministic offline stub so the match always resolves.
 */
export async function judgeRound(
  prompt: string,
  words: Record<PlayerSlot, string>,
): Promise<RoundJudgment> {
  const stub = stubJudgment(prompt, words);
  if (!ai) return stub;

  try {
    const res = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents:
        `You are a witty, slightly savage judge and hype host for an ASL ` +
        `fingerspelling word battle — think game-show host crossed with a roast ` +
        `comedian, but the roasting is aimed at the WORD CHOICES, never at the ` +
        `players themselves. ` +
        `The theme is "${prompt}". ` +
        `Player 1 signed "${words.p1 || '(nothing)'}". ` +
        `Player 2 signed "${words.p2 || '(nothing)'}". ` +
        `For each player, judge: valid (a real English word), complexity ` +
        `(0-10, how sophisticated/impressive the word is), relatedness (0-10, ` +
        `how well it relates to the theme; 0 if invalid), and a short, funny, ` +
        `punchy verdict line reacting to THAT specific word — roast a weak or ` +
        `unrelated pick, hype up a clever one. ` +
        `Then decide roundWinner ("p1" or "p2") by weighing validity, ` +
        `relatedness, and complexity together — an invalid or unrelated word ` +
        `must lose to a valid related one regardless of raw length. If it's a ` +
        `genuine toss-up (both equally strong, or both weak/invalid), ` +
        `roundWinner is null. ` +
        `Finally write ONE short, funny, snarky sentence of narration that ` +
        `actually reacts to what happened: if there's a winner, name both ` +
        `words and razz the loser's pick while hyping the winner's; if ` +
        `roundWinner is null, lean into the anticlimax of a dead-even standoff ` +
        `and tease that it's headed to sudden death — do NOT declare a winner ` +
        `in that line. Every string value (verdict, narration) is plain text, ` +
        `read aloud and shown as-is — no markdown, no asterisks, no emojis. ` +
        `Respond with ONLY strict JSON, no prose, no markdown fences, in exactly ` +
        `this shape: {"player1":{"word":string,"valid":boolean,"complexity":number,` +
        `"relatedness":number,"verdict":string},"player2":{...same shape...},` +
        `"roundWinner":"p1"|"p2"|null,"narration":string}`,
    });
    return parseRoundJudgment(res.text ?? '', words) ?? stub;
  } catch (err) {
    console.warn(
      '[gemini] judgeRound failed, falling back to offline stub:',
      err instanceof Error ? err.message.split('\n')[0] : err,
    );
    return stub;
  }
}

/** Optional hint of a strong word to sign ("says what move to use"). */
export async function suggestMove(prompt: string): Promise<string | null> {
  if (!ai) return null;
  const res = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents:
      `Suggest ONE fairly long English word (no letters J or Z) that relates to ` +
      `"${prompt}". Reply with just the word.`,
  });
  const word = (res.text ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return word || null;
}

// ── Offline / stub helpers ───────────────────────────────────────────────────

function cannedPromptLine(prompt: string, suddenDeath: boolean): string {
  return suddenDeath
    ? `Sudden death! Biggest word for "${prompt}" wins it all!`
    : `Your prompt is "${prompt}" — sign the biggest related word you can!`;
}

/**
 * Deterministic offline judgment — used with no Gemini credential configured,
 * and as the fallback when a real call fails or returns unparseable JSON.
 * Accepts any word of 2+ letters (mirroring the old validateWord stub) and
 * picks the winner by length, same rule as shared/rules.ts's decideBattle.
 * Exported so tests can exercise this deterministic path directly rather than
 * through judgeRound(), which correctly calls the real API whenever a
 * credential IS configured — including in dev/test environments that happen
 * to have one in server/.env.
 */
export function stubJudgment(prompt: string, words: Record<PlayerSlot, string>): RoundJudgment {
  const mk = (word: string): WordJudgment => {
    const valid = word.length >= 2;
    return {
      word,
      valid,
      complexity: valid ? Math.min(10, word.length) : 0,
      relatedness: valid ? 10 : 0,
      verdict: valid ? 'Accepted (offline stub).' : 'Too short or empty.',
    };
  };
  const player1 = mk(words.p1);
  const player2 = mk(words.p2);
  const roundWinner: PlayerSlot | null =
    player1.valid !== player2.valid
      ? player1.valid
        ? 'p1'
        : 'p2'
      : player1.valid && player1.word.length !== player2.word.length
        ? player1.word.length > player2.word.length
          ? 'p1'
          : 'p2'
        : null;
  const narration = roundWinner
    ? `${roundWinner === 'p1' ? words.p1 : words.p2} takes it for "${prompt}"!`
    : "It's a tie — sudden death!";
  return { player1, player2, roundWinner, narration };
}

/** Parses judgeRound's expected JSON shape; returns null on any mismatch so
 *  the caller falls back to the offline stub instead of trusting garbage. */
function parseRoundJudgment(text: string, words: Record<PlayerSlot, string>): RoundJudgment | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const j = JSON.parse(match[0]);
    // The actual word is authoritative — it's the exact string we submitted,
    // never Gemini's echo of it, which can drift (e.g. parroting back the
    // "(nothing)" placeholder we send for prompt context on an empty word).
    const toJudgment = (raw: unknown, actualWord: string): WordJudgment => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const valid = Boolean(o.valid);
      return {
        word: actualWord,
        valid,
        complexity: valid ? clamp0to10(o.complexity) : 0,
        relatedness: valid ? clamp0to10(o.relatedness) : 0,
        verdict: typeof o.verdict === 'string' ? o.verdict : '',
      };
    };
    const roundWinner = j.roundWinner === 'p1' || j.roundWinner === 'p2' ? j.roundWinner : null;
    return {
      player1: toJudgment(j.player1, words.p1),
      player2: toJudgment(j.player2, words.p2),
      roundWinner,
      narration: typeof j.narration === 'string' && j.narration ? j.narration : '',
    };
  } catch {
    return null;
  }
}

function clamp0to10(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}
