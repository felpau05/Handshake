# HANDOFF — ASL Word Battle (CU Hackathon 2026)

Context doc so a new agent/dev can take over fast. Rewritten 2026-07-12 after a
long debugging session (the previous version of this file described the old
Rock-Paper-Scissors game — the project has since pivoted).

## 1. What this is

A 2-player, camera-driven **ASL fingerspelling word battle**. Players get a
theme (e.g. "music"), fingerspell the best related word they can in 25s using
ASL letters at their webcam, and a Gemini gamemaster judges + narrates
(ElevenLabs voice). Wagers settle in SOL on Solana devnet. MongoDB leaderboard.

**Demo topology:** ONE laptop runs the server (felpau's, WSL2), TWO other
laptops are players, all through a single **ngrok HTTPS tunnel** to port 3001.
The server serves the built client (`client/dist`), so one URL covers
everything. HTTPS is load-bearing: `getUserMedia` requires a secure context —
plain LAN `http://` silently blocks the camera.

## 2. Repo layout (npm workspaces)

```
shared/   Types + SocketEvents protocol — the client/server contract.
asl/      @app/asl — drop-in browser ASL detector module + data tools:
          MediaPipe HandLandmarker → normalize.ts (wrist-origin/scale/mirror)
          → tfjs MLP classifier → StabilityFilter → deduped 'letter' events.
          Also: collect tool, trainers, datasets, standalone demo.
server/   Express + Socket.IO. game/GameRoom.ts is the AUTHORITATIVE match
          state machine. Runs via tsx directly from src — no compile step.
client/   React + Vite + zustand game UI. Served as static build in prod.
```

**The one rule that matters:** the server owns all game state. Clients only
send intents (ready, stake, submit word, spell-ready); the server validates
and broadcasts `MatchState`. Never put game logic in the client.

**Add a socket event?** Name in `SocketEvents` + payload type in
`shared/src/types.ts` first, then `server/src/sockets/handlers.ts`, then
`client/src/hooks/useSocket.ts`.

## 3. Commands

```bash
npm run dev              # dev mode: server + vite client, hot reload
npm run build            # builds client/dist — THE step that updates what players see
npm start                # server :3001 (serves client/dist + API + sockets, via tsx)
npx ngrok http 3001      # share the https URL with players
npm run typecheck        # all 4 workspaces
npm -w server run test   # server tests (incl. regression tests, see §6)

# ASL model pipeline (from asl/):
npm -w asl run collect                                # /tools/collect.html — record samples
node tools/train_node.mjs data/dataset_merged.json    # retrain (~4 min with tfjs-node)
npm -w asl run demo                                   # standalone detector demo + HUD
```

## 4. Match flow + the readiness gate

Phases: `LOBBY → STAKE → PROMPT → SPELL → RESOLVE → (sudden death | MATCH_END)`.
Key server tunables at the top of `GameRoom.ts` (`SPELL_DURATION_MS` 25s,
`SPELL_READY_MAX_WAIT_MS` 8s, `MAX_SUDDEN_DEATH` 3).

**Readiness gate (hard-won):** after the PROMPT narration, the server holds
the round until BOTH clients emit `SPELL_READY` (8s cap so nobody stalls the
match), only then opens SPELL and starts the timer. Clients emit it (effect in
`App.tsx`) when `detectorReady && cameraStatus === 'ready'`. `detectorReady`
(`client/src/state/mediaStore.ts`) is only set after full GPU warmup — see §5.

Camera + detector are warmed ONCE at app load (`mediaStore.warm()` via
`useMediaWarmup` in Root.tsx); `SpellArena` only attaches to them.

## 5. The 10-second-freeze saga (READ before touching perf)

Symptom: on slower machines, SPELL started with ~10s of frozen timer
(25s → jump to 15s), black video, no detection. Fast laptops unaffected.
Three stacked root causes, all fixed:

1. **GPU shader compilation is lazy** — MediaPipe's GPU delegate and tfjs
   compile on FIRST INFERENCE, not at model load. → `AslDetector.warmup()`
   runs at page load.
2. **MediaPipe's landmark stage compiles only when a hand is FOUND.** Warming
   on an empty camera frame only compiled the palm detector; the stall hit
   when the player first raised a hand in-round. → warmup runs against a
   bundled hand photo (`client/public/asl-model/warmup-hand.jpg`) drawn to a
   canvas (verified it triggers detection).
3. **`useWaveDelete` created a SECOND HandLandmarker at SPELL mount** — WASM
   + model download + shader compile at round start every round, plus a
   duplicate per-frame detection pass. → rewritten to consume the shared
   detector's `frame` events (landmarks are exposed on `FrameDebug`).

**If a stall reappears:** DevTools → Network at round start (any `.task` /
`.wasm` download when SPELL begins = something re-initializing), plus the
in-game badge diagnostics (§7).

## 6. Bugs fixed this session (regression map)

- **Server crash (critical):** submit after opponent left → `undefined !==
  null` counted a vacated slot as "submitted" → resolve() on null player →
  unhandled rejection → process death. Guards in `GameRoom.submitWord` /
  `resolve`. Tests: `server/src/game/midMatchSafety.test.ts`.
- **Mid-match leave now forfeits** to the remaining player (was: stranding
  them in a dead phase, since removePlayer cancels all timers).
- **Empty-word submissions:** countdown-expiry + Enter handlers captured a
  stale `doSubmit` (word=""). All submit paths go through `wordRef` /
  `doSubmitRef` (SpellArena.tsx). Auto-submit fires at 1s remaining (not 0)
  to beat the server deadline over a real network.
- **SUBMIT/BACKSPACE gestures** (model labels from 👍/👎) were appended as
  literal text; now they trigger submit/delete (SUBMIT ignored on empty
  word); multi-char labels can never enter the word.
- **Login required refresh:** server reads the auth cookie from the socket
  HANDSHAKE; authStore now reconnects the socket after login/register/logout.
- **Stale browser bundle (cost ~a day of ghost-debugging):** HTML now served
  with `Cache-Control: no-store` (server/src/index.ts). After `npm run
  build`, a plain refresh always gets the new bundle.
- **StabilityFilter fragility:** one low-confidence frame wiped the hold and
  restarted holdMs → letters never committed on low-FPS machines. Dips <
  `graceMs` (250ms) now keep the hold alive (asl/src/stability.ts).
- **Overlay canvas race:** was sized once from `video.videoWidth` (0 until
  metadata → 0×0 forever on slow machines); now synced per-frame.
- **Lobby ← Leave button** added (no way to back out of a room before).

## 7. Detector tuning + diagnostics

- Commit threshold **0.75 confidence / 500ms hold** (was 0.85/600) — in
  `client/src/state/mediaStore.ts`; mirrored in `asl/demo/demo.ts`. The
  overlay's green/amber cutoff in SpellArena.tsx must match.
- In-game badge shows live `prediction confidence%` per frame (imperative DOM
  via `liveRef`, deliberately not React state). "no hand" = detection issue;
  letter stuck under 75% = model doesn't know this hand (→ collect + retrain).
- Skeleton overlay: green ≥ commit bar, amber below.

## 8. ASL model

- 28 classes: A–Z + SUBMIT (👍) + BACKSPACE (👎). J/Z are static
  approximations. 63-dim input (21 landmarks × xyz, normalized). MLP 64→32→28.
- Data: `asl/data/dataset_merged.json` (~57.5k samples; Kaggle import +
  webcam collect sessions). Current val acc 99.7% — **inflated**: random
  split, does NOT measure cross-person generalization (the real weakness).
- Artifacts in `asl/model/` AND copied to `client/public/asl-model/` (what
  the game loads). **Keep both in sync after retraining, then rebuild.**
- `train_node.mjs` uses `@tensorflow/tfjs-node` if present (installed
  --no-save; reinstall after a node_modules wipe) — ~20× faster. Batch 256.
- Merge workflow: collect tool downloads `landmarks.json` → concat onto
  dataset_merged.json (replace a label only when intended — O was fully
  replaced once) → retrain → copy artifacts → `npm run build`.
- `asl/data/*.bak*` = session merge backups, untracked, deletable.

## 9. Solana (devnet) — ON

- `server/.env`: `USE_REAL_SOLANA=true` + `SOLANA_KEYPAIR_PATH{,2,3}`.
  **The feature flag requires PATH3 (house/escrow wallet)** — without it the
  server silently uses MockLedger (this bit us; startup log tells the truth:
  look for `[ledger:devnet] house/escrow wallet …`).
- Wallets (`server/wallet-*-keypair.json`, gitignored):
  - w1 `7xd7JHgyHzZh7GbbcjFm256TYXG85C2VQx9w46TewhMy` (~1.7 SOL)
  - w2 `BMXu7hJYVMaPu7BLgMda3q5U32UfFAbnNqY79Ctwdk2P` (~1.0 SOL)
  - w3 house `62g9gF5fAV6AheDWrjbz5TW4BLpsAdZeVcbyL5z9Kppe` (~1.5 SOL)
- **Payouts go to the winner's ACCOUNT walletAddress** (set in the in-game
  account bar). Demo plan: felpau's account → w1 address, marc's → w2.
