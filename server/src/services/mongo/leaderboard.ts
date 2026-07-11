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
  avatarUrl?: string | null;
}

/** Record a completed match's outcome for a player (coins + W/L + optional avatar). */
export async function upsertPlayerResult(input: UpsertResultInput): Promise<LeaderboardEntry> {
  const { playerId, displayName, deltaCoins, won, avatarUrl } = input;

  if (isMongoConnected()) {
    const doc = await PlayerModel.findOneAndUpdate(
      { playerId },
      {
        $setOnInsert: { playerId },
        $set: { displayName, ...(avatarUrl !== undefined ? { avatarUrl } : {}) },
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
    avatarUrl: null,
    totalCoins: 0,
    wins: 0,
    losses: 0,
  };
  const next: LeaderboardEntry = {
    ...prev,
    displayName,
    avatarUrl: avatarUrl !== undefined ? avatarUrl : prev.avatarUrl,
    totalCoins: prev.totalCoins + deltaCoins,
    wins: prev.wins + (won ? 1 : 0),
    losses: prev.losses + (won ? 0 : 1),
  };
  memory.set(playerId, next);
  return next;
}

/** Attach/replace a player's AI-generated avatar. */
export async function setPlayerAvatar(playerId: string, avatarUrl: string): Promise<void> {
  if (isMongoConnected()) {
    await PlayerModel.updateOne({ playerId }, { $set: { avatarUrl } });
    return;
  }
  const entry = memory.get(playerId);
  if (entry) entry.avatarUrl = avatarUrl;
}

function toEntry(doc: {
  playerId: string;
  displayName: string;
  avatarUrl?: string | null;
  totalCoins?: number;
  wins?: number;
  losses?: number;
}): LeaderboardEntry {
  return {
    playerId: doc.playerId,
    displayName: doc.displayName,
    avatarUrl: doc.avatarUrl ?? null,
    totalCoins: doc.totalCoins ?? 0,
    wins: doc.wins ?? 0,
    losses: doc.losses ?? 0,
  };
}
