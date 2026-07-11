# Gamemaster RPS — Dev Handoff

A two-laptop, camera-driven Rock-Paper-Scissors game with an AI gamemaster. This
doc gets a new dev productive fast: how to run it, how it's wired, and exactly
where to plug in each feature.

> **Status:** full skeleton is built, typechecks, tests pass (11/11), and a full
> best-of-5 match runs end-to-end on mocks with **zero API keys**. Everything
> below is either done ✅ or a clearly-scoped TODO with a file to open.

---

## 1. Get it running (2 minutes)

```bash
npm install                     # installs all 3 workspaces
npm run dev                     # server :3001 + client :5173
```

Open **http://localhost:5173 in two browser tabs**. In tab 1: enter a name →
*Create match* → you get a 4-letter room code. In tab 2: enter a name + the code
→ *Join*. Both *ready up* → shop → play. No keys needed — narration is canned,
voice is silent, images pass through, coins/leaderboard are in-memory.

Useful scripts (run from repo root):

| Command | What it does |
|---|---|
| `npm run dev` | Server + client with hot reload |
| `npm run build` | Typecheck server/shared + build the client bundle |
| `npm run typecheck` | Typecheck all workspaces |
| `npm test` | Server unit tests (rules + resolver) |

---

## 2. How it fits together

```
Laptop A (browser)                         Laptop B (browser)
 getUserMedia → MediaPipe Hand Landmarker   getUserMedia → MediaPipe Hand Landmarker
 local gesture classify (→ Move string)     local gesture classify (→ Move string)
        \                                          /
         \---------------- Socket.IO --------------/
                             |
                     Node Game Server (Express + Socket.IO)
                     in-memory GameRoom state machine (AUTHORITATIVE)
                      /        |          |          \
                 Gemini    ElevenLabs   MongoDB     Solana
              (narrate +     (TTS)    (leaderboard) (coin ledger)
               balance)
```

**The one rule that matters:** the **server owns all game state**. Clients only
send *intents* — "I'm ready", "I bought these powerups", "my move is rock". The
server validates everything and pushes the full `MatchState` back. Never add
game logic (scoring, win detection, coin math) to the client — both laptops must
render from the same server truth.

### Monorepo layout (npm workspaces)

```
shared/   TypeScript types + RPS rules — the client/server contract. No build step.
server/   Express + Socket.IO + the GameRoom state machine + service wrappers.
client/   React + Vite + zustand — camera, hand-tracking, and all UI.
```

`shared/` is imported as `@app/shared` from both sides, so a change to the socket
protocol or a type is enforced across the whole app by the compiler.

---

## 3. The game loop (server-driven state machine)

One `GameRoom` instance per match cycles through these phases. The client renders
a different view per phase (see `client/src/App.tsx`).

1. **LOBBY** — create/join by room code, both players ready up.
2. **SHOP** — each player gets **10 tokens** to buy powerups. Server validates
   the purchase (cost, budget). 20s timer, or skips when both lock in early.
3. **ROUND_INTRO** — server may ask Gemini for a whitelisted *balance twist*;
   narrates the round intro.
4. **CAPTURE** — 3-2-1-Go countdown; each client commits **one move** (camera or
   keyboard). Resolves early if both commit; missed deadline → auto-forfeit.
5. **RESOLVE** — deterministic winner via `RoundResolver`. Coins: **winner +20,
   loser −20**. Gemini narrates the result, ElevenLabs voices it.
6. **Repeat** — **best of 5** (first to 3 round wins). Tunable: `BEST_OF` in
   `server/src/game/GameRoom.ts`.
7. **MATCH_END** — winner captures a photo → AI turns it into a themed portrait →
   becomes their leaderboard avatar; coins settle on the ledger.

Key files:
- `server/src/game/GameRoom.ts` — the state machine (start here to understand flow)
- `server/src/game/RoundResolver.ts` — pure win/coin logic (fully unit-tested)
- `server/src/sockets/handlers.ts` — maps socket events ↔ GameRoom methods
- `client/src/App.tsx` — phase → view routing
- `client/src/hooks/useSocket.ts` — all client↔server events in one place

---

## 4. What's real vs. stubbed

**Everything runs on mocks by default.** Turn a service "real" by setting its env
vars in `server/.env` (copy from `server/.env.example`). No code change needed to
flip a service on — the wrapper detects the key and switches.

