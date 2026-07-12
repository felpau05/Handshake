// ─────────────────────────────────────────────────────────────────────────────
// Shared contract between client and server for ASL Word Battle.
// Both workspaces import these types so the socket protocol and game state stay
// in sync. Keep this file dependency-free (pure types + small const objects).
// The ASL letter recognition itself lives in @app/asl (client-only);
// the server only ever sees the final assembled word string.
// ─────────────────────────────────────────────────────────────────────────────

/** Which player slot within a match. */
export type PlayerSlot = 'p1' | 'p2';

/** Phases of the authoritative single-round GameRoom state machine. */
export type GamePhase =
  | 'LOBBY' // create/join, both ready up
  | 'STAKE' // host sets the flat wager
  | 'PROMPT' // Gemini reveals a prompt word
  | 'SPELL' // both players fingerspell simultaneously (timed)
  | 'RESOLVE' // Gemini validates words, longest valid wins
  | 'MATCH_END'; // settle wager, leaderboard

/** Per-player state the server tracks and broadcasts. */
export interface PlayerState {
  slot: PlayerSlot;
  /** Stable socket-independent id (issued on join). */
  playerId: string;
  displayName: string;
  connected: boolean;
  ready: boolean;
  /** Coins are the score currency; the flat wager is added/subtracted on win/loss. */
  totalCoins: number;
  /** Word submitted this round (null until submitted). */
  submittedWord: string | null;
  /** Gemini's verdict on the submitted word (null until resolved). */
  wordValid: boolean | null;
}

/** Full match snapshot pushed to clients on every state change. */
export interface MatchState {
  roomCode: string;
  phase: GamePhase;
  /** The current prompt word (e.g. "water"), or null before PROMPT. */
  prompt: string | null;
  /** Flat wager set before the match: winner +stake, loser -stake. */
  stake: number;
  players: Record<PlayerSlot, PlayerState | null>;
  /** ms epoch deadline for the current timed phase (SPELL), if any. */
  phaseDeadline: number | null;
  /** Slot of the match winner once phase === 'MATCH_END'. */
  matchWinner: PlayerSlot | null;
  /** True when the current prompt is a sudden-death tiebreaker. */
  suddenDeath: boolean;
}

/** Per-player word outcome in a resolved round. */
export interface WordOutcome {
  word: string;
  valid: boolean;
  /** Effective length used for comparison (0 when invalid). */
  length: number;
  /** Gemini's 0–10 sophistication score for the word (0 when invalid). */
  complexity: number;
  /** Gemini's 0–10 relatedness-to-prompt score (0 when invalid). */
  relatedness: number;
  /** Gemini's short one-line judgment of this specific word. */
  verdict: string;
}

/** Result of a resolved round (broadcast after RESOLVE). */
export interface MatchResult {
  /** Slot of the round winner, or null on a tie (→ sudden death). */
  winner: PlayerSlot | null;
  words: Record<PlayerSlot, WordOutcome>;
  /** True when this resolution was a tie and a sudden-death prompt follows. */
  suddenDeath: boolean;
  narrationText: string;
  /** Data/URL for ElevenLabs audio; null when voice is stubbed off. */
  narrationAudioUrl: string | null;
}

/** A leaderboard row (backed by MongoDB, or the in-memory fallback). */
export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  totalCoins: number;
  wins: number;
  losses: number;
}

// ── Socket protocol ──────────────────────────────────────────────────────────

export const SocketEvents = {
  // client → server
  CREATE_MATCH: 'create_match',
  JOIN_MATCH: 'join_match',
  SET_READY: 'set_ready',
  SET_STAKE: 'set_stake',
  SUBMIT_WORD: 'submit_word',
  SPELL_PROGRESS: 'spell_progress', // optional: live word length for the opponent
  LEAVE_MATCH: 'leave_match', // leave the current room and return to the lobby

  // server → client
  MATCH_STATE: 'match_state',
  MATCH_RESULT: 'match_result',
  NARRATION: 'narration',
  LEADERBOARD_UPDATE: 'leaderboard_update',
  ERROR: 'game_error',
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];

// ── Event payload types ──────────────────────────────────────────────────────

export interface CreateMatchPayload {
  displayName: string;
}
export interface JoinMatchPayload {
  roomCode: string;
  displayName: string;
}
export interface SetReadyPayload {
  ready: boolean;
}
export interface SetStakePayload {
  stake: number;
}
export interface SubmitWordPayload {
  word: string;
}
export interface SpellProgressPayload {
  /** Current in-progress word length (letters only; the word itself stays local). */
  length: number;
}

/** Server → client acknowledgement carrying the player's identity + room. */
export interface JoinedAck {
  roomCode: string;
  playerId: string;
  slot: PlayerSlot;
}

/** Server → client acknowledgement for SUBMIT_WORD — lets the client tell for
 *  certain whether the server actually accepted it (e.g. the phase hadn't
 *  already moved on), instead of assuming success on a fire-and-forget emit. */
export interface SubmitWordAck {
  error?: string;
}

export interface NarrationPayload {
  text: string;
  audioUrl: string | null;
}

export interface GameErrorPayload {
  code: string;
  message: string;
}
