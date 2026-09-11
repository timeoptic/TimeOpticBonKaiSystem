import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPairPrice, pairPrice } from '../pricing.js';

test('splitPairPrice: even amount splits into two equal halves', () => {
  assert.deepEqual(splitPairPrice(4000), { od: 2000, os: 2000 });
});

test('splitPairPrice: odd amount keeps the sum exact with .50 halves', () => {
  const { od, os } = splitPairPrice(4001);
  assert.deepEqual({ od, os }, { od: 2000.5, os: 2000.5 });
  assert.equal(od + os, 4001);
});

test('splitPairPrice: rounds to 2dp so the value fits decimal(10,2)', () => {
  assert.deepEqual(splitPairPrice(999.99), { od: 500, os: 499.99 });
});

test('splitPairPrice: blank, null and negatives read as zero', () => {
  assert.deepEqual(splitPairPrice(''), { od: 0, os: 0 });
  assert.deepEqual(splitPairPrice(null), { od: 0, os: 0 });
  assert.deepEqual(splitPairPrice('abc'), { od: 0, os: 0 });
  assert.deepEqual(splitPairPrice(-100), { od: 0, os: 0 });
});

test('splitPairPrice: accepts the string an <input type=number> hands back', () => {
  assert.deepEqual(splitPairPrice('4000'), { od: 2000, os: 2000 });
});

test('pairPrice: the pair shown is always the sum of the two sides', () => {
  assert.equal(pairPrice(2000, 2000), 4000);
  assert.equal(pairPrice('2500', '1500'), 4000);
  assert.equal(pairPrice(null, 1500), 1500);
  assert.equal(pairPrice('', ''), 0);
});

test('pairPrice: sum of a split round-trips back to the pair typed in', () => {
  for (const v of [4000, 4001, 999.99, 1, 0.01]) {
    const { od, os } = splitPairPrice(v);
    assert.equal(pairPrice(od, os), v);
  }
});
