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

// ── Tunable match config ─────────────────────────────────────────────────────
export const STARTING_COINS = 100;
export const DEFAULT_STAKE = STAKE_OPTIONS[1]; // 20
export const SPELL_DURATION_MS = 25_000;
const RESULT_PAUSE_MS = 3_500;
// After this many consecutive ties, force a decision so a match always ends.
const MAX_SUDDEN_DEATH = 3;

/** Context passed to narration so Gemini can comment on the round. */
export interface RoundNarrationContext {
  prompt: string;
  words: Record<PlayerSlot, string | null>;
  winner: PlayerSlot | null;
  suddenDeath: boolean;
  players: Record<PlayerSlot, PlayerState | null>;
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
  /** Gemini narration → text. */
  narrate(ctx: RoundNarrationContext): Promise<string>;
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

  get isEmpty(): boolean {
    return !this.players.p1 && !this.players.p2;
  }

  // ── LOBBY → STAKE ──────────────────────────────────────────────────────────

  setReady(slot: PlayerSlot, ready: boolean): void {
    const p = this.players[slot];
    if (!p || this.phase !== 'LOBBY') return;
    p.ready = ready;
    this.broadcast();
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
    if (this.players.p1?.ready && this.players.p2?.ready) {
      // Fire-and-forget escrow collection at match start — must never block or
      // break the match if a wallet/chain call fails.
      const [a, b] = [this.players.p1!, this.players.p2!];
      void this.cb
        .collectEscrow(this.roomCode, [a.playerId, b.playerId])
        .catch((err) => console.error(`[GameRoom ${this.roomCode}] collectEscrow failed:`, err));
      void this.startPrompt(false);
    }
    return {};
  }

  // ── PROMPT → SPELL ─────────────────────────────────────────────────────────

  private async startPrompt(suddenDeath: boolean): Promise<void> {
    this.clearTimer();
    if (this.phase === 'MATCH_END') return;
    this.suddenDeath = suddenDeath;
    for (const p of this.eachPlayer()) {
      p.submittedWord = null;
      p.wordValid = null;
    }
    this.prompt = pickPromptWord(this.usedPrompts);
    this.usedPrompts.push(this.prompt);
    this.setPhase('PROMPT', null);

    const line = await this.cb
      .announcePrompt(this.prompt, suddenDeath)
      .catch(() => this.fallbackPromptLine(this.prompt!, suddenDeath));
    const audio = await this.cb.speak(line).catch(() => null);
    this.cb.broadcastNarration(line, audio);

    this.setPhase('SPELL', SPELL_DURATION_MS);
    this.armTimer(() => void this.resolve(), SPELL_DURATION_MS);
  }

  /** A player submits their assembled word (or auto-submitted at timeout). */
  submitWord(slot: PlayerSlot, word: string): void {
    const p = this.players[slot];
    if (!p || this.phase !== 'SPELL') return;
    p.submittedWord = word;
    this.broadcast();
    if (this.players.p1?.submittedWord !== null && this.players.p2?.submittedWord !== null) {
      void this.resolve();
    }
  }

  // ── RESOLVE ────────────────────────────────────────────────────────────────

  private async resolve(): Promise<void> {
    this.clearTimer();
    if (this.phase !== 'SPELL') return;
    this.setPhase('RESOLVE', null);

    const p1 = this.players.p1!;
    const p2 = this.players.p2!;
    const words: Record<PlayerSlot, string | null> = {
      p1: p1.submittedWord,
      p2: p2.submittedWord,
    };

    const { winner, tie, outcomes } = await resolveWordBattle({
      prompt: this.prompt!,
      words,
    });
    p1.wordValid = outcomes.p1.valid;
    p2.wordValid = outcomes.p2.valid;

    const narrationText = await this.cb
      .narrate({
        prompt: this.prompt!,
        words,
        winner,
        suddenDeath: this.suddenDeath,
        players: this.players,
      })
      .catch(() => this.fallbackNarration(winner, outcomes));
    const narrationAudioUrl = await this.cb.speak(narrationText).catch(() => null);

    const result: MatchResult = {
      winner,
      words: outcomes,
      suddenDeath: tie,
      narrationText,
      narrationAudioUrl,
    };
    this.cb.broadcastResult(result);
    this.broadcast();

    if (tie) {
      this.suddenDeathCount += 1;
      if (this.suddenDeathCount >= MAX_SUDDEN_DEATH) {
        // Too many ties — force a decision so the match always ends. Decide by
        // raw letter count (validity-agnostic); still tied → deterministic pick.
        const forced = this.forceDecide(words);
        this.armTimer(() => this.endMatch(forced), RESULT_PAUSE_MS);
        return;
      }
      // Otherwise, another sudden-death prompt after a brief pause.
      this.armTimer(() => void this.startPrompt(true), RESULT_PAUSE_MS);
      return;
    }
    this.suddenDeathCount = 0;
    this.armTimer(() => this.endMatch(winner!), RESULT_PAUSE_MS);
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
