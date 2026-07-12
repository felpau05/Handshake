# Gamemaster RPS — CUHack2026

A two-laptop, camera-driven **Rock-Paper-Scissors–esque** game with an AI gamemaster.

- Each player sits at their own laptop; the **webcam tracks their hand sign** (rock / paper /
  scissors) locally in the browser via MediaPipe.
- **Gemini** is the gamemaster brain — it narrates the match live, calls out moves, and applies
  dynamic balance "twists".
- **ElevenLabs** gives the gamemaster a voice (TTS).
- Before each match, players spend **10 tokens** on powerups. Each round the winner **+20 coins**,
  the loser **−20 coins**. Matches are **best of 5**.
- On match win, the winner's photo is captured and turned into a themed AI **drawing**, used as
  their leaderboard avatar.
- **Solana** is the coin/trophy ledger; **MongoDB** stores the leaderboard.

## Architecture

Two browser clients ↔ one **server-authoritative** Node game server (Express + Socket.IO). Clients
only ever send their *detected move* (and later, a winner photo); the server owns all game state, so
both screens stay in sync and neither laptop can cheat. See
[the plan](../.claude/plans/structure-use-2-nested-sutherland.md) for the full design.

```
client/   React + Vite + zustand    — camera, hand-tracking, powerup shop, leaderboard UI
server/   Express + Socket.IO       — authoritative GameRoom state machine + service wrappers
shared/   TypeScript types + rules  — the client/server contract (win-matrix, event names)
```

## Quick start

```bash
npm install            # installs all three workspaces
cp .env.example server/.env   # optional — game runs on mocks with no keys
npm run dev            # starts server (:3001) + client (:5173)
```

Open http://localhost:5173 in **two** browser tabs (or two laptops). Create a room on one, join with
the code on the other, and play.

> **Two-laptop / camera note:** `getUserMedia` only works on `localhost` or **HTTPS**. To play across
> two physical laptops, build the client (`npm run build`), let the server serve it, and expose one
> HTTPS URL with `ngrok http 3001` (or deploy to Render/Fly.io). Both laptops open that one URL.
> Over plain `http://<lan-ip>` Chrome silently blocks the camera — use the keyboard `1/2/3` fallback.

## What's real vs. stubbed

Everything runs end-to-end on **mocks** out of the box. Turn services "real" one at a time via env
vars (`server/.env`):

| Service     | Default            | Make it real                                  |
|-------------|--------------------|-----------------------------------------------|
| Gemini      | canned narration   | set `GEMINI_API_KEY`                           |
| ElevenLabs  | text only, no audio | set `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` |
| Image-gen   | photo passthrough  | set `STUB_IMAGE_GEN=false` (+ Gemini key)      |
| MongoDB     | in-memory          | set `MONGODB_URI`                              |
| Solana      | in-memory ledger   | set `USE_REAL_SOLANA=true` (+ RPC + secret key) |

## Scripts

- `npm run dev` — server + client with hot reload
- `npm run build` — build shared → client → server for production
- `npm run typecheck` — typecheck every workspace
- `npm test` — run server unit tests (rules + resolver)

## Docker

The whole stack runs containerized — nginx (reverse proxy) → app → redis —
with zero changes to the native workflow above:

```bash
docker compose up --build   # play at http://localhost:8080
npx ngrok http 8080         # share it, same as before
```

Secrets (`secrets/`, `.env`) are never baked into the image — the compose
file mounts them read-only at runtime and overrides the file-path env vars
with in-container paths. Game rooms are deliberately pinned to ONE app
instance (authoritative in-process state machine with live timers); the
scale path is the Socket.IO Redis adapter + sticky sessions, for which the
redis service and `REDIS_URL` are already provisioned.
