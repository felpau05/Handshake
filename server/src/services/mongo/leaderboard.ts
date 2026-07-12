// Leaderboard access. Transparently uses MongoDB when connected, otherwise an
// in-memory Map so the game runs with no database. Same function signatures
// either way — callers never branch on which backend is live.
import type { LeaderboardEntry } from '@app/shared';
import { isMongoConnected } from './connection.js';
import { PlayerModel } from './models/Player.js';

// ── In-memory fallback store ─────────────────────────────────────────────────
const memory = new Map<string, LeaderboardEntry>();

export async function getTopPlayers(limit = 10): Promise<LeaderboardEntry[]> {
  if (isMongoConnected()) {
    const docs = await PlayerModel.find().sort({ totalCoins: -1 }).limit(limit).lean();
    return docs.map(toEntry);
  }
  return [...memory.values()].sort((a, b) => b.totalCoins - a.totalCoins).slice(0, limit);
}

export interface UpsertResultInput {
  playerId: string;
  displayName: string;
  deltaCoins: number;
  won: boolean;
}

/** Record a completed match's outcome for a player (coins + W/L). */
export async function upsertPlayerResult(input: UpsertResultInput): Promise<LeaderboardEntry> {
  const { playerId, displayName, deltaCoins, won } = input;

  if (isMongoConnected()) {
    const doc = await PlayerModel.findOneAndUpdate(
      { playerId },
      {
        $setOnInsert: { playerId },
        $set: { displayName },
        $inc: { totalCoins: deltaCoins, wins: won ? 1 : 0, losses: won ? 0 : 1 },
      },
      { upsert: true, new: true },
    ).lean();
    // With upsert + new:true this is always populated, but the driver types it
    // as nullable — guard defensively.
    if (doc) return toEntry(doc);
  }

  // In-memory path.
  const prev = memory.get(playerId) ?? {
    playerId,
    displayName,
    totalCoins: 0,
    wins: 0,
    losses: 0,
    walletBalanceSol: null,
  };
  const next: LeaderboardEntry = {
    ...prev,
    displayName,
    totalCoins: prev.totalCoins + deltaCoins,
    wins: prev.wins + (won ? 1 : 0),
    losses: prev.losses + (won ? 0 : 1),
  };
  memory.set(playerId, next);
  return next;
}

function toEntry(doc: {
  playerId: string;
  displayName: string;
  totalCoins?: number;
  wins?: number;
  losses?: number;
}): LeaderboardEntry {
  return {
    playerId: doc.playerId,
    displayName: doc.displayName,
    totalCoins: doc.totalCoins ?? 0,
    wins: doc.wins ?? 0,
    losses: doc.losses ?? 0,
    // Live balance is attached by the leaderboard route, not stored in Mongo.
    walletBalanceSol: null,
  };
}
