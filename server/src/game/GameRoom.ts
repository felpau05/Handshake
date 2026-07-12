// The authoritative match state machine for a single-round ASL Word Battle. One
// instance per match. It owns ALL game state and phase transitions; clients only
// send intents (ready, set stake, submit word) which are validated here. It talks
// to the outside world (sockets + AI services) exclusively through the injected
// `GameRoomCallbacks`, so it stays decoupled and testable.
import { nanoid } from 'nanoid';
import type {
  GamePhase,
  MatchState,
  PlayerSlot,
  PlayerState,
  MatchResult,
} from '@app/shared';
import { STAKE_OPTIONS } from '@app/shared';
import { pickPromptWord } from './promptWords.js';
import { resolveWordBattle } from './WordBattleResolver.js';
import { getFillerNarration } from './fillerNarration.js';

// ── Tunable match config ─────────────────────────────────────────────────────
export const STARTING_COINS = 100;
export const DEFAULT_STAKE = STAKE_OPTIONS[1]; // 20
export const SPELL_DURATION_MS = 25_000;
// Floor for the post-result pause — the real pause is however long the result
// narration takes to say (see estimateSpeechMs), never less than this.
const RESULT_PAUSE_MS = 3_500;
// After this many consecutive ties, force a decision so a match always ends.
const MAX_SUDDEN_DEATH = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rough estimate of how long a line takes to say out loud, so the server can
 * hold a phase open until the narration actually finishes instead of racing
 * ahead of it (~150 wpm speaking pace + a small safety buffer). Applied
 * whether or not real voice is configured, so text-only play gets the same
 * pacing/suspense.
 */
function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const speakingMs = (words / 150) * 60_000;
  return Math.max(1200, speakingMs) + 400;
}

/** Result of prefetching (or freshly generating) a prompt's reveal. */
interface PromptReveal {
  prompt: string;
  line: string;
  audio: string | null;
}

/** Match-end settlement input handed to the app to apply on the ledger + DB.
 *  `displayName` is carried per-result so the leaderboard upsert has a name. */
export interface MatchSettlementInput {
  matchId: string;
  results: { playerId: string; displayName: string; deltaCoins: number; won: boolean }[];
}

/** Everything the room needs from the outside world. Injected, so tests can
 *  pass no-op stubs and production wires sockets + AI services. */
export interface GameRoomCallbacks {
  broadcastState(state: MatchState): void;
  broadcastResult(result: MatchResult): void;
  broadcastNarration(text: string, audioUrl: string | null): void;
  requestWinnerPhoto(playerId: string): void;
  /** Gemini reveal line + optional move hint for a fresh prompt. */
  announcePrompt(prompt: string, suddenDeath: boolean): Promise<string>;
  /** ElevenLabs TTS → audio url/data, or null when voice is stubbed off. */
  speak(text: string): Promise<string | null>;
  /** Coin/Solana settlement + leaderboard, fired once at MATCH_END. Best-effort:
   *  GameRoom fires it without blocking or awaiting chain confirmation. */
  settleMatch(settlement: MatchSettlementInput): Promise<void>;
  /** Escrow deposit collection, fired once at match start (STAKE lock). Same
   *  best-effort contract as settleMatch. */
  collectEscrow(matchId: string, playerIds: string[]): Promise<void>;
}

export class GameRoom {
  readonly roomCode: string;
  private phase: GamePhase = 'LOBBY';
  private prompt: string | null = null;
  private stake: number = DEFAULT_STAKE;
  private suddenDeath = false;
  private suddenDeathCount = 0;
  private phaseDeadline: number | null = null;
  private matchWinner: PlayerSlot | null = null;
  private players: Record<PlayerSlot, PlayerState | null> = { p1: null, p2: null };
  private usedPrompts: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Speculative prefetch of the next prompt's reveal (theme + banter audio),
   *  kicked off ahead of need (see enterStake/resolve) so it's usually already
   *  ready by the time startPrompt() actually needs it. Discarded, not
   *  awaited, if the round it was hedging for turns out unneeded. */
  private nextPromptCache: Promise<PromptReveal> | null = null;

