import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideBattle, effectiveLength, normalizeWord } from '@app/shared';

const outcome = (word: string, valid: boolean) => ({
  word,
  valid,
  length: effectiveLength(word, valid),
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
