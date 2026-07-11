// Pure, deterministic round resolution: takes both players' moves plus the
// active twist and owned powerups, returns the winner and coin deltas. No I/O,
// no randomness — unit-testable (see RoundResolver.test.ts) and demo-safe.
import type { Move, PlayerSlot, TwistId } from '@app/shared';
import { compareMoves } from '@app/shared';

export const BASE_COIN_SWING = 20;
export const STEAL_AMOUNT = 10;

export interface ResolveInput {
  moves: Record<PlayerSlot, Move | null>;
  twist: TwistId | null;
  /** Powerup ids each player owns going into this round. */
  powerups: Record<PlayerSlot, string[]>;
  /** Current coin totals, used by underdog/trailing logic. */
  coins: Record<PlayerSlot, number>;
}

export interface ResolveOutput {
  winner: PlayerSlot | null;
  coinsDelta: Record<PlayerSlot, number>;
  /** Powerup ids consumed this round (caller removes them from inventory). */
  consumed: Record<PlayerSlot, string[]>;
  /** True if the twist ends the match now (SUDDEN_DEATH). */
  suddenDeath: boolean;
}

const other = (s: PlayerSlot): PlayerSlot => (s === 'p1' ? 'p2' : 'p1');

/**
 * Resolve a single round. The order of operations:
 *   1. base compare (with tie-breaker powerups + MIRROR/UNDERDOG twists)
 *   2. determine winner slot (or tie)
 *   3. apply coin swing with DOUBLE_STAKES / double_down / shield / steal
 */
export function resolveRound(input: ResolveInput): ResolveOutput {
  const { moves, twist, powerups, coins } = input;
  const consumed: Record<PlayerSlot, string[]> = { p1: [], p2: [] };

  const m1 = moves.p1;
  const m2 = moves.p2;

  // Forfeit handling: a missing move loses to a present move; both missing = tie.
  let winner: PlayerSlot | null;
  if (!m1 && !m2) winner = null;
  else if (!m1) winner = 'p2';
  else if (!m2) winner = 'p1';
  else winner = decideWinner(m1, m2, twist, powerups, coins);

  const coinsDelta: Record<PlayerSlot, number> = { p1: 0, p2: 0 };
  let suddenDeath = twist === 'SUDDEN_DEATH';

  // MIRROR: a tie awards both the win (no coin swing, but not a loss either).
  if (winner === null) {
    return { winner: null, coinsDelta, consumed, suddenDeath: false };
  }

  const loser = other(winner);
  let swing = twist === 'DOUBLE_STAKES' ? BASE_COIN_SWING * 2 : BASE_COIN_SWING;

  // Winner's one-time double_down.
  if (powerups[winner].includes('double_down')) {
    swing *= 2;
    consumed[winner].push('double_down');
  }

  let winnerGain = swing;
  let loserLoss = swing;

  // Loser's shield negates their loss (still lets winner gain).
  if (powerups[loser].includes('shield')) {
    loserLoss = 0;
    consumed[loser].push('shield');
  }

  // Winner's steal: take extra coins directly from the loser.
  if (powerups[winner].includes('steal')) {
    winnerGain += STEAL_AMOUNT;
    loserLoss += STEAL_AMOUNT;
    consumed[winner].push('steal');
  }

  coinsDelta[winner] = winnerGain;
  coinsDelta[loser] = loserLoss === 0 ? 0 : -loserLoss; // avoid -0

  return { winner, coinsDelta, consumed, suddenDeath };
}

function decideWinner(
  m1: Move,
  m2: Move,
  twist: TwistId | null,
  powerups: Record<PlayerSlot, string[]>,
  coins: Record<PlayerSlot, number>,
): PlayerSlot | null {
  const cmp = compareMoves(m1, m2); // 1 => p1 beats p2
  if (cmp !== 0) return cmp === 1 ? 'p1' : 'p2';

  // It's a tie — apply tie-resolution rules in priority order.
  if (twist === 'MIRROR') return null; // both win; handled by caller as no-swing

  // tie_breaker powerup: owner wins ties (if both own it, falls through to tie).
  const p1Break = powerups.p1.includes('tie_breaker');
  const p2Break = powerups.p2.includes('tie_breaker');
  if (p1Break && !p2Break) return 'p1';
  if (p2Break && !p1Break) return 'p2';

  // UNDERDOG_BOOST: the trailing player wins ties this round.
  if (twist === 'UNDERDOG_BOOST' && coins.p1 !== coins.p2) {
    return coins.p1 < coins.p2 ? 'p1' : 'p2';
  }

  return null; // genuine tie
}