  constructor(
    roomCode: string,
    private readonly cb: GameRoomCallbacks,
  ) {
    this.roomCode = roomCode;
  }

  // ── Player membership ──────────────────────────────────────────────────────

  /**
   * Add a player to the first open slot. `accountId`, when given (a logged-in
   * user's stable id), is used as the playerId instead of a freshly minted one,
   * so leaderboard stats and Solana wallet settlement key off the same id across
   * every match that account plays.
   */
  addPlayer(displayName: string, accountId?: string): { playerId: string; slot: PlayerSlot } | null {
    const slot: PlayerSlot | null = !this.players.p1 ? 'p1' : !this.players.p2 ? 'p2' : null;
    if (!slot) return null;
    const playerId = accountId ?? nanoid(10);
    this.players[slot] = {
      slot,
      playerId,
      displayName,
      connected: true,
      ready: false,
      totalCoins: STARTING_COINS,
      submittedWord: null,
      wordValid: null,
    };
    this.broadcast();
    return { playerId, slot };
  }

  slotForPlayer(playerId: string): PlayerSlot | null {
    if (this.players.p1?.playerId === playerId) return 'p1';
    if (this.players.p2?.playerId === playerId) return 'p2';
    return null;
  }

  setConnected(slot: PlayerSlot, connected: boolean): void {
    const p = this.players[slot];
    if (p) {
      p.connected = connected;
      this.broadcast();
    }
  }

  /** Fully vacate a slot when a player leaves (e.g. post-game "back to lobby").
   *  Cancels any pending phase timer so an abandoned room can't fire callbacks. */
  removePlayer(slot: PlayerSlot): void {
    this.clearTimer();
    this.players[slot] = null;
    this.broadcast();
  }

  get isEmpty(): boolean {
    return !this.players.p1 && !this.players.p2;
  }

  // ── LOBBY → STAKE ──────────────────────────────────────────────────────────

  setReady(slot: PlayerSlot, ready: boolean): void {
    const p = this.players[slot];
    if (!p || this.phase !== 'LOBBY') return;
    p.ready = ready;
    this.broadcast();
    console.log(`[GameRoom ${this.roomCode}] ${p.displayName} ready (${slot})`);
    if (this.players.p1?.ready && this.players.p2?.ready) {
      this.enterStake();
    }
  }

  private enterStake(): void {
    for (const p of this.eachPlayer()) {
      p.totalCoins = STARTING_COINS;
      p.ready = false;
      p.submittedWord = null;
      p.wordValid = null;
    }
    this.matchWinner = null;
    this.usedPrompts = [];
    this.suddenDeathCount = 0;
    this.setPhase('STAKE', null);
    console.log(`[GameRoom ${this.roomCode}] LOBBY -> STAKE; prefetching first prompt reveal in the background`);
    // Kicked off now, while players are setting the stake, so it's usually
    // already ready by the time STAKE locks in and startPrompt() needs it.
    this.nextPromptCache = this.startPromptPrefetch(false);
  }

  /** Either player may set the stake; readying up locks it, collects escrow, and
   *  starts the first prompt. */
  setStake(slot: PlayerSlot, stake: number): { error?: string } {
    const p = this.players[slot];
    if (!p || this.phase !== 'STAKE') return { error: 'Not in stake phase' };
    if (!Number.isFinite(stake) || stake <= 0) return { error: 'Invalid stake' };
    this.stake = Math.floor(stake);
    p.ready = true;
    this.broadcast();
    console.log(`[GameRoom ${this.roomCode}] ${p.displayName} locked in stake=${this.stake}`);
    if (this.players.p1?.ready && this.players.p2?.ready) {
      // Fire-and-forget escrow collection at match start — must never block or
      // break the match if a wallet/chain call fails.
      const [a, b] = [this.players.p1!, this.players.p2!];
      void this.cb
        .collectEscrow(this.roomCode, [a.playerId, b.playerId])
        .catch((err) => console.error(`[GameRoom ${this.roomCode}] collectEscrow failed:`, err));
      console.log(`[GameRoom ${this.roomCode}] STAKE locked by both players -> starting first prompt`);
      void this.startPrompt(false);
    }
    return {};
  }

