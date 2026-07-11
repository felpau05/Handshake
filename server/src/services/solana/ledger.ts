// Solana = the coin / trophy ledger. The game only ever depends on the
// CoinLedger INTERFACE, so the demo can run on the in-memory MockLedger while a
// teammate builds the real DevnetLedger behind the same signatures. Selected at
// startup by USE_REAL_SOLANA.
import fs from 'node:fs';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
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

// ── Devnet plumbing: shared by DevnetLedger and the standalone proof script ──

/** Loads a Solana CLI-format keypair file (JSON array of 64 secret key bytes). */
export function loadKeypairFromFile(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function getConnection(): Connection {
  return new Connection(env.SOLANA_RPC_URL, 'confirmed');
}

export type TransferResult = { ok: true; signature: string } | { ok: false; error: unknown };

/**
 * Fires a single SOL transfer from `sender` to `recipient` and waits for
 * confirmation. Never throws — callers get { ok: false } on any failure
 * (RPC lag, insufficient funds, etc.) instead of an exception.
 */
export async function transferSol(
  connection: Connection,
  sender: Keypair,
  recipient: PublicKey,
  amountSol: number,
): Promise<TransferResult> {
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient,
        lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
      }),
    );
    const signature = await sendAndConfirmTransaction(connection, tx, [sender], {
      commitment: 'confirmed',
    });
    return { ok: true, signature };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * playerId -> devnet wallet address, sourced from SOLANA_PLAYER_WALLETS
 * (JSON, e.g. {"p1":"<base58 address>"}). Empty until real player wallets
 * exist — that's expected right now, not an error.
 */
function resolvePlayerWallet(playerId: string): PublicKey | undefined {
  if (!env.SOLANA_PLAYER_WALLETS) return undefined;
  try {
    const map = JSON.parse(env.SOLANA_PLAYER_WALLETS) as Record<string, string>;
    const address = map[playerId];
    return address ? new PublicKey(address) : undefined;
  } catch {
    return undefined;
  }
}

// ── Devnet: real on-chain settlement. ────────────────────────────────────────
class DevnetLedger implements CoinLedger {
  // Virtual coin bookkeeping (per-round +20/-20 etc.) stays in-memory, same as
  // the mock — only the once-per-match bet settlement below touches the chain.
  private fallback = new MockLedger();
  private connection = getConnection();
  private sender: Keypair | null = null;

  constructor() {
    try {
      if (env.SOLANA_KEYPAIR_PATH) {
        this.sender = loadKeypairFromFile(env.SOLANA_KEYPAIR_PATH);
        console.log(`[ledger:devnet] sender wallet ${this.sender.publicKey.toBase58()}`);
      }
    } catch (err) {
      console.error('[ledger:devnet] failed to load sender keypair — on-chain settlement disabled:', err);
    }
  }

  async getBalance(playerId: string): Promise<number> {
    return this.fallback.getBalance(playerId);
  }

  async applyDelta(playerId: string, delta: number, reason: string): Promise<void> {
    return this.fallback.applyDelta(playerId, delta, reason);
  }

  /**
   * Best-effort on-chain settlement, fired once per match (never per round):
   * transfers the configured bet amount from the server wallet to the
   * winner's devnet address. A chain failure is logged and swallowed — the
   * game already knows the winner and must not break because of it.
   */
  async settleMatch(settlement: MatchSettlement): Promise<void> {
    await this.fallback.settleMatch(settlement);

    if (!this.sender) {
      console.warn('[ledger:devnet] no sender keypair loaded — skipping on-chain settlement');
      return;
    }

    const winner = settlement.results.find((r) => r.won);
    const recipient = winner ? resolvePlayerWallet(winner.playerId) : undefined;
    if (!winner || !recipient) {
      console.warn(
        `[ledger:devnet] match ${settlement.matchId}: no devnet wallet on file for the winner — skipping on-chain settlement`,
      );
      return;
    }

    const result = await transferSol(this.connection, this.sender, recipient, env.SOLANA_BET_SOL);
    if (result.ok) {
      console.log(
        `[ledger:devnet] match ${settlement.matchId}: settled ${env.SOLANA_BET_SOL} SOL to ${winner.playerId} (tx ${result.signature})`,
      );
    } else {
      console.error(`[ledger:devnet] match ${settlement.matchId}: on-chain settlement failed`, result.error);
    }
  }
}

export const ledger: CoinLedger = features.solana ? new DevnetLedger() : new MockLedger();

if (features.solana) {
  console.log(`[ledger] using DevnetLedger via ${env.SOLANA_RPC_URL}`);
} else {
  console.log('[ledger] using in-memory MockLedger (USE_REAL_SOLANA=false)');
}
