import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareMoves } from '@app/shared';
import { resolveRound, BASE_COIN_SWING, STEAL_AMOUNT } from './RoundResolver.js';

const noPowerups = { p1: [] as string[], p2: [] as string[] };
const evenCoins = { p1: 100, p2: 100 };

describe('compareMoves (shared rules)', () => {
  it('rock beats scissors, loses to paper, ties rock', () => {
    assert.equal(compareMoves('rock', 'scissors'), 1);
    assert.equal(compareMoves('rock', 'paper'), -1);
    assert.equal(compareMoves('rock', 'rock'), 0);
  });
});

describe('resolveRound', () => {
  it('awards +/- base swing to winner/loser', () => {
    const out = resolveRound({
      moves: { p1: 'rock', p2: 'scissors' },
      twist: null,
      powerups: noPowerups,
      coins: evenCoins,
    });
    assert.equal(out.winner, 'p1');
    assert.equal(out.coinsDelta.p1, BASE_COIN_SWING);
    assert.equal(out.coinsDelta.p2, -BASE_COIN_SWING);
  });

  it('ties yield no coin change and no winner', () => {
    const out = resolveRound({
      moves: { p1: 'paper', p2: 'paper' },
      twist: null,
      powerups: noPowerups,
      coins: evenCoins,
    });
    assert.equal(out.winner, null);
    assert.deepEqual(out.coinsDelta, { p1: 0, p2: 0 });
  });

  it('a missing move forfeits to the present move', () => {
    const out = resolveRound({
      moves: { p1: null, p2: 'rock' },
      twist: null,
      powerups: noPowerups,
      coins: evenCoins,
    });
    assert.equal(out.winner, 'p2');
  });

  it('DOUBLE_STAKES doubles the swing', () => {
    const out = resolveRound({
      moves: { p1: 'scissors', p2: 'paper' },
      twist: 'DOUBLE_STAKES',
      powerups: noPowerups,
      coins: evenCoins,
    });
    assert.equal(out.winner, 'p1');
    assert.equal(out.coinsDelta.p1, BASE_COIN_SWING * 2);
  });

  it('tie_breaker powerup wins a tie for its owner and is not consumed (match-long)', () => {
    const out = resolveRound({
      moves: { p1: 'rock', p2: 'rock' },
      twist: null,
      powerups: { p1: ['tie_breaker'], p2: [] },
      coins: evenCoins,
    });
    assert.equal(out.winner, 'p1');
    assert.deepEqual(out.consumed.p1, []);
  });

  it('shield negates the loser loss but not the winner gain, and is consumed', () => {
    const out = resolveRound({
      moves: { p1: 'rock', p2: 'paper' }, // p2 wins
      twist: null,
      powerups: { p1: ['shield'], p2: [] },
      coins: evenCoins,
    });
    assert.equal(out.winner, 'p2');
    assert.equal(out.coinsDelta.p1, 0);
    assert.equal(out.coinsDelta.p2, BASE_COIN_SWING);
    assert.deepEqual(out.consumed.p1, ['shield']);
  });

  it('double_down doubles the winner swing and is consumed', () => {
    const out = resolveRound({
      moves: { p1: 'rock', p2: 'scissors' },
      twist: null,
      powerups: { p1: ['double_down'], p2: [] },
      coins: evenCoins,
    });
    assert.equal(out.coinsDelta.p1, BASE_COIN_SWING * 2);
    assert.deepEqual(out.consumed.p1, ['double_down']);
  });

  it('steal transfers extra coins from loser to winner', () => {
    const out = resolveRound({
      moves: { p1: 'rock', p2: 'scissors' },
      twist: null,
      powerups: { p1: ['steal'], p2: [] },
      coins: evenCoins,
    });
    assert.equal(out.coinsDelta.p1, BASE_COIN_SWING + STEAL_AMOUNT);
    assert.equal(out.coinsDelta.p2, -(BASE_COIN_SWING + STEAL_AMOUNT));
  });

  it('UNDERDOG_BOOST wins ties for the trailing player', () => {
    const out = resolveRound({
      moves: { p1: 'rock', p2: 'rock' },
      twist: 'UNDERDOG_BOOST',
      powerups: noPowerups,
      coins: { p1: 40, p2: 100 },
    });
    assert.equal(out.winner, 'p1');
  });

  it('SUDDEN_DEATH flags an immediate match end when there is a winner', () => {
    const out = resolveRound({
      moves: { p1: 'rock', p2: 'scissors' },
      twist: 'SUDDEN_DEATH',
      powerups: noPowerups,
      coins: evenCoins,
    });
    assert.equal(out.suddenDeath, true);
  });
});