  // ── PROMPT → SPELL ─────────────────────────────────────────────────────────

  /** Kicks off Gemini announcePrompt() + ElevenLabs speak() for a fresh prompt
   *  word. Does NOT commit it to usedPrompts — only startPrompt() does that,
   *  once it actually consumes the result — so speculative callers (enterStake,
   *  resolve) can prefetch work that might end up discarded (a decisive round
   *  never needs the "next sudden-death prompt" it hedged for). */
  private startPromptPrefetch(suddenDeath: boolean): Promise<PromptReveal> {
    const prompt = pickPromptWord(this.usedPrompts);
    return (async () => {
      const line = await this.cb
        .announcePrompt(prompt, suddenDeath)
        .catch(() => this.fallbackPromptLine(prompt, suddenDeath));
      const audio = await this.cb.speak(line).catch(() => null);
      return { prompt, line, audio };
    })();
  }

  private async startPrompt(suddenDeath: boolean): Promise<void> {
    this.clearTimer();
    if (this.phase === 'MATCH_END') return;
    this.suddenDeath = suddenDeath;
    for (const p of this.eachPlayer()) {
      p.submittedWord = null;
      p.wordValid = null;
    }
    this.setPhase('PROMPT', null);

    let pending = this.nextPromptCache;
    this.nextPromptCache = null;
    if (pending) {
      console.log(`[GameRoom ${this.roomCode}] PROMPT begins — using prefetched reveal (no wait)`);
    } else {
      // No prefetch was ready (e.g. STAKE locked in faster than the prefetch
      // finished) — play a cached filler line (real, pre-synthesized audio,
      // zero extra latency) while generating fresh.
      console.log(`[GameRoom ${this.roomCode}] PROMPT begins — no prefetch ready, generating fresh + playing filler`);
      const filler = await getFillerNarration('prompt').catch(() => null);
      if (filler) {
        console.log(`[GameRoom ${this.roomCode}] narration (filler, before reveal ready): "${filler.text}"`);
        this.cb.broadcastNarration(filler.text, filler.audioUrl);
      }
      pending = this.startPromptPrefetch(suddenDeath);
    }

    const { prompt, line, audio } = await pending;
    this.prompt = prompt;
    this.usedPrompts.push(prompt);
    console.log(`[GameRoom ${this.roomCode}] narration (reveal) broadcast: "${line}"`);
    this.cb.broadcastNarration(line, audio);

    // Hold PROMPT open until the reveal line actually finishes being said —
    // otherwise SPELL (and its submit timer) starts while the host is still
    // mid-sentence.
    await sleep(estimateSpeechMs(line));
    if (this.phase !== 'PROMPT') return; // room was reset/abandoned meanwhile

    console.log(`[GameRoom ${this.roomCode}] PROMPT -> SPELL (submission window opens)`);
    this.setPhase('SPELL', SPELL_DURATION_MS);
    this.armTimer(() => void this.resolve(), SPELL_DURATION_MS);
  }

  /** A player submits their assembled word (or auto-submitted at timeout). */
  submitWord(slot: PlayerSlot, word: string): void {
    const p = this.players[slot];
    if (!p || this.phase !== 'SPELL') return;
    p.submittedWord = word;
    this.broadcast();
    console.log(`[GameRoom ${this.roomCode}] ${p.displayName} submitted "${word}"`);
    if (this.players.p1?.submittedWord !== null && this.players.p2?.submittedWord !== null) {
      void this.resolve();
    }
  }