- Devnet faucet is rate-limited; fund by transferring between our own wallets
  (@solana/web3.js from the server workspace) instead of airdrops.
- Escrow: bets pulled into house at match start only for accounts listed in
  `SOLANA_DEMO_KEYPAIRS` (else skipped); house pays winner 2× bet at match
  end. Chain failures log and never break the match.

## 10. Known issues / next work (unfixed)

1. **Gemini credits DEPLETED** (429). Judging falls back to a stub that only
   checks length ≥ 2 — it declared "LVEEL" a winner. Top up at ai.studio
   before the demo or word validity is fake. (Test-suite 429 noise = this.)
2. **Cross-person model accuracy:** felpau gets far fewer commits than marc.
   Real fix: ~100–150 samples/letter from EACH player → merge → retrain.
3. **No mid-match socket reconnect:** a dropped socket (ngrok hiccup) orphans
   the player permanently (new socket has no meta, not in the room, no
   broadcasts). Needs rejoin-by-accountId. Biggest remaining tunnel risk.
4. **Room leak:** both tabs closed without LEAVE_MATCH → room lives forever
   (disconnect only sets connected=false).
5. **Same account can occupy both slots** of one room (no dup check).
6. **AUTH_JWT_SECRET unset** — insecure dev default (boot warning).
7. Client bundle 1.9MB (Vite chunk warning) — ignorable for the demo.

