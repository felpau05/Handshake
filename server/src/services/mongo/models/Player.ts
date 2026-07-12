// Leaderboard player document. `playerId` is the stable per-match id issued on join.
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const playerSchema = new Schema(
  {
    playerId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true },
    walletAddress: { type: String, default: null },
    totalCoins: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type PlayerDoc = InferSchemaType<typeof playerSchema>;

export const PlayerModel: Model<PlayerDoc> =
  (mongoose.models.Player as Model<PlayerDoc>) ??
  mongoose.model<PlayerDoc>('Player', playerSchema);
