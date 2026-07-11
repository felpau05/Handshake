// Standalone proof that the devnet connect→sign→transfer→confirm path works,
// without needing a second real player wallet: loads the wallet at
// SOLANA_KEYPAIR_PATH (player 1's demo wallet — any funded keypair works for
// this basic plumbing check), generates a throwaway recipient keypair, and
// sends it 0.1 SOL.
//
// Run: npx tsx server/scripts/testSolanaTransfer.ts
// Requires SOLANA_KEYPAIR_PATH (+ optionally SOLANA_RPC_URL, SOLANA_BET_SOL)
// in server/.env. Does not touch the live game loop.
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { env } from '../src/config/env.js';
import { getConnection, loadKeypairFromFile, transferSol } from '../src/services/solana/ledger.js';

async function main() {
  if (!env.SOLANA_KEYPAIR_PATH) {
    throw new Error('SOLANA_KEYPAIR_PATH is not set — copy server/.env.example to server/.env and fill it in.');
  }

  const connection = getConnection();
  const sender = loadKeypairFromFile(env.SOLANA_KEYPAIR_PATH);
  const recipient = Keypair.generate();

  console.log(`RPC:            ${env.SOLANA_RPC_URL}`);
  console.log(`Sender wallet:  ${sender.publicKey.toBase58()}`);
  console.log(`Recipient:      ${recipient.publicKey.toBase58()} (throwaway, generated for this test)`);

  const senderBefore = await connection.getBalance(sender.publicKey);
  const recipientBefore = await connection.getBalance(recipient.publicKey);
  console.log(`\nBefore — sender: ${senderBefore / LAMPORTS_PER_SOL} SOL, recipient: ${recipientBefore / LAMPORTS_PER_SOL} SOL`);

  console.log(`\nTransferring ${env.SOLANA_BET_SOL} SOL...`);
  const result = await transferSol(connection, sender, recipient.publicKey, env.SOLANA_BET_SOL);

  if (!result.ok) {
    console.error('Transfer failed:', result.error);
    process.exitCode = 1;
    return;
  }

  const senderAfter = await connection.getBalance(sender.publicKey);
  const recipientAfter = await connection.getBalance(recipient.publicKey);

  console.log(`\nSignature:      ${result.signature}`);
  console.log(`Explorer:       https://explorer.solana.com/tx/${result.signature}?cluster=devnet`);
  console.log(`\nAfter  — sender: ${senderAfter / LAMPORTS_PER_SOL} SOL, recipient: ${recipientAfter / LAMPORTS_PER_SOL} SOL`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
