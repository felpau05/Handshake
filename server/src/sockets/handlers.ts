// Binds Socket.IO connections to GameRoom methods. This is the ONLY place that
// knows about both sockets and the game engine — GameRoom itself stays transport
// agnostic via the injected callbacks built in `makeCallbacks`.
import type { Server, Socket } from 'socket.io';
import {
  SocketEvents,
  type CreateMatchPayload,
  type GestureSelectedPayload,
  type JoinMatchPayload,
  type JoinedAck,
  type PlayerSlot,
  type PurchasePowerupsPayload,
  type SetReadyPayload,
} from '@app/shared';
import { GameRoom, type GameRoomCallbacks } from '../game/GameRoom.js';
import { createRoom, getRoom, removeRoom } from '../game/rooms.js';
import { narrateRound, proposeBalanceTwist } from '../services/gemini/geminiClient.js';
import { textToSpeech } from '../services/elevenlabs/ttsClient.js';
import { readAuthCookie, verifyAuthToken } from '../services/auth/jwt.js';
import { ledger } from '../services/solana/ledger.js';

/**
 * A match is always tied to a logged-in account: playing requires a valid
 * session, and that account's stable id becomes the match's playerId (see
 * GameRoom.addPlayer) so leaderboard stats + Solana wallet settlement persist
 * across matches. The client never gets to assert its own identity here —
 * only the verified session cookie does.
 */
function getAccountId(socket: Socket): string | null {
  return verifyAuthToken(readAuthCookie(socket.handshake.headers.cookie));
}

/** Per-socket association so we can find the player's room + slot on any event. */
interface SocketMeta {
  roomCode: string;
  slot: PlayerSlot;
  playerId: string;
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    let meta: SocketMeta | null = null;

    socket.on(SocketEvents.CREATE_MATCH, async (payload: CreateMatchPayload, ack?: Function) => {
      const accountId = getAccountId(socket);
      if (!accountId) return emitError(socket, 'NOT_AUTHENTICATED', 'Log in before starting a match.');
      const room = createRoom((roomCode) => makeCallbacks(io, roomCode));
      const joined = room.addPlayer(payload.displayName || 'Player 1', accountId);
      if (!joined) return; // should never happen on a fresh room
      meta = bind(socket, room, joined.slot, joined.playerId);
      ackJoin(ack, { roomCode: room.roomCode, playerId: joined.playerId, slot: joined.slot });
    });

    socket.on(SocketEvents.JOIN_MATCH, async (payload: JoinMatchPayload, ack?: Function) => {
      const accountId = getAccountId(socket);
      if (!accountId) return emitError(socket, 'NOT_AUTHENTICATED', 'Log in before joining a match.');
      const room = getRoom(payload.roomCode);
      if (!room) return emitError(socket, 'ROOM_NOT_FOUND', 'No match with that code.');
      const joined = room.addPlayer(payload.displayName || 'Player 2', accountId);
      if (!joined) return emitError(socket, 'ROOM_FULL', 'That match is already full.');
      meta = bind(socket, room, joined.slot, joined.playerId);
      ackJoin(ack, { roomCode: room.roomCode, playerId: joined.playerId, slot: joined.slot });
    });

    socket.on(SocketEvents.SET_READY, (payload: SetReadyPayload) => {
      const room = metaRoom(meta);
      room?.setReady(meta!.slot, payload.ready);
    });

    socket.on(SocketEvents.PURCHASE_POWERUPS, (payload: PurchasePowerupsPayload) => {
      const room = metaRoom(meta);
      const res = room?.purchasePowerups(meta!.slot, payload.powerupIds ?? []);
      if (res?.error) emitError(socket, 'PURCHASE_REJECTED', res.error);
    });

    socket.on(SocketEvents.GESTURE_SELECTED, (payload: GestureSelectedPayload) => {
      const room = metaRoom(meta);
      room?.commitMove(meta!.slot, payload.move);
    });

    socket.on('disconnect', () => {
      if (!meta) return;
      const room = getRoom(meta.roomCode);
      room?.setConnected(meta.slot, false);
      if (room?.isEmpty) removeRoom(meta.roomCode);
    });
  });
}

function bind(socket: Socket, room: GameRoom, slot: PlayerSlot, playerId: string): SocketMeta {
  socket.join(room.roomCode);
  socket.emit(SocketEvents.MATCH_STATE, room.getState());
  return { roomCode: room.roomCode, slot, playerId };
}

function metaRoom(meta: SocketMeta | null): GameRoom | undefined {
  return meta ? getRoom(meta.roomCode) : undefined;
}

function ackJoin(ack: Function | undefined, data: JoinedAck): void {
  if (typeof ack === 'function') ack(data);
}

function emitError(socket: Socket, code: string, message: string): void {
  socket.emit(SocketEvents.ERROR, { code, message });
}

/** Build the callbacks a GameRoom uses to reach sockets + AI services, all
 *  scoped to a single room code so events never leak across matches. */
function makeCallbacks(io: Server, roomCode: string): GameRoomCallbacks {
  const room = () => io.to(roomCode);
  return {
    broadcastState: (state) => room().emit(SocketEvents.MATCH_STATE, state),
    broadcastRoundResult: (result) => room().emit(SocketEvents.ROUND_RESULT, result),
    broadcastNarration: (text, audioUrl) =>
      room().emit(SocketEvents.NARRATION, { text, audioUrl }),
    requestWinnerPhoto: (playerId) =>
      room().emit(SocketEvents.CAPTURE_WINNER_PHOTO, { playerId }),
    narrate: (ctx) => narrateRound(ctx),
    speak: (text) => textToSpeech(text),
    proposeTwist: (state) => proposeBalanceTwist(state),
    settleMatch: (settlement) => ledger.settleMatch(settlement),
    collectEscrow: (matchId, playerIds) => ledger.collectEscrow(matchId, playerIds),
  };
}