## 11. Gotchas that will waste your time

- **`npm run build` is what players see.** The server serves `client/dist`;
  client edits do nothing for players until rebuilt. Server code = restart
  only (tsx runs src directly; `npm -w server run build` is just a typecheck,
  there is no dist).
- The outer dir `~/projects/CU Hackathon 2026/` is NOT the git repo — the
  repo is the `CU-Hackathon-2026/` subdirectory
  (github.com/felpau05/CU-Hackathon-2026, branch main; commit+push directly
  to main is the approved workflow here).
- Paths contain spaces — quote everything. tsx/esbuild choked on scripts
  outside the workspace; run scratch scripts from inside `server/`.
- `asl/venv/`, `__pycache__`, `*Zone.Identifier`, big datasets, wallet
  keypairs, `archive/` are gitignored ON PURPOSE. Don't force-add.
- MediaPipe WASM + hand model load from CDNs at runtime (jsdelivr + Google
  storage) — demo needs internet regardless of ngrok.
- ngrok free: URL changes each restart (re-share); players click through a
  "Visit Site" interstitial on first load.
- User (felpau; "paul" in-game) wants direct action: fix → push → exact
  commands to run. When a symptom recurs, always pair the fix with an
  observable verification step ("check X in DevTools", "look for log Y").

## 12. State at handoff

- main @ `83f9cfc`, everything pushed. Typecheck clean ×4 workspaces; server
  tests all pass (16 incl. subtests).
- Working tree: only untracked junk (dataset .bak files).
- ngrok URL this session: `https://unpainted-unexclusive-loren.ngrok-free.dev`
  (dies with the tunnel).
- **Last change NOT yet verified by the user:** the round-start stall
  elimination (`83f9cfc`, §5). User was about to rebuild + retest. If the
  freeze persists, start with the Network-tab check in §5 and the badge
  diagnostics in §7.
