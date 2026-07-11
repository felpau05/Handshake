// Seeds two demo player accounts for the peer-to-peer escrow demo — each tied
// to a devnet wallet whose secret key the server holds (secrets/wallet-1 and
// wallet-2; wallet-3 is the house/escrow wallet, see SOLANA_KEYPAIR_PATH3), so
// a match between them can move real SOL both ways (escrow in at match
// start, payout at match end) without any login/wallet-connect UI during the
// live demo. Idempotent: re-running syncs the wallet address on file in case
// the underlying keypair file changed. Never do this pattern for a real
// user's account.
//
// Run: npm -w server run seed:demo
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import { connectMongo } from '../src/services/mongo/connection.js';
import { findUserByEmailInternal, registerUser, updateWalletAddress } from '../src/services/auth/userStore.js';
import { loadKeypairFromFile } from '../src/services/solana/ledger.js';

const secretsDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../secrets');

const DEMO_PLAYERS = [
  { email: 'demo-player-1@rps.local', password: 'demo-password-1', displayName: 'Demo Player One', keypairFile: 'wallet-1-keypair.json' },
  { email: 'demo-player-2@rps.local', password: 'demo-password-2', displayName: 'Demo Player Two', keypairFile: 'wallet-2-keypair.json' },
];

async function main() {
  await connectMongo();

  const demoKeypairMap: Record<string, string> = {};

  for (const demo of DEMO_PLAYERS) {
    const keypairPath = path.join(secretsDir, demo.keypairFile);
    const keypair: Keypair = loadKeypairFromFile(keypairPath);
    const walletAddress = keypair.publicKey.toBase58();

    const existing = await findUserByEmailInternal(demo.email);
    let id: string;
    if (!existing) {
      const created = await registerUser({ ...demo, walletAddress });
      id = created.id;
      console.log(`Created ${demo.email} → id ${id}, wallet ${walletAddress}`);
    } else {
      id = existing.id;
      if (existing.walletAddress !== walletAddress) {
        await updateWalletAddress(id, walletAddress);
        console.log(`Updated ${demo.email} → id ${id}, wallet ${existing.walletAddress} → ${walletAddress}`);
      } else {
        console.log(`Already up to date ${demo.email} → id ${id}, wallet ${walletAddress}`);
      }
    }

    demoKeypairMap[id] = keypairPath;
  }

  console.log('\nSet this in server/.env (replacing any existing value):\n');
  console.log(`SOLANA_DEMO_KEYPAIRS=${JSON.stringify(demoKeypairMap)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
