// Binds Socket.IO connections to GameRoom methods. This is the ONLY place that
// knows about both sockets and the game engine — GameRoom itself stays transport
// agnostic via the injected callbacks built in `makeCallbacks`.
import type { Server, Socket } from 'socket.io';
import {
  SocketEvents,
  type CreateMatchPayload,
  type JoinMatchPayload,
  type JoinedAck,
  type PlayerSlot,
  type SetReadyPayload,
  type SetStakePayload,
  type SubmitWordPayload,
  type LetterCapture,
} from '@app/shared';
import { GameRoom, type GameRoomCallbacks } from '../game/GameRoom.js';
import { createRoom, getRoom, removeRoom } from '../game/rooms.js';
import { announcePrompt, generateSpellFeedback } from '../services/gemini/geminiClient.js';
import { textToSpeech } from '../services/elevenlabs/ttsClient.js';
import { readAuthCookie, verifyAuthToken } from '../services/auth/jwt.js';
import { ledger, getWalletBalanceSol } from '../services/solana/ledger.js';
import { findUserById } from '../services/auth/userStore.js';
import { upsertPlayerResult } from '../services/mongo/leaderboard.js';
import { env } from '../config/env.js';

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
      metaRoom(meta)?.setReady(meta!.slot, payload.ready);
    });

    socket.on(SocketEvents.SET_STAKE, (payload: SetStakePayload) => {
      const res = metaRoom(meta)?.setStake(meta!.slot, payload.stake);
      if (res?.error) emitError(socket, 'STAKE_REJECTED', res.error);
    });

    socket.on(SocketEvents.SPELL_READY, () => {
      metaRoom(meta)?.setSpellReady(meta!.slot);
    });

    socket.on(SocketEvents.SUBMIT_WORD, (payload: SubmitWordPayload, ack?: Function) => {
      const room = metaRoom(meta);
      const res = room
        ? room.submitWord(meta!.slot, payload.word ?? '', sanitizeCaptures(payload.captures))
        : { error: 'Not in a match.' };
      if (typeof ack === 'function') ack(res);
      if (res.error) emitError(socket, 'SUBMIT_REJECTED', res.error);
    });

    // Leave the current room (post-game "back to lobby") without disconnecting
    // the socket, so the player can immediately create/join a fresh match.
    socket.on(SocketEvents.LEAVE_MATCH, () => {
      if (!meta) return;
      const room = getRoom(meta.roomCode);
      room?.removePlayer(meta.slot);
      socket.leave(meta.roomCode);
      if (room?.isEmpty) removeRoom(meta.roomCode);
      meta = null;
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

/** Clamp client-supplied letter captures to sane bounds before they enter the
 *  game: at most one per possible letter (20), and only small JPEG data URLs —
 *  a hostile/buggy client can't stuff megabytes into room memory. */
function sanitizeCaptures(raw: unknown): LetterCapture[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const letter = typeof o.letter === 'string' ? o.letter.slice(0, 1).toUpperCase() : '?';
    const confidence =
      typeof o.confidence === 'number' && Number.isFinite(o.confidence)
        ? Math.max(0, Math.min(1, o.confidence))
        : null;
    const image =
      typeof o.image === 'string' &&
      o.image.startsWith('data:image/jpeg;base64,') &&
      o.image.length < 150_000
        ? o.image
        : null;
    return {
      letter,
      confidence,
      timestamp: typeof o.timestamp === 'number' ? o.timestamp : 0,
      image,
    };
  });
}

/** Build the callbacks a GameRoom uses to reach sockets + AI services, all
 *  scoped to a single room code so events never leak across matches. */
function makeCallbacks(io: Server, roomCode: string): GameRoomCallbacks {
  const room = () => io.to(roomCode);
  return {
    broadcastState: (state) => room().emit(SocketEvents.MATCH_STATE, state),
    broadcastResult: (result) => room().emit(SocketEvents.MATCH_RESULT, result),
    broadcastNarration: (text, audioUrl) =>
      room().emit(SocketEvents.NARRATION, { text, audioUrl }),
    announcePrompt: (prompt, suddenDeath) => announcePrompt(prompt, suddenDeath),
    speak: (text) => textToSpeech(text),
    // Settle the wager on Solana (escrow → winner) AND record both players on the
    // leaderboard. Both are best-effort; a failure is logged, never thrown.
    // Once the chain settles, broadcast a SETTLEMENT report (payout tx + fresh
    // wallet balances) so both clients can SHOW the money actually moving.
    settleMatch: async (settlement) => {
      const report = await ledger
        .settleMatch(settlement)
        .catch((err): { payoutSignature: null } => {
          console.error('[settle] ledger failed:', err);
          return { payoutSignature: null };
        });
      await Promise.all(
        settlement.results.map((r) =>
          upsertPlayerResult({
            playerId: r.playerId,
            displayName: r.displayName,
            deltaCoins: r.deltaCoins,
            won: r.won,
          }).catch((err) => console.error('[settle] leaderboard upsert failed:', err)),
        ),
      );

      // Read each player's LIVE post-settlement balance and broadcast the
      // whole report to the room. Best-effort: a failed lookup just means
      // that player's balance renders as "unavailable".
      try {
        const players = await Promise.all(
          settlement.results.map(async (r) => {
            const user = await findUserById(r.playerId).catch(() => null);
            const walletAddress = user?.walletAddress ?? null;
            const newBalanceSol = walletAddress ? await getWalletBalanceSol(walletAddress) : null;
            return {
              playerId: r.playerId,
              displayName: r.displayName,
              // deltaCoins IS the SOL stake now (+bet winner / -bet loser).
              deltaSol: r.deltaCoins,
              walletAddress,
              newBalanceSol,
            };
          }),
        );
        room().emit(SocketEvents.SETTLEMENT, {
          matchId: settlement.matchId,
          betSol: env.SOLANA_BET_SOL,
          potSol: env.SOLANA_BET_SOL * 2,
          payoutSignature: report.payoutSignature,
          players,
        });
        console.log(
          `[settle] match ${settlement.matchId}: settlement report broadcast (payout tx ${report.payoutSignature ?? 'none'})`,
        );
      } catch (err) {
        console.error('[settle] settlement report broadcast failed:', err);
      }
    },
    collectEscrow: (matchId, playerIds) => ledger.collectEscrow(matchId, playerIds),
    // Signing coach: one Gemini call per player (feedback is personal — it
    // looks at THEIR hand photos and THEIR word), broadcast to the room in a
    // single payload; each client picks out its own entry by playerId.
    deliverSpellFeedback: async (inputs) => {
      const players = await Promise.all(
        inputs.map((input) =>
          generateSpellFeedback(input).catch((err) => {
            console.error(`[feedback] generation failed for ${input.displayName}:`, err);
            return null;
          }),
        ),
      );
      const delivered = players.filter((p) => p !== null);
      if (!delivered.length) return;
      room().emit(SocketEvents.SPELL_FEEDBACK, { players: delivered });
      console.log(`[feedback] signing feedback broadcast for ${delivered.length} player(s)`);
    },
  };
}
