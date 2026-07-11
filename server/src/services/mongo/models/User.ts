// Persistent player account: login credentials + profile + payout wallet.
// Separate from Player (models/Player.ts), which is the win-triggered
// leaderboard row. A logged-in user's Mongo _id is used as their `playerId`
// for the match they're in, so leaderboard stats and wallet settlement both
// key off the same stable id across matches — see GameRoom.addPlayer and
// services/solana/ledger.ts's wallet lookup.
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true },
    /** Base58 Solana devnet address the user's match winnings are paid out to. */
    walletAddress: { type: String, default: null },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

export const UserModel: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model<UserDoc>('User', userSchema);
