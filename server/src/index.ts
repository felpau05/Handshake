// Server entrypoint: Express (REST) + Socket.IO (realtime) on one HTTP server.
// In production it also serves the built client from server/public so a single
// origin/URL (e.g. one ngrok tunnel) covers both laptops and keeps getUserMedia
// on a secure context. See README for the two-laptop setup.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { registerSocketHandlers } from './sockets/handlers.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { elevenlabsTestRouter } from './routes/elevenlabsTest.js';
import { authRouter } from './routes/auth.js';
import { connectMongo } from './services/mongo/connection.js';
import { prewarmFillerNarration } from './game/fillerNarration.js';

const app = express();
// credentials: true + a matched Origin (not '*') is required for the browser
// to send/receive the httpOnly auth cookie across the client's dev port.
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/test', elevenlabsTestRouter);

// Serve the built client in production (single-origin deploy for two laptops).
// Points at the client workspace's Vite build output (client/dist).
const clientDist = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../client/dist',
);
app.use(
  express.static(clientDist, {
    setHeaders: (res, filePath) => {
      // index.html must NEVER be cached: a cached copy keeps referencing an
      // old hashed bundle after a rebuild, so players silently run stale
      // code until they think to hard-refresh. Hashed assets stay cacheable.
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  }),
);
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), { headers: { 'Cache-Control': 'no-store' } }, (err) => {
    if (err) next(); // client not built yet — fine in dev
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: env.CLIENT_ORIGIN, methods: ['GET', 'POST'], credentials: true },
});
registerSocketHandlers(io);

async function start(): Promise<void> {
  await connectMongo(); // falls back to in-memory leaderboard if unset/unreachable
  prewarmFillerNarration(); // synthesize "thinking" filler lines in the background now, not on first use
  httpServer.listen(env.PORT, () => {
    console.log(`\n🎮  Gamemaster RPS server on http://localhost:${env.PORT}`);
    console.log(`    Socket.IO + REST ready. Client origin: ${env.CLIENT_ORIGIN}\n`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
