// The pre-match shop. Each player gets STARTING_TOKENS to spend before a match.
// Powerup EFFECTS are applied in RoundResolver.ts — this file only defines the
// catalog and cost. Keep total temptation high enough that 10 tokens forces a
// real choice.
import type { Powerup } from '@app/shared';

export const STARTING_TOKENS = 10;

export const POWERUP_CATALOG: Powerup[] = [
  {
    id: 'shield',
    name: 'Shield',
    description: 'Negate your coin loss on one lost round.',
    cost: 4,
    oneTimeUse: true,
  },
  {
    id: 'double_down',
    name: 'Double Down',
    description: 'Your next round win pays double coins.',
    cost: 5,
    oneTimeUse: true,
  },
  {
    id: 'tie_breaker',
    name: 'Tie Breaker',
    description: 'You win ties for the rest of the match.',
    cost: 6,
    oneTimeUse: false,
  },
  {
    id: 'insight',
    name: "Gamemaster's Insight",
    description: 'The gamemaster hints at a strong move before capture.',
    cost: 3,
    oneTimeUse: true,
  },
  {
    id: 'steal',
    name: 'Coin Steal',
    description: 'On your next win, also take 10 coins from your opponent.',
    cost: 7,
    oneTimeUse: true,
  },
  {
    id: 'second_wind',
    name: 'Second Wind',
    description: 'Re-capture your gesture once if you miss the deadline.',
    cost: 2,
    oneTimeUse: true,
  },
];

const byId = new Map(POWERUP_CATALOG.map((p) => [p.id, p]));

export function getPowerup(id: string): Powerup | undefined {
  return byId.get(id);
}

/**
 * Validate a purchase against the catalog and a token budget.
 * Returns the accepted powerup ids and total spent, rejecting unknown ids or
 * anything that would blow the budget. Server-authoritative — never trust the
 * client's own totals.
 */
export function validatePurchase(
  powerupIds: string[],
  budget: number,
): { accepted: string[]; spent: number; error?: string } {
  const accepted: string[] = [];
  let spent = 0;
  for (const id of powerupIds) {
    const p = byId.get(id);
    if (!p) return { accepted: [], spent: 0, error: `Unknown powerup: ${id}` };
    if (spent + p.cost > budget) {
      return { accepted: [], spent: 0, error: 'Purchase exceeds token budget' };
    }
    accepted.push(id);
    spent += p.cost;
  }
  return { accepted, spent };
}
