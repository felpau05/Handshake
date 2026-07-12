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
  /** Route Gemini calls through Vertex AI (rebranded "Gemini Enterprise Agent
   *  Platform") instead of the plain Developer API. This bills through normal
   *  Cloud billing/credits, not the Developer API's separate prepay wallet.
   *  Needs Application Default Credentials — `gcloud auth application-default
   *  login`, or GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
   *  key file — NOT a GEMINI_API_KEY. */
  GEMINI_USE_VERTEX: boolish,
  GEMINI_VERTEX_PROJECT: z.string().optional(),
  GEMINI_VERTEX_LOCATION: z.string().default('us-central1'),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),

  MONGODB_URI: z.string().optional(),

  /** Signs session JWTs. Falls back to an insecure dev default — set a real one before any real deploy. */
  AUTH_JWT_SECRET: z.string().default('dev-insecure-secret-change-me'),

  USE_REAL_SOLANA: boolish,
  SOLANA_RPC_URL: z.string().default('https://api.devnet.solana.com'),
  /** Player 1 demo wallet keypair file (array of 64 secret key bytes). Never commit these files. */
  SOLANA_KEYPAIR_PATH: z.string().optional(),
  /** Player 2 demo wallet keypair file. */
  SOLANA_KEYPAIR_PATH2: z.string().optional(),
  /** House/escrow wallet keypair file — holds the pot between match start and match end. */
  SOLANA_KEYPAIR_PATH3: z.string().optional(),
  /** SOL amount settled per match at MATCH_END. */
  SOLANA_BET_SOL: z.coerce.number().default(0.1),
  /** DEMO ONLY: JSON map of accountId -> keypair file path, for accounts whose
   *  secret key we hold server-side so a match between two of them settles as
   *  a real peer-to-peer transfer. Never do this for a real user's wallet. */
  SOLANA_DEMO_KEYPAIRS: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

if (env.AUTH_JWT_SECRET === 'dev-insecure-secret-change-me') {
  console.warn('[env] AUTH_JWT_SECRET is unset — using an insecure dev default. Set it in server/.env before any real deploy.');
}

/** True once Gemini has SOME usable credential, whichever backend it's for. */
const geminiConfigured = env.GEMINI_USE_VERTEX
  ? Boolean(env.GEMINI_VERTEX_PROJECT)
  : Boolean(env.GEMINI_API_KEY);

/** Handy booleans for "is this service wired for real?" */
export const features = {
  gemini: geminiConfigured,
  elevenlabs: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID),
  imageGen: !env.STUB_IMAGE_GEN && geminiConfigured,
  mongo: Boolean(env.MONGODB_URI),
  solana: env.USE_REAL_SOLANA && Boolean(env.SOLANA_RPC_URL) && Boolean(env.SOLANA_KEYPAIR_PATH3),
};
