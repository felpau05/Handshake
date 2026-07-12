// Wires the shared socket's server→client events into the zustand store, and
// exposes typed client→server emit helpers. Mount `useSocket` once near the app
// root.
import { useEffect } from 'react';
import {
  SocketEvents,
  type CaptureWinnerPhotoPayload,
  type GameErrorPayload,
  type JoinedAck,
  type MatchState,
  type MatchResult,
  type NarrationPayload,
} from '@app/shared';
import { socket } from '../lib/socket.js';
import { useGameStore } from '../state/gameStore.js';

type OnWinnerPhoto = (payload: CaptureWinnerPhotoPayload) => void;

export function useSocket(onWinnerPhoto?: OnWinnerPhoto): void {
  const { setMatch, setLastResult, setNarration, setError } = useGameStore();

  useEffect(() => {
    const onState = (state: MatchState) => setMatch(state);
    const onResult = (result: MatchResult) => setLastResult(result);
    const onNarration = (p: NarrationPayload) => setNarration(p.text, p.audioUrl);
    const onError = (e: GameErrorPayload) => setError(e.message);
    const onPhoto = (p: CaptureWinnerPhotoPayload) => onWinnerPhoto?.(p);

    socket.on(SocketEvents.MATCH_STATE, onState);
    socket.on(SocketEvents.MATCH_RESULT, onResult);
    socket.on(SocketEvents.NARRATION, onNarration);
    socket.on(SocketEvents.ERROR, onError);
    socket.on(SocketEvents.CAPTURE_WINNER_PHOTO, onPhoto);

    return () => {
      socket.off(SocketEvents.MATCH_STATE, onState);
      socket.off(SocketEvents.MATCH_RESULT, onResult);
      socket.off(SocketEvents.NARRATION, onNarration);
      socket.off(SocketEvents.ERROR, onError);
      socket.off(SocketEvents.CAPTURE_WINNER_PHOTO, onPhoto);
    };
  }, [setMatch, setLastResult, setNarration, setError, onWinnerPhoto]);
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

export function submitWord(word: string): void {
  socket.emit(SocketEvents.SUBMIT_WORD, { word });
}

export function sendSpellProgress(length: number): void {
  socket.emit(SocketEvents.SPELL_PROGRESS, { length });
}

/** Leave the current room and reset local match state → back to the lobby. */
export function leaveMatch(): void {
  socket.emit(SocketEvents.LEAVE_MATCH);
  useGameStore.getState().reset();
}
