'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/main/calc');

const calc = (s, places) => C.format(C.evaluateExact(s), places);

test('exact arithmetic: no floating-point slips, money to the cent', () => {
  assert.equal(calc('0.1 + 0.2'), '0.3');
  assert.equal(calc('1250 * 18.40'), '23,000');
  assert.equal(calc('19.99 * 3'), '59.97');
  assert.equal(calc('1.15 * 100'), '115');
  assert.equal(calc('4.35 * 100'), '435');
  assert.equal(calc('1234567.89 + 0.11'), '1,234,568');
  assert.equal(calc('(84500 - 12350.75) * 0.21', 2), '15,151.34');
  assert.equal(calc('1/3'), '0.3333333333');
  assert.equal(calc('2/8'), '0.25');
  assert.equal(calc('2^10'), '1,024');
  assert.equal(calc('2^-2'), '0.25');
  assert.equal(calc('1.05^3'), '1.157625');
  assert.equal(calc('15% * 240'), '36');
  assert.equal(calc('$1,250.00 * 3'), '3,750');
  assert.equal(calc('5!'), '120');
  assert.equal(calc('20!'), '2,432,902,008,176,640,000');
});

test('rounding: half away from zero, like money', () => {
  assert.equal(calc('round(2.345, 2)'), '2.35');
  assert.equal(calc('round(-2.345, 2)'), '-2.35');
  assert.equal(calc('round(2.5)'), '3');
  assert.equal(calc('round(1234.5678, -2)'), '1,200');
  assert.equal(calc('1/8', 2), '0.13');
  assert.equal(calc('0.125', 2), '0.13');
  assert.equal(calc('-0.001', 2), '0.00');
  assert.equal(calc('floor(-2.5)'), '-3');
  assert.equal(calc('ceil(2.1)'), '3');
  assert.equal(calc('min(3, 1.5, 2)'), '1.5');
  assert.equal(calc('abs(-7.25)'), '7.25');
});

test('other functions fall back to floating point', () => {
  assert.equal(calc('sqrt(2.25)'), '1.5'); // perfect square stays exact
  assert.equal(calc('sqrt(2)'), '1.4142135624');
  assert.equal(calc('log(1000)'), '3');
  assert.equal(calc('2 * pi', 4), '6.2832');
  assert.equal(calc('1000 * (1 + 0.05/12)^(12*10)', 2), '1,647.01'); // compound interest
});

test('steps use earlier results by name, case-insensitively', () => {
  const steps = C.normalizeSteps([
    { name: 'Sales', expr: '1,200 * 45.50' },
    { name: 'COGS', expr: '1200 * 28.75' },
    { name: 'gross profit', expr: 'sales - cogs' },
    { name: 'margin', expr: 'gross_profit / sales * 100' },
    { name: 'bad', expr: '' },
  ]);
  assert.deepEqual(steps.map((s) => s.name), ['sales', 'cogs', 'gross_profit', 'margin']);
  const { values, errors } = C.runSteps(steps);
  assert.deepEqual(errors, []);
  assert.equal(C.format(values.gross_profit, 2), '20,100.00');
  assert.equal(C.format(values.margin, 1), '36.8');
});

test('answers, full answers and tables get the computed numbers', () => {
  const r = C.applySteps({
    answer: 'Gross profit ${gross:2}',
    full: 'a) {sales}\nb) {{gross}}',
    table: [['Item', 'Amount'], ['Sales', '{sales:2}'], ['Gross', '{gross:2}']],
    calc: C.normalizeSteps([
      { name: 'sales', expr: '1200*45.50' },
      { name: 'gross', expr: 'sales - 1200*28.75' },
    ]),
  });
  assert.equal(r.answer, 'Gross profit $20,100.00');
  assert.equal(r.full, 'a) 54,600\nb) 20,100');
  assert.deepEqual(r.table[2], ['Gross', '20,100.00']);
  assert.equal(r.math, 'pass');
  assert.equal(r.finalValue, 20100);
});

test('a broken step or unknown name shows "?" and fails the check (never a wrong number)', () => {
  const r = C.applySteps({ answer: '{total}', full: '', table: [], calc: [{ name: 'total', expr: 'cost / 0' }] });
  assert.equal(r.answer, '?');
  assert.equal(r.math, 'fail');
  const s = C.applySteps({ answer: '{missing}', full: '', table: [], calc: [{ name: 'a', expr: '2' }] });
  assert.equal(s.answer, '?');
  assert.equal(s.math, 'fail');
});

test('no steps and no placeholders: untouched', () => {
  const r = C.applySteps({ answer: 'Paris', full: '', table: [], calc: [] });
  assert.equal(r.answer, 'Paris');
  assert.equal(r.math, null);
});

test('rejects anything that is not arithmetic', () => {
  for (const bad of ['process.exit()', 'constructor', '__proto__', 'require("fs")', '2 +', '1/0', 'x']) {
    assert.throws(() => C.evaluateExact(bad), bad);
  }
  assert.throws(() => C.evaluateExact('toString', {}));
});

test('built-in object names are never callable or readable', () => {
  for (const bad of ['constructor(1)', 'toString(1)', 'hasOwnProperty(1)', '__proto__', 'valueOf', '__defineGetter__(1)']) {
    assert.throws(() => C.evaluateExact(bad), bad);
  }
  const r = C.applySteps({ answer: '{constructor} {__proto__}', full: '', table: [], calc: [{ name: 'a', expr: '1' }] });
  assert.equal(r.answer, '? ?');
});
