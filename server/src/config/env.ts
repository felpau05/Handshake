// Typed environment loader. Everything is optional — the app runs entirely on
// mocks when nothing is set. Booleans/numbers are coerced; missing service keys
// simply keep that service in stub mode.
import 'dotenv/config';
import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-2.5-flash-image'),
  STUB_IMAGE_GEN: boolish,

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),

  MONGODB_URI: z.string().optional(),

  USE_REAL_SOLANA: boolish,
  SOLANA_RPC_URL: z.string().default('https://api.devnet.solana.com'),
  SOLANA_SERVER_SECRET_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Handy booleans for "is this service wired for real?" */
export const features = {
  gemini: Boolean(env.GEMINI_API_KEY),
  elevenlabs: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID),
  imageGen: !env.STUB_IMAGE_GEN && Boolean(env.GEMINI_API_KEY),
  mongo: Boolean(env.MONGODB_URI),
  solana: env.USE_REAL_SOLANA && Boolean(env.SOLANA_SERVER_SECRET_KEY),
};
