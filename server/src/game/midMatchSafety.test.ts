// Regression tests for mid-match player-departure safety:
// 1. A submit after the opponent's slot was vacated must NOT fire resolve()
//    into a null player (used to throw inside a void'd promise → unhandled
//    rejection → whole-process crash).
// 2. Leaving mid-match forfeits: the remaining player wins immediately
//    instead of being stranded in a phase whose timers were just cancelled.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom, type GameRoomCallbacks } from './GameRoom.js';

const noopCb: GameRoomCallbacks = {
  broadcastState: () => {},
  broadcastResult: () => {},
  broadcastNarration: () => {},
  announcePrompt: async () => '',
  speak: async () => null,
  settleMatch: async () => {},
  collectEscrow: async () => {},
  deliverSpellFeedback: async () => {},
};

/** Drive a fresh room to the SPELL phase (ready → stake → prompt → spell). */
async function roomInSpell(): Promise<GameRoom> {
  const room = new GameRoom('TEST', noopCb);
  room.addPlayer('Ava', 'acc-a');
  room.addPlayer('Ben', 'acc-b');
  room.setReady('p1', true);
  room.setReady('p2', true); // → STAKE
  room.setStake('p1', 0);
  room.setStake('p2', 0); // → startPrompt (async: narration hold)
  // Both detectors "warm" so the SPELL gate opens as soon as PROMPT's
  // narration hold finishes.
  room.setSpellReady('p1');
  room.setSpellReady('p2');
  // startPrompt sleeps ≥1200ms (estimateSpeechMs floor) before SPELL opens.
  const deadline = Date.now() + 5_000;
  while (room.getState().phase !== 'SPELL') {
    if (Date.now() > deadline) throw new Error(`never reached SPELL (stuck in ${room.getState().phase})`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return room;
}

describe('mid-match departure safety', () => {
  it('submitting after the opponent left does not resolve into a null player', async () => {
    const room = await roomInSpell();
    room.removePlayer('p2'); // vacates the slot (forfeit ends the match)
    // The crash was an async unhandled rejection — fail the test if one fires.
    let rejection: unknown = null;
    const onRejection = (err: unknown) => { rejection = err; };
    process.once('unhandledRejection', onRejection);
    try {
      const res = room.submitWord('p1', 'CAT');
      // Phase already left SPELL via the forfeit, so the submit is rejected —
      // the point is that it must reject cleanly, not crash.
      assert.ok(res.error);
      await new Promise((r) => setTimeout(r, 100)); // let any bad resolve() blow up
      assert.equal(rejection, null, `unhandled rejection: ${rejection}`);
    } finally {
      process.removeListener('unhandledRejection', onRejection);
      room.dispose();
    }
  });

  it('leaving mid-match forfeits to the remaining player', async () => {
    const room = await roomInSpell();
    room.removePlayer('p2');
    const state = room.getState();
    assert.equal(state.phase, 'MATCH_END');
    assert.equal(state.matchWinner, 'p1');
    room.dispose();
  });

  it('leaving from the LOBBY does not fabricate a match result', () => {
    const room = new GameRoom('TEST2', noopCb);
    room.addPlayer('Ava', 'acc-a');
    room.addPlayer('Ben', 'acc-b');
    room.removePlayer('p2');
    const state = room.getState();
    assert.equal(state.phase, 'LOBBY');
    assert.equal(state.matchWinner, null);
    room.dispose();
  });
});
