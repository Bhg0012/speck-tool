'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/main/mathcheck');

test('basic arithmetic and precedence', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('2^-1'), 0.5);
  assert.equal(evaluate('10 / 4'), 2.5);
});

test('functions, constants, percent, factorial', () => {
  assert.equal(evaluate('sqrt(16) + abs(-2)'), 6);
  assert.ok(Math.abs(evaluate('2*pi') - 2 * Math.PI) < 1e-12);
  assert.equal(evaluate('15% * 240'), 36);
  assert.equal(evaluate('5!'), 120);
  assert.equal(evaluate('log(1000)'), 3);
  assert.equal(evaluate('log(8, 2)'), 3);
});

test('unicode operators and thousands separators', () => {
  assert.equal(evaluate('3 × 4 ÷ 2'), 6);
  assert.equal(evaluate('1,200 − 200'), 1000);
  assert.equal(evaluate('√9'), 3);
});

test('equations: evaluates the side that is not a bare variable', () => {
  assert.equal(evaluate('x = 3*4'), 12);
  assert.equal(evaluate('3*4 = 12'), 12);
});

test('rejects anything unsafe or invalid', () => {
  assert.equal(evaluate('process.exit()'), null);
  assert.equal(evaluate('2 +'), null);
  assert.equal(evaluate('1/0'), null);
  assert.equal(evaluate(''), null);
  assert.equal(evaluate('constructor'), null);
});