  // ── RESOLVE ────────────────────────────────────────────────────────────────

  private async resolve(): Promise<void> {
    this.clearTimer();
    if (this.phase !== 'SPELL') return;
    this.setPhase('RESOLVE', null);
    console.log(`[GameRoom ${this.roomCode}] SPELL -> RESOLVE`);

    // Speculatively prefetch the NEXT sudden-death prompt now, in parallel
    // with judging below — the judgment can't be known ahead of the words
    // players actually submitted, but the next prompt's content doesn't
    // depend on that at all. If this round ties, startPrompt() picks this up
    // already-ready; if it's decisive, it's simply discarded (unused).
    const suddenDeathPrefetch = this.startPromptPrefetch(true);

    // Instant placeholder — judgeRound() is a real API call and takes a few
    // seconds; without this the screen just goes dead the moment SPELL ends.
    const filler = await getFillerNarration('resolve').catch(() => null);
    if (filler) {
      console.log(`[GameRoom ${this.roomCode}] narration (filler, while judging): "${filler.text}"`);
      this.cb.broadcastNarration(filler.text, filler.audioUrl);
    }

    const p1 = this.players.p1!;
    const p2 = this.players.p2!;
    const words: Record<PlayerSlot, string | null> = {
      p1: p1.submittedWord,
      p2: p2.submittedWord,
    };

    // One Gemini call judges both words, decides the winner, and writes the
    // narration together — see WordBattleResolver/geminiClient.judgeRound.
    const { winner, tie, outcomes, narration } = await resolveWordBattle({
      prompt: this.prompt!,
      words,
    });
    p1.wordValid = outcomes.p1.valid;
    p2.wordValid = outcomes.p2.valid;

    const narrationText = narration || this.fallbackNarration(winner, outcomes);
    const narrationAudioUrl = await this.cb.speak(narrationText).catch(() => null);
    // Without this, the client's VoicePlayer keeps showing/playing whatever
    // NARRATION event fired last (the PROMPT reveal line) straight through
    // RESOLVE and MATCH_END — match_result carries the real outcome text as
    // data, but nothing tells the narration display to switch to it.
    console.log(`[GameRoom ${this.roomCode}] narration (result) broadcast: "${narrationText}" (winner=${winner}, tie=${tie})`);
    this.cb.broadcastNarration(narrationText, narrationAudioUrl);

    const result: MatchResult = {
      winner,
      words: outcomes,
      suddenDeath: tie,
      narrationText,
      narrationAudioUrl,
    };
    this.cb.broadcastResult(result);
    this.broadcast();

    // Pause at least RESULT_PAUSE_MS, but never less than the result
    // narration actually takes to say — otherwise a longer, funnier line
    // gets cut off by sudden death / match end before it finishes.
    const pauseMs = Math.max(RESULT_PAUSE_MS, estimateSpeechMs(narrationText));

    if (tie) {
      this.suddenDeathCount += 1;
      if (this.suddenDeathCount >= MAX_SUDDEN_DEATH) {
        // Too many ties — force a decision so the match always ends. Decide by
        // raw letter count (validity-agnostic); still tied → deterministic pick.
        const forced = this.forceDecide(words);
        void suddenDeathPrefetch.catch(() => undefined); // unused — discard
        console.log(`[GameRoom ${this.roomCode}] tie limit reached -> forcing a decision instead of another sudden death`);
        this.armTimer(() => this.endMatch(forced), pauseMs);
        return;
      }
      // The next prompt is very likely already ready (prefetched above) —
      // startPrompt() will pick it straight up with no wait.
      this.nextPromptCache = suddenDeathPrefetch;
      console.log(`[GameRoom ${this.roomCode}] tie -> sudden death (next prompt prefetch in flight since judging started)`);
      this.armTimer(() => void this.startPrompt(true), pauseMs);
      return;
    }
    this.suddenDeathCount = 0;
    void suddenDeathPrefetch.catch(() => undefined); // unused — match is ending, discard
    console.log(`[GameRoom ${this.roomCode}] decisive result (winner=${winner}) -> MATCH_END`);
    this.armTimer(() => this.endMatch(winner!), pauseMs);
  }

