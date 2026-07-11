// ─────────────────────────────────────────────────────────────────────────────
// Canonical Rock-Paper-Scissors rules. Pure functions, no I/O — unit-testable
// and imported by the server's RoundResolver. Keep game-balance logic (powerups,
// twists) OUT of here; this file only knows the base win-matrix.
// ─────────────────────────────────────────────────────────────────────────────

import type { Move } from './types.js';

/** What each move beats. rock < paper < scissors < rock. */
const BEATS: Record<Move, Move> = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

/**
 * Compare two moves.
 * @returns 1 if `a` beats `b`, -1 if `b` beats `a`, 0 for a tie.
 */
export function compareMoves(a: Move, b: Move): 1 | 0 | -1 {
  if (a === b) return 0;
  return BEATS[a] === b ? 1 : -1;
}

/** True when `a` beats `b` outright. */
export function beats(a: Move, b: Move): boolean {
  return compareMoves(a, b) === 1;
}
