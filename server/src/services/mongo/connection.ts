// Mongo connection bootstrap. If MONGODB_URI is unset the app runs with an
// in-memory leaderboard fallback (see leaderboard.ts), so local dev needs no DB.
import mongoose from 'mongoose';
import { env, features } from '../../config/env.js';

let connected = false;

export async function connectMongo(): Promise<boolean> {
  if (!features.mongo) {
    console.log('[mongo] MONGODB_URI not set — using in-memory leaderboard fallback');
    return false;
  }
  try {
    await mongoose.connect(env.MONGODB_URI!);
    connected = true;
    console.log('[mongo] connected');
    return true;
  } catch (err) {
    console.error('[mongo] connection failed, falling back to in-memory:', err);
    return false;
  }
}

export function isMongoConnected(): boolean {
  return connected;
}