| Service | Default (no key) | Make it real | Wrapper to edit |
|---|---|---|---|
| **Gemini** narration | canned lines | set `GEMINI_API_KEY` | `server/src/services/gemini/geminiClient.ts` |
| **Gemini** twists | disabled (no twists) | set `GEMINI_API_KEY` | same file, `proposeBalanceTwist()` |
| **ElevenLabs** voice | text only, silent | `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | `server/src/services/elevenlabs/ttsClient.ts` |
| **Image-gen** portraits | photo passthrough | `STUB_IMAGE_GEN=false` (+ Gemini key) | `server/src/services/imagegen/imageGenClient.ts` |
| **MongoDB** leaderboard | in-memory Map | `MONGODB_URI` | `server/src/services/mongo/*` |
| **Solana** ledger | in-memory MockLedger | `USE_REAL_SOLANA=true` (+ RPC + secret key) | `server/src/services/solana/ledger.ts` |

The env schema/loader is `server/src/config/env.ts` — it also exposes a `features`
object (`features.gemini`, `features.solana`, …) so wrappers know which mode
they're in.

---

## 5. Suggested task split (parallelizable)

Each area is isolated behind an interface, so devs can work in parallel without
stepping on each other. Recommended priority order (highest demo impact first):

**① Hand tracking (riskiest — own it early)** — `client/src/hooks/useHandTracking.ts`
+ `client/src/lib/gestureClassifier.ts`. MediaPipe is wired and classifies
rock/paper/scissors by finger geometry. Tune thresholds against real cameras.
⚠️ The model loads from a CDN — vendor it into `client/public` for offline demo
reliability (TODO marked in the file). The keyboard `1/2/3` fallback already
works and emits the same event, so play never blocks on tracking.

**② Gemini gamemaster** — `server/src/services/gemini/geminiClient.ts`. Tune the
narration prompt (keep it to one hype sentence) and the twist-selection prompt.
Twists **must** return a value from the `TwistId` enum — never free-form rules.

**③ ElevenLabs voice** — `server/src/services/elevenlabs/ttsClient.ts`. TTS via
REST is wired; just add the key + voice id. Conversational banter ("understands
players") is a stubbed stretch goal (`understandAndReply()`).

**④ Leaderboard / MongoDB** — `server/src/services/mongo/leaderboard.ts`. Works
in-memory now; point `MONGODB_URI` at Atlas and it persists. Schema is
`models/Player.ts`.

**⑤ Winner portrait** — `server/src/services/imagegen/imageGenClient.ts`. Flip
`STUB_IMAGE_GEN=false` to call the Gemini image model. Tune `DEFAULT_STYLE_PROMPT`
to match the game's visual theme.

**⑥ Solana ledger (do last / final hours)** — `server/src/services/solana/ledger.ts`.
Implement `DevnetLedger` against the existing `CoinLedger` interface (Mock already
satisfies it). Devnet airdrop/wallet setup is a classic time sink — the mock
already gives the "coins go up" demo, so gate this behind spare time.

**UI polish** — `client/src/components/*` + `client/src/styles.css`. All phase
views exist and are functional but plain; restyle freely.

---

## 6. Two-laptop / camera gotcha (READ THIS before the live demo)

`getUserMedia` (webcam) only works on **`localhost` or HTTPS**. Two laptops
hitting `http://<lan-ip>:3001` will have the camera **silently blocked** in
Chrome — no error, just no video.

**Fix (single origin for both laptops):**
```bash
npm run build                 # builds the client into client/dist
npm run start                 # server serves the client AND the API on :3001
npx ngrok http 3001           # → one https URL
```
Both laptops open that **one HTTPS URL**. This solves camera permissions and
cross-machine discovery in one step. (Or deploy the server to Render/Fly.io.)

If the camera still won't cooperate on stage, the **keyboard `1/2/3`** and the
on-screen Rock/Paper/Scissors buttons work identically — the game is fully
playable without a camera.

---

## 7. Conventions & gotchas

- **Server is authoritative** — see §2. No game logic in the client.
- **Add a socket event?** Define its name in `SocketEvents` and its payload type
  in `shared/src/types.ts` *first*, then wire server (`sockets/handlers.ts`) and
  client (`hooks/useSocket.ts`). The compiler keeps both ends honest.
- **Powerups** are defined twice on purpose: authoritative catalog in
  `server/src/game/powerupCatalog.ts` (drives validation + effects), mirrored for
  display in `client/src/components/PowerupShop.tsx`. Keep them in sync; the
  server rejects anything invalid regardless.
- **Powerup effects** live only in `RoundResolver.ts`. Adding a powerup =
  add to the catalog + add its effect branch in the resolver + a unit test.
- **Server runs via `tsx`** (TypeScript directly) in both dev and prod, so
  `shared/` needs no build step. Don't `node dist/index.js` — use `npm run start`.
- **Match length / timers** are constants at the top of `GameRoom.ts`
  (`BEST_OF`, `SHOP_DURATION_MS`, `CAPTURE_DURATION_MS`, `STARTING_COINS`).
- **Secrets:** never commit `server/.env`. It's gitignored; share keys out of band.

---

## 8. Verify your changes

- `npm test` — resolver + rules stay green (add a test when you add a rule).
- `npm run typecheck` — must pass across all workspaces before pushing.
- Manual smoke: `npm run dev`, open two tabs, play a full match. Shop should
  reject over-budget buys; each round should apply ±20 (or ±40 on `DOUBLE_STAKES`);
  match should end at 3 round wins; winner flow should produce a leaderboard entry.

Questions on the architecture? Start with `GameRoom.ts` and `shared/src/types.ts` —
between them they describe the entire game.
