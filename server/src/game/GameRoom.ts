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
import { pickPromptWord } from './promptWords.js';
import { resolveWordBattle } from './WordBattleResolver.js';
import { getFillerNarration } from './fillerNarration.js';
import { env } from '../config/env.js';

// ── Tunable match config ─────────────────────────────────────────────────────
export const STARTING_COINS = 100;
export const SPELL_DURATION_MS = 25_000;
// How many rounds' worth of prompt reveals to keep pre-generated. Filled as
// soon as both players are in the lobby (see addPlayer), so most matches
// never wait on a fresh Gemini/ElevenLabs round-trip for any round, sudden
// death included.
const PROMPT_QUEUE_TARGET = 5;
// Floor for the post-result pause — the real pause is however long the result
// narration takes to say (see estimateSpeechMs), never less than this.
const RESULT_PAUSE_MS = 3_500;
// After this many consecutive ties, force a decision so a match always ends.
const MAX_SUDDEN_DEATH = 3;
// How long the room will hold PROMPT open waiting for both clients to report
// their camera + ASL model warm (SPELL_READY) before starting the spell timer
// anyway. A cap, not a wait-forever: a crashed client (or one falling back to
// keyboard entry, which never sends the signal) can't hold the match hostage.
const SPELL_READY_MAX_WAIT_MS = 8_000;

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
  /** Flat entry fee in SOL — fixed, not player-chosen (see enterStake). */
  private stake: number = env.SOLANA_BET_SOL;
  private suddenDeath = false;
  private suddenDeathCount = 0;
  private phaseDeadline: number | null = null;
  private matchWinner: PlayerSlot | null = null;
  private players: Record<PlayerSlot, PlayerState | null> = { p1: null, p2: null };
  private usedPrompts: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Which players have reported camera + ASL model warm this round. */
  private spellReady: Record<PlayerSlot, boolean> = { p1: false, p2: false };
  /** True only during the post-narration hold in startPrompt — the window in
   *  which a SPELL_READY signal is allowed to trigger the SPELL transition. */
  private awaitingSpellReady = false;
  /** Pre-generated prompt reveals (theme + Gemini banter + ElevenLabs audio),
   *  consumed in order by startPrompt(). Filled as soon as both players join
   *  (see addPlayer) and topped back up after each consumption, so a round —
   *  including sudden-death repeats — usually never waits on a fresh
   *  Gemini/ElevenLabs round-trip. */
  private promptQueue: Promise<PromptReveal>[] = [];

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
    if (this.players.p1 && this.players.p2) {
      console.log(`[GameRoom ${this.roomCode}] both players in the lobby -> pre-generating up to ${PROMPT_QUEUE_TARGET} rounds' worth of prompts`);
      this.fillPromptQueue();
    }
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
   *  Cancels any pending phase timer so an abandoned room can't fire callbacks.
   *  Leaving MID-MATCH forfeits: the remaining player wins immediately instead
   *  of being stranded in a phase whose timers were just cancelled. */
  removePlayer(slot: PlayerSlot): void {
    this.clearTimer();
    const leaver = this.players[slot];
    const otherSlot: PlayerSlot = slot === 'p1' ? 'p2' : 'p1';
    const other = this.players[otherSlot];
    if (leaver && other && this.phase !== 'LOBBY' && this.phase !== 'MATCH_END') {
      console.log(`[GameRoom ${this.roomCode}] ${leaver.displayName} left mid-match -> ${other.displayName} wins by forfeit`);
      this.endMatch(otherSlot); // leaver still occupies the slot here, so settlement sees both players
    }
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
    // A non-null matchWinner means a PREVIOUS match already finished in this
    // room (endMatch sets it) — i.e. this is a replay, not the room's first
    // match. Any leftover queued items were generated as sudden-death
    // flavor for that old match; wrong for a fresh opening round, so clear
    // and let fillPromptQueue() rebuild with correct slot-0 semantics. On
    // the room's actual first call this is false, so the queue addPlayer()
    // already started filling survives untouched.
    const isReplay = this.matchWinner !== null;
    if (isReplay) this.promptQueue = [];

    for (const p of this.eachPlayer()) {
      p.totalCoins = STARTING_COINS;
      p.ready = false;
      p.submittedWord = null;
      p.wordValid = null;
    }
    this.matchWinner = null;
    this.usedPrompts = [];
    this.suddenDeathCount = 0;
    // Fixed entry fee — not player-chosen. Re-read on every fresh match in
    // case the env var changed (e.g. hot-reloaded in dev).
    this.stake = env.SOLANA_BET_SOL;
    this.setPhase('STAKE', null);
    console.log(`[GameRoom ${this.roomCode}] LOBBY -> STAKE (entry fee ${this.stake} SOL)`);
    this.fillPromptQueue();
  }

  /** Confirms entry: locks the (fixed) stake in, collects escrow once both
   *  players have confirmed, and starts the first prompt. */
  setStake(slot: PlayerSlot, _stake: number): { error?: string } {
    const p = this.players[slot];
    if (!p || this.phase !== 'STAKE') return { error: 'Not in stake phase' };
    p.ready = true;
    this.broadcast();
    console.log(`[GameRoom ${this.roomCode}] ${p.displayName} confirmed entry (${this.stake} SOL)`);
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

  /** Kicks off Gemini announcePrompt() + ElevenLabs speak() for one specific
   *  prompt word (already picked by the caller — see fillPromptQueue). */
  private generateReveal(prompt: string, suddenDeath: boolean): Promise<PromptReveal> {
    return (async () => {
      const line = await this.cb
        .announcePrompt(prompt, suddenDeath)
        .catch(() => this.fallbackPromptLine(prompt, suddenDeath));
      const audio = await this.cb.speak(line).catch(() => null);
      return { prompt, line, audio };
    })();
  }

  /**
   * Tops the prompt queue back up to PROMPT_QUEUE_TARGET. Picks all the
   * themes for any new slots synchronously (each excluding every theme
   * already used OR already queued, so a single fill pass never queues
   * duplicates), then kicks off their Gemini/ElevenLabs generation truly in
   * parallel. Slot 0 (only ever picked once, right after both players join)
   * is the match's opening round; everything after it is sudden-death tone,
   * since in this single-round-per-match format any round beyond the first
   * IS a tiebreaker. Idempotent — safe to call from multiple places.
   */
  private fillPromptQueue(): void {
    if (this.promptQueue.length >= PROMPT_QUEUE_TARGET) return;
    // `reserved` is ONLY the exclusion list for picking distinct themes
    // within this pass — the loop's quota check is `promptQueue.length`
    // alone; adding reserved.length on top double-counts the very items
    // just pushed and silently under-fills the queue.
    const reserved: string[] = [];
    while (this.promptQueue.length < PROMPT_QUEUE_TARGET) {
      const suddenDeath = this.promptQueue.length > 0;
      const prompt = pickPromptWord([...this.usedPrompts, ...reserved]);
      reserved.push(prompt);
      this.promptQueue.push(this.generateReveal(prompt, suddenDeath));
    }
    console.log(`[GameRoom ${this.roomCode}] prompt queue topped up to ${this.promptQueue.length}/${PROMPT_QUEUE_TARGET} (generating in the background)`);
  }

  private async startPrompt(suddenDeath: boolean): Promise<void> {
    this.clearTimer();
    if (this.phase === 'MATCH_END') return;
    this.suddenDeath = suddenDeath;
    this.spellReady = { p1: false, p2: false };
    for (const p of this.eachPlayer()) {
      p.submittedWord = null;
      p.wordValid = null;
    }
    this.setPhase('PROMPT', null);

    let pending = this.promptQueue.shift();
    if (pending) {
      console.log(`[GameRoom ${this.roomCode}] PROMPT begins — using queued reveal (${this.promptQueue.length} left in queue)`);
    } else {
      // Queue exhausted (an unusually long sudden-death streak) — play a
      // cached filler line (real, pre-synthesized audio, zero extra latency)
      // while generating fresh.
      console.log(`[GameRoom ${this.roomCode}] PROMPT begins — queue empty, generating fresh + playing filler`);
      const filler = await getFillerNarration('prompt').catch(() => null);
      if (filler) {
        console.log(`[GameRoom ${this.roomCode}] narration (filler, before reveal ready): "${filler.text}"`);
        this.cb.broadcastNarration(filler.text, filler.audioUrl);
      }
      pending = this.generateReveal(pickPromptWord(this.usedPrompts), suddenDeath);
    }
    this.fillPromptQueue(); // top back up for the rounds after this one

    const { prompt, line, audio } = await pending;
    this.prompt = prompt;
    this.usedPrompts.push(prompt);
    // Without this, the client keeps showing whatever `prompt` was last
    // broadcast (null/empty on a match's first round, or the PREVIOUS
    // round's theme on sudden death) for the entire reveal-narration hold —
    // it only caught up once SPELL broadcast next. Theme text and reveal
    // narration must land together.
    this.broadcast();
    console.log(`[GameRoom ${this.roomCode}] narration (reveal) broadcast: "${line}" (prompt="${prompt}")`);
    this.cb.broadcastNarration(line, audio);

    // Hold PROMPT open until the reveal line actually finishes being said —
    // otherwise SPELL (and its submit timer) starts while the host is still
    // mid-sentence.
    await sleep(estimateSpeechMs(line));
    if (this.phase !== 'PROMPT') return; // room was reset/abandoned meanwhile

    // Hold here until both clients report their camera + ASL model warm —
    // otherwise the spell timer burns down while a slower machine is still
    // initializing detection. Capped so nobody can stall the match.
    if (this.spellReady.p1 && this.spellReady.p2) return this.beginSpell();
    this.awaitingSpellReady = true;
    console.log(`[GameRoom ${this.roomCode}] PROMPT done — waiting for both detectors (max ${SPELL_READY_MAX_WAIT_MS}ms)`);
    this.armTimer(() => this.beginSpell(), SPELL_READY_MAX_WAIT_MS);
  }

  /** A client reports its camera + ASL detector are loaded for this round. */
  setSpellReady(slot: PlayerSlot): void {
    if (!this.players[slot]) return;
    this.spellReady[slot] = true;
    if (this.awaitingSpellReady && this.spellReady.p1 && this.spellReady.p2) {
      console.log(`[GameRoom ${this.roomCode}] both detectors ready -> opening SPELL early`);
      this.beginSpell();
    }
  }

  private beginSpell(): void {
    if (this.phase !== 'PROMPT') return; // forfeit/reset happened during the wait
    this.awaitingSpellReady = false;
    console.log(`[GameRoom ${this.roomCode}] PROMPT -> SPELL (submission window opens)`);
    this.setPhase('SPELL', SPELL_DURATION_MS);
    this.armTimer(() => void this.resolve(), SPELL_DURATION_MS);
  }

  /** A player submits their assembled word (or auto-submitted at timeout).
   *  Returns an error when rejected (e.g. the phase already moved on) so the
   *  caller can tell the client for certain rather than assuming success —
   *  SUBMIT_WORD used to be fire-and-forget with no way to detect a drop. */
  submitWord(slot: PlayerSlot, word: string): { error?: string } {
    const p = this.players[slot];
    if (!p) return { error: 'Not in this match.' };
    if (this.phase !== 'SPELL') return { error: 'Spelling window is closed.' };
    p.submittedWord = word;
    this.broadcast();
    console.log(`[GameRoom ${this.roomCode}] ${p.displayName} submitted "${word}"`);
    // Both players must EXIST and have submitted. `players.p2?.submittedWord
    // !== null` alone is true for a vacated slot (undefined !== null), which
    // used to fire resolve() into a null player and crash the process.
    if (
      this.players.p1 && this.players.p2 &&
      this.players.p1.submittedWord !== null && this.players.p2.submittedWord !== null
    ) {
      void this.resolve();
    }
    return {};
  }

  // ── RESOLVE ────────────────────────────────────────────────────────────────

  private async resolve(): Promise<void> {
    this.clearTimer();
    if (this.phase !== 'SPELL') return;
    this.setPhase('RESOLVE', null);
    console.log(`[GameRoom ${this.roomCode}] SPELL -> RESOLVE`);

    // The prompt queue (filled since the lobby) almost always already has
    // the next sudden-death round ready by now; top it up regardless in case
    // an unusually long tie streak has been eating into it faster than
    // refills keep pace.
    this.fillPromptQueue();

    // Instant placeholder — judgeRound() is a real API call and takes a few
    // seconds; without this the screen just goes dead the moment SPELL ends.
    const filler = await getFillerNarration('resolve').catch(() => null);
    if (filler) {
      console.log(`[GameRoom ${this.roomCode}] narration (filler, while judging): "${filler.text}"`);
      this.cb.broadcastNarration(filler.text, filler.audioUrl);
    }

    // A player may have left during the filler-narration await above (their
    // slot is nulled) — bail instead of dereferencing null; removePlayer's
    // forfeit path already ended the match for whoever remains.
    const p1 = this.players.p1;
    const p2 = this.players.p2;
    if (!p1 || !p2) return;
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
    // The judge call takes seconds — a forfeit may have ended the match
    // meanwhile. Don't broadcast a result or arm end-timers on top of it.
    // (Cast: TS still has `phase` narrowed to 'SPELL' from the entry guard
    // and can't see that setPhase() reassigned it.)
    if ((this.phase as GamePhase) !== 'RESOLVE') return;
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
        console.log(`[GameRoom ${this.roomCode}] tie limit reached -> forcing a decision instead of another sudden death`);
        this.armTimer(() => this.endMatch(forced), pauseMs);
        return;
      }
      console.log(`[GameRoom ${this.roomCode}] tie -> sudden death (next round pulls from the prompt queue)`);
      this.armTimer(() => void this.startPrompt(true), pauseMs);
      return;
    }
    this.suddenDeathCount = 0;
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
