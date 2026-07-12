// Client-side mirror of the server's authoritative state. The store never
// mutates game logic — it holds the latest server-pushed MatchState plus a little
// local UI state (my identity, latest result/narration). Components read from
// here; hooks write to it as socket events arrive.
import { create } from 'zustand';
import type {
  LeaderboardEntry,
  MatchState,
  MatchResult,
  PlayerSlot,
} from '@app/shared';

interface GameStore {
  // identity
  roomCode: string | null;
  playerId: string | null;
  mySlot: PlayerSlot | null;

  // server-pushed state
  match: MatchState | null;
  lastResult: MatchResult | null;
  narration: { text: string; audioUrl: string | null } | null;
  leaderboard: LeaderboardEntry[];
  error: string | null;

  // actions
  setIdentity: (roomCode: string, playerId: string, mySlot: PlayerSlot) => void;
  setMatch: (match: MatchState) => void;
  setLastResult: (result: MatchResult | null) => void;
  setNarration: (text: string, audioUrl: string | null) => void;
  setLeaderboard: (entries: LeaderboardEntry[]) => void;
  setError: (message: string | null) => void;
  reset: () => void;

  // derived helpers
  me: () => MatchState['players'][PlayerSlot] | null;
  opponent: () => MatchState['players'][PlayerSlot] | null;
}

export const useGameStore = create<GameStore>((set, get) => ({
  roomCode: null,
  playerId: null,
  mySlot: null,
  match: null,
  lastResult: null,
  narration: null,
  leaderboard: [],
  error: null,

  setIdentity: (roomCode, playerId, mySlot) => set({ roomCode, playerId, mySlot }),
  setMatch: (match) => {
    // The instant a FRESH round's PROMPT phase begins, drop any previous
    // round's result — otherwise ResultView (rendered during RESOLVE) keeps
    // showing last round's words for the several seconds it takes Gemini to
    // judge this one, which reads as "my submission didn't register."
    const justEnteredPrompt = match.phase === 'PROMPT' && get().match?.phase !== 'PROMPT';
    set(justEnteredPrompt ? { match, lastResult: null } : { match });
  },
  setLastResult: (lastResult) => set({ lastResult }),
  setNarration: (text, audioUrl) => set({ narration: { text, audioUrl } }),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      roomCode: null,
      playerId: null,
      mySlot: null,
      match: null,
      lastResult: null,
      narration: null,
      error: null,
    }),

  me: () => {
    const { match, mySlot } = get();
    return match && mySlot ? match.players[mySlot] : null;
  },
  opponent: () => {
    const { match, mySlot } = get();
    if (!match || !mySlot) return null;
    return match.players[mySlot === 'p1' ? 'p2' : 'p1'];
  },
}));
