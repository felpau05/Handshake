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
import { findUserById } from '../auth/userStore.js';

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
  /**
   * Best-effort escrow collection at match START (LOBBY → SHOP): pulls the
   * bet amount from each player's wallet into the house wallet, when we hold
   * a signing keypair for that player. No-op (logged, not thrown) for
   * players we don't hold a keypair for.
   */
  collectEscrow(matchId: string, playerIds: string[]): Promise<void>;
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
  async collectEscrow(matchId: string): Promise<void> {
    console.log(`[ledger:mock] match ${matchId}: escrow collection skipped (mock ledger, no real wallets)`);
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
 * playerId is a logged-in account's stable id (see GameRoom.addPlayer), so we
 * look up that account's saved wallet address. Returns undefined if the
 * account has none on file yet — settleMatch treats that as "skip on-chain,
 * not an error."
 */
async function resolvePlayerWallet(playerId: string): Promise<PublicKey | undefined> {
  const user = await findUserById(playerId);
  if (!user?.walletAddress) return undefined;
  try {
    return new PublicKey(user.walletAddress);
  } catch {
    return undefined;
  }
}

/**
 * DEMO-ONLY: some accounts (see scripts/seedDemoAccounts.ts) have their
 * secret key held server-side in SOLANA_DEMO_KEYPAIRS (playerId -> keypair
 * file path), so at match start we can pull their escrow deposit straight
 * from their own wallet — a genuine signed transfer, no house wallet
 * involved on the way in. This is never how a real user's funds should be
 * handled (the server should never hold a real player's secret key); it's
 * only safe here because these are wallets we created and fund ourselves.
 */
let demoKeypairsCache: Record<string, string> | null = null;
function resolveDemoKeypair(playerId: string): Keypair | undefined {
  if (demoKeypairsCache === null) {
    demoKeypairsCache = {};
    if (env.SOLANA_DEMO_KEYPAIRS) {
      try {
        demoKeypairsCache = JSON.parse(env.SOLANA_DEMO_KEYPAIRS) as Record<string, string>;
      } catch (err) {
        console.error('[ledger:devnet] SOLANA_DEMO_KEYPAIRS is not valid JSON:', err);
      }
    }
  }
  const path = demoKeypairsCache[playerId];
  if (!path) return undefined;
  try {
    return loadKeypairFromFile(path);
  } catch (err) {
    console.error(`[ledger:devnet] failed to load demo keypair for ${playerId}:`, err);
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
      if (env.SOLANA_KEYPAIR_PATH3) {
        this.sender = loadKeypairFromFile(env.SOLANA_KEYPAIR_PATH3);
        console.log(`[ledger:devnet] house/escrow wallet ${this.sender.publicKey.toBase58()}`);
      }
    } catch (err) {
      console.error('[ledger:devnet] failed to load house keypair — on-chain settlement disabled:', err);
    }
  }

  async getBalance(playerId: string): Promise<number> {
    return this.fallback.getBalance(playerId);
  }

  async applyDelta(playerId: string, delta: number, reason: string): Promise<void> {
    return this.fallback.applyDelta(playerId, delta, reason);
  }

  /**
   * Escrow model: collectEscrow (fired at match START) already pulled the
   * bet from each player into the house wallet, so settlement (fired once at
   * MATCH_END, never per round) is just the house paying the winner the full
   * pot — their own bet back plus the loser's. A chain failure is logged and
   * swallowed — the game already knows the winner and must not break
   * because of it.
   */
  async settleMatch(settlement: MatchSettlement): Promise<void> {
    await this.fallback.settleMatch(settlement);

    if (!this.sender) {
      console.warn('[ledger:devnet] no house wallet loaded — skipping on-chain settlement');
      return;
    }

    const winner = settlement.results.find((r) => r.won);
    const recipient = winner ? await resolvePlayerWallet(winner.playerId) : undefined;
    if (!winner || !recipient) {
      console.warn(
        `[ledger:devnet] match ${settlement.matchId}: no devnet wallet on file for the winner — skipping on-chain settlement`,
      );
      return;
    }

    const pot = env.SOLANA_BET_SOL * 2;
    const result = await transferSol(this.connection, this.sender, recipient, pot);
    if (result.ok) {
      console.log(
        `[ledger:devnet] match ${settlement.matchId}: paid out ${pot} SOL pot to ${winner.playerId} (tx ${result.signature})`,
      );
    } else {
      console.error(`[ledger:devnet] match ${settlement.matchId}: payout failed`, result.error);
    }
  }

  /**
   * Escrow model: at match start, pull the bet amount from each player's
   * wallet (when we hold a signing keypair for them — see resolveDemoKeypair)
   * into the house wallet. A player we don't have a keypair for simply
   * contributes nothing to the pot; settleMatch still pays the winner a full
   * 2x bet regardless, so a missing deposit is a demo-data gap, not a game
   * breaker.
   */
  async collectEscrow(matchId: string, playerIds: string[]): Promise<void> {
    if (!this.sender) {
      console.warn('[ledger:devnet] no house wallet loaded — skipping escrow collection');
      return;
    }

    for (const playerId of playerIds) {
      const payerKeypair = resolveDemoKeypair(playerId);
      if (!payerKeypair) {
        console.warn(`[ledger:devnet] match ${matchId}: no demo keypair for ${playerId} — skipping their escrow deposit`);
        continue;
      }
      const result = await transferSol(this.connection, payerKeypair, this.sender.publicKey, env.SOLANA_BET_SOL);
      if (result.ok) {
        console.log(
          `[ledger:devnet] match ${matchId}: collected ${env.SOLANA_BET_SOL} SOL escrow from ${playerId} (tx ${result.signature})`,
        );
      } else {
        console.error(`[ledger:devnet] match ${matchId}: escrow collection from ${playerId} failed`, result.error);
      }
    }
  }
}

export const ledger: CoinLedger = features.solana ? new DevnetLedger() : new MockLedger();

if (features.solana) {
  console.log(`[ledger] using DevnetLedger via ${env.SOLANA_RPC_URL}`);
} else {
  console.log('[ledger] using in-memory MockLedger (USE_REAL_SOLANA=false)');
}
