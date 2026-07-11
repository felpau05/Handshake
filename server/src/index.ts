// Server entrypoint: Express (REST) + Socket.IO (realtime) on one HTTP server.
// In production it also serves the built client from server/public so a single
// origin/URL (e.g. one ngrok tunnel) covers both laptops and keeps getUserMedia
// on a secure context. See README for the two-laptop setup.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { registerSocketHandlers } from './sockets/handlers.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { photoRouter } from './routes/photo.js';
import { elevenlabsTestRouter } from './routes/elevenlabsTest.js';
import { connectMongo } from './services/mongo/connection.js';

const app = express();
app.use(cors({ origin: env.CLIENT_ORIGIN }));
// Winner photos are base64 data URLs — allow a generous JSON body.
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/photo', photoRouter);
app.use('/api/test', elevenlabsTestRouter);

// Serve the built client in production (single-origin deploy for two laptops).
// Points at the client workspace's Vite build output (client/dist).
const clientDist = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../client/dist',
);
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next(); // client not built yet — fine in dev
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: env.CLIENT_ORIGIN, methods: ['GET', 'POST'] },
});
registerSocketHandlers(io);

async function start(): Promise<void> {
  await connectMongo(); // falls back to in-memory leaderboard if unset/unreachable
  httpServer.listen(env.PORT, () => {
    console.log(`\n🎮  Gamemaster RPS server on http://localhost:${env.PORT}`);
    console.log(`    Socket.IO + REST ready. Client origin: ${env.CLIENT_ORIGIN}\n`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