  // ── MATCH_END ──────────────────────────────────────────────────────────────

  private endMatch(winner: PlayerSlot): void {
    this.clearTimer();
    this.matchWinner = winner;
    const loser: PlayerSlot = winner === 'p1' ? 'p2' : 'p1';
    const w = this.players[winner]!;
    const l = this.players[loser]!;
    w.totalCoins += this.stake;
    l.totalCoins -= this.stake;
    this.setPhase('MATCH_END', null);
    this.broadcast();
    console.log(`[GameRoom ${this.roomCode}] MATCH_END — ${w.displayName} wins, stake ${this.stake}`);

    // Fire-and-forget: settlement (ledger + leaderboard) must never block
    // match-end or crash the room on a chain/DB hiccup.
    void this.cb
      .settleMatch({
        matchId: this.roomCode,
        results: [
          { playerId: w.playerId, displayName: w.displayName, deltaCoins: this.stake, won: true },
          { playerId: l.playerId, displayName: l.displayName, deltaCoins: -this.stake, won: false },
        ],
      })
      .catch((err) => console.error(`[GameRoom ${this.roomCode}] settleMatch failed:`, err));
    this.cb.requestWinnerPhoto(w.playerId);
  }

  // ── State helpers ──────────────────────────────────────────────────────────

  getState(): MatchState {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      prompt: this.prompt,
      stake: this.stake,
      players: {
        p1: this.players.p1 ? { ...this.players.p1 } : null,
        p2: this.players.p2 ? { ...this.players.p2 } : null,
      },
      phaseDeadline: this.phaseDeadline,
      matchWinner: this.matchWinner,
      suddenDeath: this.suddenDeath,
    };
  }

  /** The current stake — used by routes to settle the wager on the ledger. */
  get currentStake(): number {
    return this.stake;
  }

  dispose(): void {
    this.clearTimer();
  }

  /** Last-resort tiebreaker after MAX_SUDDEN_DEATH ties: longer raw word wins;
   *  still equal → deterministic pick so the match always terminates. */
  private forceDecide(words: Record<PlayerSlot, string | null>): PlayerSlot {
    const l1 = (words.p1 ?? '').replace(/[^a-zA-Z]/g, '').length;
    const l2 = (words.p2 ?? '').replace(/[^a-zA-Z]/g, '').length;
    if (l1 !== l2) return l1 > l2 ? 'p1' : 'p2';
    return Math.random() < 0.5 ? 'p1' : 'p2';
  }

  private *eachPlayer(): Generator<PlayerState> {
    if (this.players.p1) yield this.players.p1;
    if (this.players.p2) yield this.players.p2;
  }

  private setPhase(phase: GamePhase, durationMs: number | null): void {
    this.phase = phase;
    this.phaseDeadline = durationMs ? Date.now() + durationMs : null;
    this.broadcast();
  }

  private broadcast(): void {
    this.cb.broadcastState(this.getState());
  }

  private armTimer(fn: () => void, ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(fn, ms);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private fallbackPromptLine(prompt: string, suddenDeath: boolean): string {
    return suddenDeath
      ? `Sudden death! Spell your best word for "${prompt}"!`
      : `Your word is "${prompt}" — spell the biggest related word you can!`;
  }

  private fallbackNarration(
    winner: PlayerSlot | null,
    outcomes: Record<PlayerSlot, { word: string; valid: boolean }>,
  ): string {
    if (!winner) return "It's a tie — we go to sudden death!";
    const name = this.players[winner]?.displayName ?? 'The winner';
    const w = outcomes[winner];
    return `${name} wins it with "${w.word}"!`;
  }
}
