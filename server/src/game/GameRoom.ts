// The authoritative match state machine. One instance per match. It owns ALL
// game state and phase transitions; clients only send intents (ready, purchase,
// move) which are validated here. It talks to the outside world (sockets +
// AI services) exclusively through the injected `GameRoomCallbacks`, so it stays
// decoupled and unit-testable.
import { nanoid } from 'nanoid';
import type {
  GamePhase,
  MatchState,
  Move,
  PlayerSlot,
  PlayerState,
  RoundResult,
  TwistId,
} from '@app/shared';
import { STARTING_TOKENS, validatePurchase } from './powerupCatalog.js';
import { resolveRound } from './RoundResolver.js';

// ── Tunable match config ─────────────────────────────────────────────────────
export const BEST_OF = 5; // first to ceil(5/2) = 3 round wins takes the match
export const STARTING_COINS = 100;
export const SHOP_DURATION_MS = 20_000;
export const CAPTURE_DURATION_MS = 6_000; // includes the 3-2-1-go countdown
const ROUND_WINS_TO_WIN = Math.ceil(BEST_OF / 2);

export interface RoundNarrationContext {
  round: number;
  moves: Record<PlayerSlot, Move | null>;
  winner: PlayerSlot | null;
  twist: TwistId | null;
  players: Record<PlayerSlot, PlayerState | null>;
}

/** Match-end coin outcome per player — shape-compatible with (but decoupled
 *  from) services/solana/ledger.ts's MatchSettlement, so GameRoom never has
 *  to import anything Solana-specific. */
export interface MatchSettlementInput {
  matchId: string;
  results: { playerId: string; deltaCoins: number; won: boolean }[];
}

/** Everything the room needs from the outside world. Injected, so tests can
 *  pass no-op stubs and production wires sockets + AI services. */
export interface GameRoomCallbacks {
  broadcastState(state: MatchState): void;
  broadcastRoundResult(result: RoundResult): void;
  broadcastNarration(text: string, audioUrl: string | null): void;
  requestWinnerPhoto(playerId: string): void;
  /** Gemini narration → text. */
  narrate(ctx: RoundNarrationContext): Promise<string>;
  /** ElevenLabs TTS → audio url/data, or null when voice is stubbed off. */
  speak(text: string): Promise<string | null>;
  /** Gemini balance twist for the upcoming round (whitelisted enum or null). */
  proposeTwist(state: MatchState): Promise<TwistId | null>;
  /** Coin/Solana settlement, fired once at MATCH_END. Must be best-effort on
   *  the implementation's side — GameRoom fires it without blocking or
   *  awaiting chain confirmation. */
  settleMatch(settlement: MatchSettlementInput): Promise<void>;
  /** Escrow deposit collection, fired once at match start (LOBBY → SHOP).
   *  Same best-effort contract as settleMatch. */
  collectEscrow(matchId: string, playerIds: string[]): Promise<void>;
}

export class GameRoom {
  readonly roomCode: string;
  private phase: GamePhase = 'LOBBY';
  private round = 0;
  private activeTwist: TwistId | null = null;
  private phaseDeadline: number | null = null;
  private matchWinner: PlayerSlot | null = null;
  private players: Record<PlayerSlot, PlayerState | null> = { p1: null, p2: null };
  private timer: NodeJS.Timeout | null = null;

  constructor(
    roomCode: string,
    private readonly cb: GameRoomCallbacks,
  ) {
    this.roomCode = roomCode;
  }

  // ── Player membership ──────────────────────────────────────────────────────

