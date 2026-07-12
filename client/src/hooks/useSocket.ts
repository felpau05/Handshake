// Wires the shared socket's server→client events into the zustand store, and
// exposes typed client→server emit helpers. Mount `useSocket` once near the app
// root.
import { useEffect } from 'react';
import {
  SocketEvents,
  type GameErrorPayload,
  type JoinedAck,
  type MatchState,
  type MatchResult,
  type LetterCapture,
  type NarrationPayload,
  type SettlementPayload,
  type SpellFeedbackPayload,
  type SubmitWordAck,
} from '@app/shared';
import { socket } from '../lib/socket.js';
import { useGameStore } from '../state/gameStore.js';
import { useAuthStore } from '../state/authStore.js';

export function useSocket(): void {
  const { setMatch, setLastResult, setNarration, setError, setSettlement, setFeedback } =
    useGameStore();

  useEffect(() => {
    const onState = (state: MatchState) => setMatch(state);
    const onResult = (result: MatchResult) => setLastResult(result);
    const onNarration = (p: NarrationPayload) => setNarration(p.text, p.audioUrl);
    const onError = (e: GameErrorPayload) => setError(e.message);
    const onSettlement = (p: SettlementPayload) => {
      setSettlement(p);
      // The wager just moved on-chain — refresh the account bar's live balance.
      void useAuthStore.getState().fetchBalance();
    };
    const onFeedback = (p: SpellFeedbackPayload) => setFeedback(p);

    socket.on(SocketEvents.MATCH_STATE, onState);
    socket.on(SocketEvents.MATCH_RESULT, onResult);
    socket.on(SocketEvents.NARRATION, onNarration);
    socket.on(SocketEvents.ERROR, onError);
    socket.on(SocketEvents.SETTLEMENT, onSettlement);
    socket.on(SocketEvents.SPELL_FEEDBACK, onFeedback);

    return () => {
      socket.off(SocketEvents.MATCH_STATE, onState);
      socket.off(SocketEvents.MATCH_RESULT, onResult);
      socket.off(SocketEvents.NARRATION, onNarration);
      socket.off(SocketEvents.ERROR, onError);
      socket.off(SocketEvents.SETTLEMENT, onSettlement);
      socket.off(SocketEvents.SPELL_FEEDBACK, onFeedback);
    };
  }, [setMatch, setLastResult, setNarration, setError, setSettlement, setFeedback]);
}

// ── Typed emit helpers ───────────────────────────────────────────────────────

export function createMatch(displayName: string): Promise<JoinedAck> {
  return new Promise((resolve) => {
    socket.emit(SocketEvents.CREATE_MATCH, { displayName }, (ack: JoinedAck) => {
      useGameStore.getState().setIdentity(ack.roomCode, ack.playerId, ack.slot);
      resolve(ack);
    });
  });
}

export function joinMatch(roomCode: string, displayName: string): Promise<JoinedAck> {
  return new Promise((resolve) => {
    socket.emit(SocketEvents.JOIN_MATCH, { roomCode, displayName }, (ack: JoinedAck) => {
      if (ack?.playerId) {
        useGameStore.getState().setIdentity(ack.roomCode, ack.playerId, ack.slot);
      }
      resolve(ack);
    });
  });
}

export function setReady(ready: boolean): void {
  socket.emit(SocketEvents.SET_READY, { ready });
}

export function setStake(stake: number): void {
  socket.emit(SocketEvents.SET_STAKE, { stake });
}

/**
 * Submits a word and resolves with the server's real answer — accepted, or
 * rejected with a reason (e.g. the phase already moved on) — instead of the
 * old fire-and-forget emit, which gave the caller no way to tell a silent
 * drop from a real submission. Times out after 5s if the server never
 * responds at all (e.g. a dead connection).
 */
export function submitWord(word: string, captures?: LetterCapture[]): Promise<SubmitWordAck> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(
      SocketEvents.SUBMIT_WORD,
      { word, captures },
      (err: Error | null, ack?: SubmitWordAck) => {
        resolve(err ? { error: 'No response from server — check your connection.' } : ack ?? {});
      },
    );
  });
}

export function sendSpellProgress(length: number): void {
  socket.emit(SocketEvents.SPELL_PROGRESS, { length });
}

/** Tell the server this client's camera + ASL model are warm — the server
 *  holds the SPELL timer until both players have said so (or its cap fires). */
export function sendSpellReady(): void {
  socket.emit(SocketEvents.SPELL_READY);
}

/** Leave the current room and reset local match state → back to the lobby. */
export function leaveMatch(): void {
  socket.emit(SocketEvents.LEAVE_MATCH);
  useGameStore.getState().reset();
}
