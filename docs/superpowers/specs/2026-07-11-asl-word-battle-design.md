# ASL Word Battle — Design Spec

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan
**Supersedes:** the Rock-Paper-Scissors game loop in the current skeleton
(`.claude/plans/structure-use-2-nested-sutherland.md`). The meta-systems
(Gemini, ElevenLabs, Solana, MongoDB, winner portraits, server-authoritative
Socket.IO architecture, monorepo layout) carry over; the RPS core is replaced.

---

## 1. Context

The existing skeleton is a two-laptop, camera-driven **Rock-Paper-Scissors** game
with a Gemini gamemaster. We are pivoting the core game to an **ASL fingerspelling
word battle** while keeping the surrounding architecture and services.

This spec is the authoritative description of the new game. It follows the user's
final feature list exactly:

- Gemini is the gamemaster brain.
- ElevenLabs speaks **and understands** to banter with the players.
- The camera tracks the users' hand signs.
- Gemini narrates the game live ("Nice move", and suggests a move to use).
- Gemini shows a one-word prompt from a database of open-ended words (like "water").
- **Whoever signs the biggest word relating to the prompt wins.**
- Each player wins or loses a **flat amount set before the game**.
- Solana is the score/coin tracker and trophies.
- MongoDB tracks the leaderboard; winning players may have images attached.

## 2. Core game concept

Two players, each at their own laptop with a webcam. A match is a **single-round
showdown**:

1. A flat **wager** is set before the match.
2. Gemini reveals **one open-ended prompt word** (e.g. "water").
3. Both players **simultaneously fingerspell** a word that relates to the prompt,
   using the ASL alphabet, within a time limit.
4. Gemini **validates** each submitted word (must be a real word **and** relate to
   the prompt). Invalid/unrelated words do not count.
5. **The longest valid word wins the match.** The winner gains the wager; the
   loser loses it.
6. Winner's photo is captured and turned into a themed AI portrait (leaderboard
   avatar). Results are recorded on Solana (trophies/coins) and MongoDB
   (leaderboard).

**Tie handling:** if both valid words are the same length, or both words are
invalid, Gemini reveals **one sudden-death prompt** and the spell/resolve repeats
until the round is decisive.

## 3. Architecture

Unchanged from the skeleton: **two browser clients ↔ one server-authoritative
Node game server (Express + Socket.IO)**, plus external services (Gemini,
ElevenLabs, Solana, MongoDB). Clients send only *intents* (set stake, spell
progress, submit word); the **server owns all game state** — prompt selection,
validation orchestration, winner determination, wager settlement, phase
transitions — and pushes the authoritative `MatchState` to both laptops.

```
Laptop A (browser)                         Laptop B (browser)
 getUserMedia → @cuhack/asl-detector        getUserMedia → @cuhack/asl-detector
 (MediaPipe+TF.js → LetterEvents)           (MediaPipe+TF.js → LetterEvents)
 client assembles word + wave-delete        client assembles word + wave-delete
        \                                          /
         \---------------- Socket.IO --------------/
                             |
                     Node Game Server (Express + Socket.IO)
                     authoritative single-round GameRoom
                      /        |          |          \
                 Gemini    ElevenLabs   MongoDB     Solana
              (prompt +    (speaks +   (leaderboard  (wager /
               validate +   understands  + avatars)    trophies)
               narrate)     = banter)
```

### Monorepo workspaces

```
asl-detector/   NEW — @cuhack/asl-detector: video → ASL LetterEvents. Isolated.
shared/         TypeScript types + game rules — the client/server contract.
server/         Express + Socket.IO + single-round GameRoom + service wrappers.
client/         React + Vite + zustand — spell arena, stake setup, results, UI.
```

## 4. `@cuhack/asl-detector` (new workspace)

A browser TypeScript module that turns a `<video>` element into a stream of ASL
letter events. Runs **entirely client-side** (MediaPipe + TF.js in the browser —
required because each visitor uses their own camera). It does **not** do word
assembly, spacing, delete, or UI.

**API:**

```ts
import { createAslDetector } from '@cuhack/asl-detector';

const detector = createAslDetector({ minConfidence: 0.85, holdMs: 600 });
await detector.init();
detector.attachVideo(videoEl);
detector.on('letter', (e) => { /* { letter, confidence, timestamp } */ });
detector.start();
```

**Contract:**
- Emits one `LetterEvent = { letter: string; confidence: number; timestamp: number }`
  per **intentional** letter — no duplicates, no per-frame spam. Debouncing/hold
  logic (a letter must be held stable for `holdMs` above `minConfidence`) lives
  inside the detector.
