// User accounts. Same transparent Mongo-or-in-memory pattern as
// services/mongo/leaderboard.ts: identical function signatures either way, so
// callers (routes/auth.ts, the Solana wallet lookup) never branch on backend.
// In-memory mode means accounts don't survive a server restart — fine for
// local dev without MONGODB_URI, per the project's "everything runs on mocks"
// convention; set MONGODB_URI for real persistence.
import { nanoid } from 'nanoid';
import { PublicKey } from '@solana/web3.js';
import { isMongoConnected } from '../mongo/connection.js';
import { UserModel } from '../mongo/models/User.js';
import { hashPassword } from './passwords.js';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  walletAddress: string | null;
}

interface InternalUser extends PublicUser {
  passwordHash: string;
}

// ── In-memory fallback store ─────────────────────────────────────────────────
const byId = new Map<string, InternalUser>();
const idByEmail = new Map<string, string>();

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('An account with that email already exists.');
  }
}

export class InvalidWalletAddressError extends Error {
  constructor() {
    super('That does not look like a valid Solana address.');
  }
}

/** Throws InvalidWalletAddressError if non-null and not a well-formed base58 pubkey. */
export function assertValidWalletAddress(address: string | null | undefined): void {
  if (address == null || address === '') return;
  try {
    new PublicKey(address);
  } catch {
    throw new InvalidWalletAddressError();
  }
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  walletAddress?: string | null;
}

export async function registerUser(input: RegisterInput): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  assertValidWalletAddress(input.walletAddress);
  const passwordHash = await hashPassword(input.password);

  if (isMongoConnected()) {
    const existing = await UserModel.findOne({ email }).lean();
    if (existing) throw new EmailAlreadyRegisteredError();
    const doc = await UserModel.create({
      email,
      passwordHash,
      displayName: input.displayName,
      walletAddress: input.walletAddress ?? null,
    });
    return toPublicUser(doc._id.toString(), doc);
  }

  if (idByEmail.has(email)) throw new EmailAlreadyRegisteredError();
  const id = nanoid(16);
  const user: InternalUser = {
    id,
    email,
    passwordHash,
    displayName: input.displayName,
    walletAddress: input.walletAddress ?? null,
  };
  byId.set(id, user);
  idByEmail.set(email, id);
  return stripHash(user);
}

/** Internal lookup (includes passwordHash) for login verification only. */
export async function findUserByEmailInternal(email: string): Promise<InternalUser | null> {
  const normalized = email.trim().toLowerCase();
  if (isMongoConnected()) {
    const doc = await UserModel.findOne({ email: normalized }).lean();
    return doc ? { ...toPublicUser(doc._id.toString(), doc), passwordHash: doc.passwordHash } : null;
  }
  const id = idByEmail.get(normalized);
  return id ? (byId.get(id) ?? null) : null;
}

export async function findUserById(id: string): Promise<PublicUser | null> {
  if (isMongoConnected()) {
    const doc = await UserModel.findById(id).lean().catch(() => null);
    return doc ? toPublicUser(id, doc) : null;
  }
  const user = byId.get(id);
  return user ? stripHash(user) : null;
}

export async function updateWalletAddress(id: string, walletAddress: string | null): Promise<PublicUser | null> {
  assertValidWalletAddress(walletAddress);
  if (isMongoConnected()) {
    const doc = await UserModel.findByIdAndUpdate(id, { $set: { walletAddress } }, { new: true }).lean();
    return doc ? toPublicUser(id, doc) : null;
  }
  const user = byId.get(id);
  if (!user) return null;
  user.walletAddress = walletAddress;
  return stripHash(user);
}

function stripHash(user: InternalUser): PublicUser {
  const { passwordHash: _passwordHash, ...pub } = user;
  return pub;
}

function toPublicUser(
  id: string,
  doc: { email: string; displayName: string; walletAddress?: string | null },
): PublicUser {
  return { id, email: doc.email, displayName: doc.displayName, walletAddress: doc.walletAddress ?? null };
}
