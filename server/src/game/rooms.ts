// In-memory registry of active matches. Fine for a single live demo; swap for a
// store with persistence if you ever need multi-process. Room codes are short,
// uppercase, and unambiguous (no confusable characters) so players can read them
// aloud across two laptops.
import { customAlphabet } from 'nanoid';
import { GameRoom, type GameRoomCallbacks } from './GameRoom.js';

const rooms = new Map<string, GameRoom>();

// No 0/O/1/I to avoid read-aloud confusion.
const makeCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);

export function createRoom(cbFactory: (roomCode: string) => GameRoomCallbacks): GameRoom {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const room = new GameRoom(code, cbFactory(code));
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): GameRoom | undefined {
  return rooms.get(code.toUpperCase());
}

export function removeRoom(code: string): void {
  const room = rooms.get(code);
  if (room) {
    room.dispose();
    rooms.delete(code);
  }
}

export function allRooms(): GameRoom[] {
  return [...rooms.values()];
}
