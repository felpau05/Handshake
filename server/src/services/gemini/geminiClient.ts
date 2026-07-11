// Gemini = the gamemaster brain for ASL Word Battle. Jobs:
//   1. announcePrompt()  → an energetic reveal line for a prompt word
//   2. validateWord()    → is the word real AND related to the prompt?
//   3. narrate()         → live commentary on the resolved round
//   4. suggestMove()     → a hint of a good word to sign ("says what move to use")
// All degrade gracefully: with no GEMINI_API_KEY they return canned/stub results
// so the game is fully playable offline. Fill in prompt tuning where marked TODO.
import { GoogleGenAI } from '@google/genai';
import { env, features } from '../../config/env.js';
import type { RoundNarrationContext } from '../../game/GameRoom.js';

const ai = features.gemini ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! }) : null;

export interface WordVerdict {
  valid: boolean;
  relates: boolean;
  reason?: string;
}

/** Reveal line for a fresh prompt word (voiced by ElevenLabs). */
export async function announcePrompt(prompt: string, suddenDeath: boolean): Promise<string> {
  if (!ai) return cannedPromptLine(prompt, suddenDeath);
  const flavor = suddenDeath ? 'This is SUDDEN DEATH. ' : '';
  const res = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    // TODO(team): tune tone. One short, hype game-show sentence.
    contents:
      `You are a hype game-show host. ${flavor}The prompt word is "${prompt}". ` +
      `In ONE short sentence, reveal it and tell both players to spell the biggest ` +
      `related word in sign language. No emojis.`,
  });
  return (res.text ?? cannedPromptLine(prompt, suddenDeath)).trim();
}

/**
 * Validate a submitted word: must be a REAL word AND relate to the prompt. The
 * longest VALID word wins the round, so this is the gate. Offline stub accepts
 * any word of 2+ letters so the game still runs on mocks.
 */
export async function validateWord(word: string, prompt: string): Promise<WordVerdict> {
  const clean = word.trim().toLowerCase();
  // Offline stub verdict — also the fallback when a real Gemini call FAILS, so a
  // blocked/misconfigured key degrades to playable offline behavior instead of
  // marking every word invalid.
  const stub: WordVerdict = {
    valid: clean.length >= 2,
    relates: clean.length >= 2,
    reason: clean.length >= 2 ? 'stub-accept' : 'too short',
  };
  if (!ai) return stub;

  try {
    // TODO(team): consider a dictionary check before spending a Gemini call.
    const res = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents:
        `Is "${clean}" a real English word that relates to the theme "${prompt}"? ` +
        `Answer strictly as JSON: {"real": boolean, "relates": boolean}. No prose.`,
    });
    const parsed = parseVerdict(res.text ?? '');
    return { valid: parsed.real && parsed.relates, relates: parsed.relates };
  } catch (err) {
    console.warn(
      '[gemini] validateWord failed, falling back to offline stub:',
      err instanceof Error ? err.message.split('\n')[0] : err,
    );
    return stub;
  }
}

/** Live commentary on a resolved round. */
export async function narrate(ctx: RoundNarrationContext): Promise<string> {
  if (!ai) return cannedNarration(ctx);
  const p1 = ctx.players.p1?.displayName ?? 'Player 1';
  const p2 = ctx.players.p2?.displayName ?? 'Player 2';
  const res = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents:
      `Prompt was "${ctx.prompt}". ${p1} signed "${ctx.words.p1 ?? '(nothing)'}", ` +
      `${p2} signed "${ctx.words.p2 ?? '(nothing)'}". ` +
      `${ctx.winner ? `${ctx.players[ctx.winner]?.displayName} won.` : "It's a tie."} ` +
      `Give ONE short, hype sentence of commentary. No emojis.`,
  });
  return (res.text ?? cannedNarration(ctx)).trim();
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

function cannedNarration(ctx: RoundNarrationContext): string {
  if (!ctx.winner) return "Neck and neck — it's a tie! Sudden death!";
  const name = ctx.players[ctx.winner]?.displayName ?? 'The champ';
  return `${name} spells it out and takes the round!`;
}

function parseVerdict(text: string): { real: boolean; relates: boolean } {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const j = JSON.parse(match[0]);
      return { real: Boolean(j.real), relates: Boolean(j.relates) };
    }
  } catch {
    /* fall through */
  }
  return { real: false, relates: false };
}
