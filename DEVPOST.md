# Handshake

**Fingerspell to win real SOL — a voice-narrated, AI-judged word duel you play entirely with your hands.**

## Inspiration

Most sign language learning tools are flashcards. Nobody trash-talks you in a flashcard app. We wanted learning ASL fingerspelling to feel like a game show: a hype announcer, a wager on the line, and an opponent racing you letter for letter. If losing 0.5 SOL to your friend because you can't sign an E properly doesn't motivate you to practice, nothing will.

## What it does

Two players face off from their own laptops, webcams on:

1. **Ante up.** Each player stakes 0.5 SOL (Solana devnet), pulled into escrow with a real on-chain transaction.
2. **The host reveals a theme.** An AI game-show host — Gemini writing the lines, ElevenLabs voicing them — announces something like *"ocean"* and dares you to impress it.
3. **40 seconds to spell.** Both players fingerspell the best related word they can, letter by letter in ASL, read live from the webcam. Thumbs up submits, thumbs down deletes. If both submit early, the round ends early.
4. **The AI judges.** One Gemini call validates both words (strict: it has to be a real word *genuinely related* to the theme — "we" doesn't fly), scores complexity and relatedness, picks a winner, and writes a snarky one-liner that gets spoken aloud. Ties go to sudden death.
5. **Winner takes the pot.** The house wallet pays out on-chain, and both players see the money move: the transaction on Solana Explorer, their delta in green or red, and their live new wallet balance.
6. **The signing coach reviews your tape.** During the round we snapshot your hand at the exact moment each letter commits. At match end, a multimodal Gemini call looks at your actual hand photos, figures out the word you were *trying* to spell (you signed OCEEN? it knows you meant OCEAN), flags the letters that misread, and gives concrete handshape tips — next to photos of your own hands doing it wrong.

There's also a persistent leaderboard showing every player's win/loss record and their **live on-chain SOL balance**.

## How we built it

- **Hand recognition, fully in-browser:** MediaPipe HandLandmarker extracts 21 hand keypoints per frame; we normalize them (wrist-origin, scale, mirror) and feed them to a small TensorFlow.js MLP **we trained ourselves** — 28 classes (A–Z plus thumbs-up SUBMIT and thumbs-down BACKSPACE) on **~73k samples**: a public ASL alphabet dataset as the base, merged with webcam samples we collected from multiple players — including the gesture controls, which exist in no public dataset. 99.3% validation accuracy, and the confusions it does make (N/T, R/U) are handshapes that genuinely look alike in ASL. A stability filter turns the noisy ~30fps prediction stream into clean, deliberate letter commits. Recognition is fully client-side: the live video never leaves the laptop — the server sees only the final word, plus the tiny per-letter hand snapshots that power the signing coach.
- **Server-authoritative game engine:** Node + Socket.IO state machine (lobby → stake → prompt → spell → resolve → match end). Clients only send intents; the server owns all state.
- **Gemini as the gamemaster:** one call per round judges both words and writes the narration together; a separate multimodal call (text + hand photos) powers the post-match signing coach.
- **ElevenLabs voice:** every host line is synthesized to speech. We pre-generate five rounds of themes and narration while players sit in the lobby, so the show never pauses to think.
- **Solana devnet wagers:** escrow collection at match start, winner payout at match end, all via `@solana/web3.js`, with graceful degradation — a chain hiccup never breaks the game.
- **Accounts + leaderboard:** MongoDB Atlas, JWT cookie auth, each account linked to a wallet address.
- **Containerized stack:** the whole app ships as a Docker Compose stack — an nginx reverse proxy (WebSocket-aware) in front of the game server, with Redis provisioned alongside. Secrets never enter the image: wallet keypairs and API credentials are mounted read-only at runtime, so the image is safe to push anywhere. Game rooms are deliberately pinned to a single authoritative instance — the same reason real game servers pin matches to one host — and the horizontal scale path (Socket.IO Redis adapter + sticky sessions) is already wired into the topology.
- **Front end:** React + Vite + Zustand, served with the API from a single origin — one `docker compose up` (or one ngrok tunnel) and two laptops anywhere can play.

## Challenges we ran into

- **The 10-second frozen round.** On slower laptops, rounds started with a dead camera and a stuck timer. Root cause: MediaPipe and TF.js compile GPU shaders lazily on *first inference* — and MediaPipe's landmark stage only compiles once it actually sees a hand. We fixed it by warming up at page load against a bundled photo of a hand.
- **Letters that wouldn't commit.** One low-confidence frame used to reset the hold timer, so on low-FPS machines letters never landed. We added a grace window to the stability filter.
- **Hands are personal.** A model trained on one person's hands reads another person's poorly. We built a collect tool, gathered ~16k samples of our own hands across the weakest letters, and retrained.
- **AI latency vs. game feel.** Gemini and TTS take seconds; a game show can't buffer. Pre-fetching themes and narration, filler lines while judging, and holding phases until the audio actually finishes made it feel live.
- **A generous judge.** Gemini would pass any real English word — "we" beat actual themed words. We tightened the prompt and added a deterministic backstop (filler-word blocklist, relatedness floor) so the rules are actually rules.

## Accomplishments we're proud of

- A custom ASL letter classifier running at full frame rate in a browser tab, with gesture controls (submit and delete without touching the keyboard).
- Real on-chain wagers that settle themselves, with the receipt on screen.
- A feedback loop that genuinely teaches: it reconstructs the word you meant, shows you the exact frame your hand went wrong, and tells you how to fix it.
- A one-command deploy: the full stack — proxy, game server, cache — comes up with `docker compose up`, with secrets kept out of the image by construction.

## What we learned

- GPU pipelines in the browser fail lazily — warm everything, then warm the part you didn't know existed.
- Multimodal prompting with strict-JSON outputs needs a deterministic safety net; the model is a judge, not the law.
- Game feel is mostly latency engineering: prefetch, filler, and never let the room go silent.
- Real-time game state doesn't shard naively: we containerized everything and put a proxy tier in front, but kept match state on one authoritative instance and documented the honest scale path instead of shipping a load balancer that drops rooms.

## What's next

- Training data from many more hands, for a model that works for everyone out of the box.
- Real wallet adapters (Phantom et al.) instead of demo keypairs, and mainnet-ready escrow.
- Turning on the Redis-backed Socket.IO adapter for multi-instance scale, and a cloud deploy of the existing Docker stack.
- More modes: longest streak, team relay, and a practice mode built around the signing coach.

## Built with

TypeScript · React · Vite · Zustand · Node.js · Socket.IO · MediaPipe · TensorFlow.js · Gemini (Vertex AI) · ElevenLabs · Solana (@solana/web3.js) · MongoDB Atlas · Docker · nginx · Redis · ngrok
