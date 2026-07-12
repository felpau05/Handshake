import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom, type GameRoomCallbacks } from './GameRoom.js';

// No-op callbacks so the room can run without sockets/services.
const noopCb: GameRoomCallbacks = {
  broadcastState: () => {},
  broadcastResult: () => {},
  broadcastNarration: () => {},
  announcePrompt: async () => '',
  speak: async () => null,
  settleMatch: async () => {},
  collectEscrow: async () => {},
};

describe('GameRoom.removePlayer (back-to-lobby)', () => {
  it('vacates the slot and empties the room when both leave', () => {
    const room = new GameRoom('TEST', noopCb);
    room.addPlayer('Ava', 'acc-a');
    room.addPlayer('Ben', 'acc-b');
    assert.equal(room.isEmpty, false);

    room.removePlayer('p1');
    assert.equal(room.getState().players.p1, null);
    assert.equal(room.getState().players.p2?.displayName, 'Ben');
    assert.equal(room.isEmpty, false); // Ben still present

    room.removePlayer('p2');
    assert.equal(room.isEmpty, true); // now disposable
  });
});
