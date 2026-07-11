// Solana = the coin / trophy ledger. The game only ever depends on the
// CoinLedger INTERFACE, so the demo can run on the in-memory MockLedger while a
// teammate builds the real DevnetLedger behind the same signatures. Selected at
// startup by USE_REAL_SOLANA.
import { env, features } from '../../config/env.js';

export interface MatchSettlement {
  matchId: string;
  results: {
    playerId: string;
    /** Net coin change from this match (already computed by the game). */
    deltaCoins: number;
    won: boolean;
  }[];
}

export interface CoinLedger {
  getBalance(playerId: string): Promise<number>;
  applyDelta(playerId: string, delta: number, reason: string): Promise<void>;
  settleMatch(settlement: MatchSettlement): Promise<void>;
}

// ── Mock: in-memory balances. Default. Perfectly demo-able. ──────────────────
class MockLedger implements CoinLedger {
  private balances = new Map<string, number>();

  async getBalance(playerId: string): Promise<number> {
    return this.balances.get(playerId) ?? 0;
  }
  async applyDelta(playerId: string, delta: number, reason: string): Promise<void> {
    const next = (this.balances.get(playerId) ?? 0) + delta;
    this.balances.set(playerId, next);
    console.log(`[ledger:mock] ${playerId} ${delta >= 0 ? '+' : ''}${delta} (${reason}) → ${next}`);
  }
  async settleMatch(s: MatchSettlement): Promise<void> {
    for (const r of s.results) {
      await this.applyDelta(r.playerId, r.deltaCoins, `match ${s.matchId}`);
    }
  }
}

// ── Devnet: real on-chain settlement. Wire in final hours if time allows. ────
class DevnetLedger implements CoinLedger {
  // TODO(team): construct a Connection(env.SOLANA_RPC_URL) + server Keypair from
  // env.SOLANA_SERVER_SECRET_KEY, and represent coins as an SPL token or memo
  // transactions. Until implemented, delegate to a private mock so nothing breaks.
  private fallback = new MockLedger();

  async getBalance(playerId: string): Promise<number> {
    return this.fallback.getBalance(playerId);
  }
  async applyDelta(playerId: string, delta: number, reason: string): Promise<void> {
    // TODO(team): submit a devnet transaction here.
    return this.fallback.applyDelta(playerId, delta, reason);
  }
  async settleMatch(settlement: MatchSettlement): Promise<void> {
    // TODO(team): batch settle on devnet.
    return this.fallback.settleMatch(settlement);
  }
}

export const ledger: CoinLedger = features.solana ? new DevnetLedger() : new MockLedger();

if (features.solana) {
  console.log(`[ledger] using DevnetLedger via ${env.SOLANA_RPC_URL}`);
} else {
  console.log('[ledger] using in-memory MockLedger (USE_REAL_SOLANA=false)');
}
