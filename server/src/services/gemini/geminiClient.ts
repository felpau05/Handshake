// Gemini = the gamemaster brain. Two jobs:
//   1. narrateRound()      → punchy live commentary text
//   2. proposeBalanceTwist() → optionally pick ONE whitelisted twist
// Both degrade gracefully: with no GEMINI_API_KEY they return canned/no-op
// results so the game is fully playable offline. Fill in the real prompt/parsing
// where marked TODO.
import { GoogleGenAI } from '@google/genai';
import { TWIST_IDS, type MatchState, type TwistId } from '@app/shared';
import { env, features } from '../../config/env.js';
import type { RoundNarrationContext } from '../../game/GameRoom.js';

const ai = features.gemini ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! }) : null;

/** Live commentary for a round intro or result. */
export async function narrateRound(ctx: RoundNarrationContext): Promise<string> {
  if (!ai) return cannedNarration(ctx);

  // TODO(team): tune this prompt. Keep it to ONE short, energetic sentence.
  const prompt = buildNarrationPrompt(ctx);
  const res = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
  });
  return (res.text ?? cannedNarration(ctx)).trim();
}

/**
 * Optionally introduce a balance twist for the upcoming round. MUST return a
 * value from the whitelisted TwistId enum (or null) so round resolution stays
 * deterministic — never let the model invent free-form rules.
 */
export async function proposeBalanceTwist(state: MatchState): Promise<TwistId | null> {
  if (!ai) return null; // stub: no twists offline

  // TODO(team): give the model the score gap and ask for a twist id or "NONE".
  const prompt =
    `You are balancing a rock-paper-scissors match. Coins — ` +
    `p1: ${state.players.p1?.coins}, p2: ${state.players.p2?.coins}. ` +
    `Reply with EXACTLY ONE of: ${TWIST_IDS.join(', ')}, or NONE.`;
  const res = await ai.models.generateContent({ model: env.GEMINI_MODEL, contents: prompt });
  const raw = (res.text ?? 'NONE').trim().toUpperCase();
  return (TWIST_IDS as readonly string[]).includes(raw) ? (raw as TwistId) : null;
}

// ── Offline / stub helpers ───────────────────────────────────────────────────

function buildNarrationPrompt(ctx: RoundNarrationContext): string {
  const p1 = ctx.players.p1?.displayName ?? 'Player 1';
  const p2 = ctx.players.p2?.displayName ?? 'Player 2';
  const moves = ctx.moves.p1
    ? `${p1} played ${ctx.moves.p1}, ${p2} played ${ctx.moves.p2}.`
    : `Round ${ctx.round} is about to begin.`;
  const winner = ctx.winner
    ? `${ctx.players[ctx.winner]?.displayName} won the round.`
    : ctx.moves.p1
      ? "It's a tie."
      : '';
  return (
    `You are an over-the-top game show host narrating a rock-paper-scissors duel. ` +
    `${moves} ${winner} Respond with ONE short, hype sentence. No emojis.`
  );
}

function cannedNarration(ctx: RoundNarrationContext): string {
  if (!ctx.moves.p1 && !ctx.moves.p2) {
    return `Round ${ctx.round} — hands at the ready!`;
  }
  if (!ctx.winner) return "A dead heat — nobody gives an inch!";
  const name = ctx.players[ctx.winner]?.displayName ?? 'The champ';
  return `${name} strikes with ${ctx.moves[ctx.winner]} and takes the round!`;
}
