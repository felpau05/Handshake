import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideBattle, effectiveLength, normalizeWord } from '@app/shared';
import { judgeRound } from '../services/gemini/geminiClient.js';
import { resolveWordBattle } from './WordBattleResolver.js';

const outcome = (word: string, valid: boolean) => ({
  word,
  valid,
  length: effectiveLength(word, valid),
  complexity: 0,
  relatedness: 0,
  verdict: '',
});

describe('normalizeWord', () => {
  it('trims, lowercases, strips non-letters', () => {
    assert.equal(normalizeWord('  Rain! '), 'rain');
    assert.equal(normalizeWord('H2O'), 'ho');
  });
});

describe('effectiveLength', () => {
  it('is the letter count when valid, 0 when invalid', () => {
    assert.equal(effectiveLength('rain', true), 4);
    assert.equal(effectiveLength('rain', false), 0);
  });
});

describe('decideBattle', () => {
  it('the longer valid word wins', () => {
    const d = decideBattle(outcome('river', true), outcome('rain', true));
    assert.equal(d.winner, 'p1');
    assert.equal(d.tie, false);
  });

  it('an invalid word loses to a valid one regardless of raw length', () => {
    // p1 spelled a long nonsense word (invalid → length 0); p2 a short valid one.
    const d = decideBattle(outcome('qwerty', false), outcome('ice', true));
    assert.equal(d.winner, 'p2');
    assert.equal(d.tie, false);
  });

  it('equal valid lengths tie → sudden death', () => {
    const d = decideBattle(outcome('rain', true), outcome('lake', true));
    assert.equal(d.winner, null);
    assert.equal(d.tie, true);
  });

  it('both invalid tie → sudden death', () => {
    const d = decideBattle(outcome('zzz', false), outcome('qqq', false));
    assert.equal(d.winner, null);
    assert.equal(d.tie, true);
  });
});

// judgeRound has no GEMINI_API_KEY in this test environment (server/.env),
// so these exercise its deterministic offline stub — no network involved.
describe('judgeRound (offline stub)', () => {
  it('the longer valid word wins, and both players get a scored judgment', async () => {
    const j = await judgeRound('water', { p1: 'river', p2: 'rain' });
    assert.equal(j.roundWinner, 'p1');
    assert.equal(j.player1.valid, true);
    assert.equal(j.player2.valid, true);
    assert.ok(j.narration.length > 0);
  });

  it('an invalid (too-short) word loses to a valid one regardless of raw length', () => {
    return judgeRound('ocean', { p1: 'a', p2: 'ice' }).then((j) => {
      assert.equal(j.player1.valid, false);
      assert.equal(j.player1.complexity, 0);
      assert.equal(j.roundWinner, 'p2');
    });
  });

  it('equal valid lengths tie → null roundWinner (sudden death)', async () => {
    const j = await judgeRound('water', { p1: 'rain', p2: 'lake' });
    assert.equal(j.roundWinner, null);
  });

  it('both invalid tie → null roundWinner', async () => {
    const j = await judgeRound('water', { p1: 'z', p2: 'q' });
    assert.equal(j.roundWinner, null);
  });
});

describe('resolveWordBattle', () => {
  it('reshapes the judgment into WordOutcome, preserving winner + narration', async () => {
    const { winner, tie, outcomes, narration } = await resolveWordBattle({
      prompt: 'fire',
      words: { p1: 'Blaze!', p2: 'hot' },
    });
    assert.equal(winner, 'p1');
    assert.equal(tie, false);
    assert.equal(outcomes.p1.word, 'blaze'); // normalized: lowercase, letters only
    assert.ok(outcomes.p1.length > outcomes.p2.length);
    assert.ok(narration.length > 0);
  });

  it('a null/missing word normalizes to empty and is invalid', async () => {
    const { outcomes } = await resolveWordBattle({
      prompt: 'fire',
      words: { p1: null, p2: 'spark' },
    });
    assert.equal(outcomes.p1.word, '');
    assert.equal(outcomes.p1.valid, false);
  });
});
