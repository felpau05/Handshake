// ─────────────────────────────────────────────────────────────────────────────
// Pure ASL Word Battle rules. No I/O — unit-testable and shared by client and
// server. Validity (real word + relates to prompt) is decided by Gemini on the
// server; this file only turns two validated words into a winner by length.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlayerSlot, WordOutcome } from './types.js';

/** Normalize a submitted word: trim, lowercase, letters only. */
export function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/[^a-z]/g, '');
}

/** Effective comparison length: the word's letter count, or 0 if invalid. */
export function effectiveLength(word: string, valid: boolean): number {
  return valid ? normalizeWord(word).length : 0;
}

export interface BattleDecision {
  /** Winner slot, or null when tied (both invalid, or equal valid length). */
  winner: PlayerSlot | null;
  /** True when the round is tied and a sudden-death prompt should follow. */
  tie: boolean;
}

/**
 * Decide a round from both players' validated words. The longer valid word wins.
 * Equal effective lengths (including both-invalid = 0/0) is a tie → sudden death.
 */
export function decideBattle(p1: WordOutcome, p2: WordOutcome): BattleDecision {
  if (p1.length === p2.length) return { winner: null, tie: true };
  return { winner: p1.length > p2.length ? 'p1' : 'p2', tie: false };
}