- Supports **24 letters** (the ASL alphabet **excluding J and Z**, which require
  motion).
- Requires camera access and a secure context (HTTPS or `localhost`).
- **Ships its own model assets** (bundled, not fetched from a third-party CDN at
  runtime) so the demo is offline-safe.
- Lifecycle: `init()` (load model), `attachVideo(el)`, `start()`, `stop()`,
  `destroy()`. `on(event, cb)` / `off(event, cb)` for subscription.

The detector is intentionally ignorant of the game. Word assembly, wave-to-delete,
timers, and UI are the client app's responsibility (Section 7).

## 5. Game loop / state machine (server-authoritative)

One `GameRoom` instance per match. Phases:

1. **LOBBY** — host creates a room (short code), second player joins by code, both
   ready up.
2. **STAKE** — the host sets a **flat wager** (coins) for the match; both players
   see it. This replaces the old powerup shop.
3. **PROMPT** — server picks a word from the prompt database, Gemini reveals and
   narrates it (and may `suggestMove()` a hint of a word to sign). Broadcast to
   both clients.
4. **SPELL** — a timed phase (default **25s**). Both players fingerspell
   simultaneously:
   - The client feeds detector `LetterEvent`s to append letters to an in-progress
     word.
   - A **wave-to-delete** gesture pops the last letter; keyboard `Backspace` is a
     guaranteed fallback.
   - **No autocorrect** — players own their mistakes.
   - A player submits via a "Done" action, or the word auto-submits at timer
     expiry. Only the assembled word string (+ metadata) is sent to the server.
5. **RESOLVE** — server calls Gemini `validateWord(word, prompt)` for each player.
   A word counts only if it is a real word **and** relates to the prompt; invalid
   words are treated as length 0. The **longest valid word wins**. Gemini narrates
   the outcome; ElevenLabs voices it.
   - Tie (equal valid length) or both invalid → **sudden-death**: return to PROMPT
     with a new word. Repeat until decisive.
6. **MATCH_END** — the winning client captures a photo → server calls image-gen for
   a themed portrait → stored as the player's leaderboard avatar. Server settles
   the **wager** on Solana (winner +stake, loser −stake) and updates the MongoDB
   leaderboard (win/loss + coins + avatar). Final leaderboard broadcast.

**Config constants** (in `GameRoom.ts`): `SPELL_DURATION_MS = 25_000`, default
stake options, sudden-death behavior.

## 6. Word validation & prompt database

- **Prompt database:** a curated `server/src/game/promptWords.ts` — an array of
  open-ended, evocative single words (e.g. `water`, `fire`, `music`, `ocean`,
  `storm`, `dream`). The server picks one at random per prompt; Gemini narrates
  the reveal. Words that would *require* J/Z to answer are not needed — players
  can always find a related word using the 24 available letters.
- **Validation:** Gemini `validateWord(word, prompt) → { valid: boolean; relates:
  boolean; reason?: string }`. A word scores only when `valid && relates`.
  Degrades gracefully offline: when no `GEMINI_API_KEY` is set, a stub accepts any
  word ≥ 2 letters as valid+related (so the game is playable on mocks), and
  length still decides.
- Because the detector emits only 24 letters, submitted words never contain J/Z;
  validation operates on whatever the client assembled.

## 7. Client responsibilities (spell arena)

The client owns everything the detector does not:

- **Word assembly** — subscribe to detector `letter` events, append to the
  in-progress word, render it live.
- **Wave-to-delete** — a small, separate gesture watcher on the same video detects
  a gross horizontal hand wave and pops the last letter. Because the detector's
  contract is letters-only, delete is a client concern. Keyboard `Backspace` is
  the guaranteed fallback so a demo never stalls. (Implementation note: running a
  second MediaPipe instance for wave detection is acceptable; the plan will pick
  the exact mechanism to keep it lightweight.)
- **Timer + submit** — show the SPELL countdown; submit on "Done" or auto-submit
  at expiry.
- **UI** — hearts are gone; the arena shows the prompt, the in-progress word,
  the opponent's live word length (not letters), the timer, and the result.

New/changed React pieces: `StakeSetup` (replaces `PowerupShop`), `SpellArena`
(video + detector wiring + word-in-progress + wave-delete + timer), `PromptReveal`,
`ResultView`. Kept: `Lobby`, `Leaderboard`, `VoicePlayer`, `WinnerPhotoCapture`.
Removed: RPS `useHandTracking`, `gestureClassifier`, `CameraView` (RPS variant),
`CaptureCountdown` (repurposed), `RoundResult` (RPS variant).

