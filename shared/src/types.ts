// ─────────────────────────────────────────────────────────────────────────────
// Shared contract between client and server.
// Both workspaces import these types so the socket protocol and game state stay
// in sync. Keep this file dependency-free (pure types + small const objects).
// ─────────────────────────────────────────────────────────────────────────────

/** The base Rock-Paper-Scissors moves. Extend here to add variant moves. */
export type Move = 'rock' | 'paper' | 'scissors';

export const MOVES: readonly Move[] = ['rock', 'paper', 'scissors'] as const;

/** Which player slot within a match. */
export type PlayerSlot = 'p1' | 'p2';

/** Phases of the authoritative GameRoom state machine. */
export type GamePhase =
  | 'LOBBY'
  | 'SHOP'
  | 'ROUND_INTRO'
  | 'CAPTURE'
  | 'RESOLVE'
  | 'MATCH_END';

/** Whitelisted balance twists Gemini may pick from (never free-form). */
export type TwistId =
  | 'DOUBLE_STAKES' // this round's coin swing is ±40 instead of ±20
  | 'SUDDEN_DEATH' // loser of this round loses the match immediately
  | 'MIRROR' // a tie awards both players the win
  | 'UNDERDOG_BOOST'; // trailing player wins ties this round

export const TWIST_IDS: readonly TwistId[] = [
  'DOUBLE_STAKES',
  'SUDDEN_DEATH',
  'MIRROR',
  'UNDERDOG_BOOST',
] as const;

/** A purchasable powerup. Catalog lives server-side in powerupCatalog.ts. */
export interface Powerup {
  id: string;
  name: string;
  description: string;
  /** Cost in tokens (each player has 10 to spend before a match). */
  cost: number;
  /** If true, it's consumed after a single round; otherwise lasts the match. */
  oneTimeUse: boolean;
}

/** Per-player state the server tracks and broadcasts. */
export interface PlayerState {
  slot: PlayerSlot;
  /** Stable socket-independent id (issued on join). */
  playerId: string;
  displayName: string;
  connected: boolean;
  ready: boolean;
  /** Coins are the score / trophy currency (starts at a configured baseline). */
  coins: number;
  /** Round wins this match (first to ceil(BEST_OF/2) wins the match). */
  roundWins: number;
  /** Tokens left in the pre-match shop (starts at 10). */
  tokens: number;
  /** Powerup ids the player owns for the current match. */
  ownedPowerups: string[];
  /** Move committed for the in-progress CAPTURE phase, if any. */
  committedMove: Move | null;
}

/** Full match snapshot pushed to clients on every state change. */
export interface MatchState {
  roomCode: string;
  phase: GamePhase;
  round: number;
  bestOf: number;
  players: Record<PlayerSlot, PlayerState | null>;
  /** Active balance twist for the current round, if any. */
  activeTwist: TwistId | null;
  /** ms epoch deadline for the current timed phase (SHOP / CAPTURE), if any. */
  phaseDeadline: number | null;
  /** Slot of the match winner once phase === 'MATCH_END'. */
  matchWinner: PlayerSlot | null;
}

/** Result of a single resolved round (broadcast after RESOLVE). */
export interface RoundResult {
  round: number;
  moves: Record<PlayerSlot, Move | null>;
  /** null == tie. */
  winner: PlayerSlot | null;
  /** Signed coin change applied to each player this round. */
  coinsDelta: Record<PlayerSlot, number>;
  twist: TwistId | null;
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
// Event name constants so client and server never disagree on strings.

export const SocketEvents = {
  // client → server
  CREATE_MATCH: 'create_match',
  JOIN_MATCH: 'join_match',
  SET_READY: 'set_ready',
  PURCHASE_POWERUPS: 'purchase_powerups',
  GESTURE_SELECTED: 'gesture_selected',

  // server → client
  MATCH_STATE: 'match_state',
  ROUND_RESULT: 'round_result',
  NARRATION: 'narration',
  CAPTURE_WINNER_PHOTO: 'capture_winner_photo',
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
export interface PurchasePowerupsPayload {
  powerupIds: string[];
}
export interface GestureSelectedPayload {
  move: Move;
  /** Classifier confidence 0..1 (1 for keyboard/button fallback). */
  confidence: number;
  /** How the move was entered — useful for narration/debug. */
  source: 'camera' | 'keyboard';
}

/** Server → client acknowledgement carrying the player's identity + room. */
export interface JoinedAck {
  roomCode: string;
  playerId: string;
  slot: PlayerSlot;
}

export interface NarrationPayload {
  text: string;
  audioUrl: string | null;
}

export interface CaptureWinnerPhotoPayload {
  playerId: string;
}

export interface GameErrorPayload {
  code: string;
  message: string;
}