  /**
   * Add a player to the first open slot. Returns their id + slot, or null if full.
   * `accountId`, when given (a logged-in user's stable id), is used as the
   * playerId instead of a freshly minted one, so leaderboard stats and Solana
   * wallet settlement key off the same id across every match that account plays.
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
      coins: STARTING_COINS,
      roundWins: 0,
      tokens: STARTING_TOKENS,
      ownedPowerups: [],
      committedMove: null,
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

  // ── LOBBY → SHOP ───────────────────────────────────────────────────────────

  setReady(slot: PlayerSlot, ready: boolean): void {
    const p = this.players[slot];
    if (!p || this.phase !== 'LOBBY') return;
    p.ready = ready;
    this.broadcast();
    if (this.players.p1?.ready && this.players.p2?.ready) {
      this.enterShop();
    }
  }

  private enterShop(): void {
    this.round = 0;
    this.matchWinner = null;
    for (const p of this.eachPlayer()) {
      p.coins = STARTING_COINS;
      p.roundWins = 0;
      p.tokens = STARTING_TOKENS;
      p.ownedPowerups = [];
      p.committedMove = null;
      p.ready = false;
    }
    this.setPhase('SHOP', SHOP_DURATION_MS);
    this.armTimer(() => this.startNextRound(), SHOP_DURATION_MS);

    // Fire-and-forget escrow collection — must never block or break the match.
    const [p1, p2] = [this.players.p1!, this.players.p2!];
    void this.cb
      .collectEscrow(this.roomCode, [p1.playerId, p2.playerId])
      .catch((err) => console.error(`[GameRoom ${this.roomCode}] collectEscrow failed:`, err));
  }

  purchasePowerups(slot: PlayerSlot, powerupIds: string[]): { error?: string } {
    const p = this.players[slot];
    if (!p || this.phase !== 'SHOP') return { error: 'Not in shop phase' };
    const { accepted, spent, error } = validatePurchase(powerupIds, STARTING_TOKENS);
    if (error) return { error };
    p.ownedPowerups = accepted;
    p.tokens = STARTING_TOKENS - spent;
    p.ready = true; // purchasing (even nothing) marks the player shop-ready
    this.broadcast();
    // Both locked in early → skip the timer.
    if (this.players.p1?.ready && this.players.p2?.ready) {
      this.startNextRound();
    }
    return {};
  }

  // ── ROUND_INTRO → CAPTURE ──────────────────────────────────────────────────

  private async startNextRound(): Promise<void> {
    this.clearTimer();
    if (this.phase === 'MATCH_END') return;
    this.round += 1;
    for (const p of this.eachPlayer()) p.committedMove = null;

    this.setPhase('ROUND_INTRO', null);
    // Ask Gemini for an optional balance twist (whitelisted enum).
    this.activeTwist = await this.cb.proposeTwist(this.getState()).catch(() => null);
    this.broadcast();

    // Brief intro narration, then open capture.
    const introText = await this.cb
      .narrate({
        round: this.round,
        moves: { p1: null, p2: null },
        winner: null,
        twist: this.activeTwist,
        players: this.players,
      })
      .catch(() => `Round ${this.round}! Make your move.`);
    const introAudioUrl = await this.cb.speak(introText).catch(() => null);
    this.cb.broadcastNarration(introText, introAudioUrl);

    this.setPhase('CAPTURE', CAPTURE_DURATION_MS);
    this.armTimer(() => void this.resolveRound(), CAPTURE_DURATION_MS);
  }

  commitMove(slot: PlayerSlot, move: Move): void {
    const p = this.players[slot];
    if (!p || this.phase !== 'CAPTURE') return;
    p.committedMove = move;
    this.broadcast();
    // Both committed early → resolve immediately.
    if (this.players.p1?.committedMove && this.players.p2?.committedMove) {
      void this.resolveRound();
    }
  }

  // ── RESOLVE ────────────────────────────────────────────────────────────────

  private async resolveRound(): Promise<void> {
    this.clearTimer();
    if (this.phase !== 'CAPTURE') return;
    this.setPhase('RESOLVE', null);

    const p1 = this.players.p1!;
    const p2 = this.players.p2!;
    const moves: Record<PlayerSlot, Move | null> = {
      p1: p1.committedMove,
      p2: p2.committedMove,
    };

    const result = resolveRound({
      moves,
      twist: this.activeTwist,
      powerups: { p1: p1.ownedPowerups, p2: p2.ownedPowerups },
      coins: { p1: p1.coins, p2: p2.coins },
    });

    // Apply coin deltas + consume powerups + tally round wins.
    p1.coins += result.coinsDelta.p1;
    p2.coins += result.coinsDelta.p2;
    p1.ownedPowerups = p1.ownedPowerups.filter((id) => !result.consumed.p1.includes(id));
    p2.ownedPowerups = p2.ownedPowerups.filter((id) => !result.consumed.p2.includes(id));
    if (result.winner) this.players[result.winner]!.roundWins += 1;

    // Gemini narration + ElevenLabs voice for the result.
    const narrationText = await this.cb
      .narrate({
        round: this.round,
        moves,
        winner: result.winner,
        twist: this.activeTwist,
        players: this.players,
      })
      .catch(() => this.fallbackNarration(result.winner));
    const narrationAudioUrl = await this.cb.speak(narrationText).catch(() => null);

    const roundResult: RoundResult = {
      round: this.round,
      moves,
      winner: result.winner,
      coinsDelta: result.coinsDelta,
      twist: this.activeTwist,
      narrationText,
      narrationAudioUrl,
    };
    this.cb.broadcastRoundResult(roundResult);
    this.broadcast();

    // Match-end conditions: sudden death, or someone reached the win threshold.
    const p1Won = p1.roundWins >= ROUND_WINS_TO_WIN;
    const p2Won = p2.roundWins >= ROUND_WINS_TO_WIN;
    const suddenDeathLoss = result.suddenDeath && result.winner !== null;
    if (p1Won || p2Won || suddenDeathLoss) {
      this.endMatch(p1.roundWins >= p2.roundWins ? 'p1' : 'p2');
      return;
    }

    // Otherwise pause on the result briefly, then next round.
    this.armTimer(() => void this.startNextRound(), 3_500);
  }

  // ── MATCH_END ──────────────────────────────────────────────────────────────

  private endMatch(winner: PlayerSlot): void {
    this.clearTimer();
    this.matchWinner = winner;
    this.setPhase('MATCH_END', null);
    this.broadcast();
    const winnerPlayer = this.players[winner];
    if (winnerPlayer) this.cb.requestWinnerPhoto(winnerPlayer.playerId);

    // Fire-and-forget: settlement (including any on-chain transfer) must never
    // block match-end or crash the room on a chain/DB hiccup.
    const p1 = this.players.p1!;
    const p2 = this.players.p2!;
    void this.cb
      .settleMatch({
        matchId: this.roomCode,
        results: [
          { playerId: p1.playerId, deltaCoins: p1.coins - STARTING_COINS, won: winner === 'p1' },
          { playerId: p2.playerId, deltaCoins: p2.coins - STARTING_COINS, won: winner === 'p2' },
        ],
      })
      .catch((err) => console.error(`[GameRoom ${this.roomCode}] settleMatch failed:`, err));
  }

  // ── State helpers ──────────────────────────────────────────────────────────

  getState(): MatchState {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      round: this.round,
      bestOf: BEST_OF,
      players: {
        p1: this.players.p1 ? { ...this.players.p1 } : null,
        p2: this.players.p2 ? { ...this.players.p2 } : null,
      },
      activeTwist: this.activeTwist,
      phaseDeadline: this.phaseDeadline,
      matchWinner: this.matchWinner,
    };
  }

  dispose(): void {
    this.clearTimer();
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

  private fallbackNarration(winner: PlayerSlot | null): string {
    if (!winner) return "It's a tie! Nobody blinks.";
    const name = this.players[winner]?.displayName ?? 'The winner';
    return `${name} takes the round!`;
  }
}