## 8. Services (kept, adjusted)

- **Gemini** (`services/gemini/geminiClient.ts`) — gains `pickPrompt()` (or select
  from the DB), `validateWord(word, prompt)`, `suggestMove(prompt)`; keeps
  `narrate()` for live commentary. Whitelisted-enum twists are removed.
- **ElevenLabs** (`services/elevenlabs/`) — `textToSpeech()` (speaks) stays. The
  **banter loop** ("understands") is designed as a real component:
  `understandAndBanter(audio) → STT → Gemini reply → TTS`. It is the last piece to
  enable; everything works without it. TTS works from the start.
- **Solana** (`services/solana/ledger.ts`) — `CoinLedger` interface unchanged;
  `settleMatch()` now applies the **flat wager** (winner +stake, loser −stake) and
  records a trophy. MockLedger default; DevnetLedger behind `USE_REAL_SOLANA`.
- **MongoDB** (`services/mongo/`) — leaderboard keeps `displayName`, `avatarUrl`,
  `totalCoins`, `wins`, `losses`; coins accumulate from wagers. In-memory fallback
  when `MONGODB_URI` is unset.
- **Image-gen** (`services/imagegen/imageGenClient.ts`) — unchanged; winner photo →
  themed portrait → avatar. Stub passthrough by default.

## 9. Shared contract changes (`shared/src/types.ts`)

- **Remove:** `Move`, `MOVES`, `Powerup`, `TwistId`, powerup/twist fields, RPS
  `RoundResult`.
- **Add:**
  - `GamePhase = 'LOBBY' | 'STAKE' | 'PROMPT' | 'SPELL' | 'RESOLVE' | 'MATCH_END'`
  - `PlayerState` — `slot`, `playerId`, `displayName`, `connected`, `ready`,
    `totalCoins`, `submittedWord: string | null`, `wordValid: boolean | null`.
  - `MatchState` — `roomCode`, `phase`, `prompt: string | null`, `stake: number`,
    `players`, `phaseDeadline`, `matchWinner`, `suddenDeath: boolean`.
  - `MatchResult` — `winner`, `words: Record<slot, {word, valid, length}>`,
    `narrationText`, `narrationAudioUrl`.
  - Socket events: `SET_STAKE`, `SUBMIT_WORD`, `SPELL_PROGRESS` (optional, for live
    length), plus existing `MATCH_STATE`, `MATCH_RESULT`, `NARRATION`,
    `CAPTURE_WINNER_PHOTO`, `LEADERBOARD_UPDATE`, `ERROR`.
  - `LetterEvent` type re-exported for the client (or owned by the detector).

## 10. What is explicitly out of scope / deferred

- Hearts / health / multi-round damage (replaced by single-round showdown).
- Powerups / token shop (replaced by the pre-match wager).
- J/Z letters (excluded — motion letters).
- Real Solana devnet settlement (mock ledger for the demo; devnet behind a flag).
- ElevenLabs STT banter is designed but is the last feature to enable.

## 11. Verification (how we'll know it works)

- `npm run typecheck` clean across all four workspaces.
- Unit tests: `WordBattleResolver` (length compare, invalid → 0, tie → sudden
  death) and the detector's hold/debounce logic.
- `@cuhack/asl-detector` demo page: signing letters emits deduped `LetterEvent`s
  (no per-frame spam), 24 letters recognized, J/Z never emitted.
- Two-client end-to-end (mocks, no keys): create/join → set stake → prompt reveals
  → both spell (keyboard fallback ok) → longest valid word wins → wager settles →
  winner appears on the leaderboard with an avatar. Tie triggers sudden death.
- Camera/HTTPS: playable over one HTTPS origin (ngrok/localhost); `Backspace`
  fallback works with the camera off.

## 12. Critical files

- `asl-detector/src/index.ts` — the detector module + `createAslDetector`.
- `shared/src/types.ts` — the new contract (Section 9).
- `server/src/game/GameRoom.ts` — single-round state machine.
- `server/src/game/WordBattleResolver.ts` — winner determination.
- `server/src/game/promptWords.ts` — curated prompt database.
- `server/src/services/gemini/geminiClient.ts` — prompt/validate/suggest/narrate.
- `client/src/components/SpellArena.tsx` — detector wiring + word assembly + delete.
