'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/main/answer');

test('parseJsonLoose handles fences, prose and nesting', () => {
  assert.deepEqual(A.parseJsonLoose('{"answer":"4"}'), { answer: '4' });
  assert.deepEqual(A.parseJsonLoose('```json\n{"answer":"4"}\n```'), { answer: '4' });
  assert.deepEqual(A.parseJsonLoose('Sure! {"answer":"a } b","x":{"y":1}} done'), { answer: 'a } b', x: { y: 1 } });
  assert.equal(A.parseJsonLoose('no json here'), null);
});

test('normalizeResult cleans fields and falls back to raw text', () => {
  const r = A.normalizeResult({ answer: ' 42 ', choice: '(b)', confidence: 14, note: 'x' });
  assert.equal(r.answer, '42');
  assert.equal(r.choice, 'B');
  assert.equal(r.confidence, 10);
  const f = A.normalizeResult(null, '\n  Paris  \nbecause...');
  assert.equal(f.answer, 'Paris');
  assert.equal(f.confidence, 3);
  assert.equal(A.normalizeResult({ answer: 'x', choice: 'c, a' }).choice, 'A,C');
});

test('extractNumber', () => {
  assert.equal(A.extractNumber('x = 4').value, 4);
  assert.equal(A.extractNumber('$1,200').value, 1200);
  assert.equal(A.extractNumber('3/4').value, 0.75);
  assert.equal(A.extractNumber('12 cm').value, 12);
  assert.ok(A.extractNumber('45%').percent);
  assert.equal(A.extractNumber('B) 42').value, 42);
  assert.equal(A.extractNumber('2x'), null);
  assert.equal(A.extractNumber('x^2'), null);
  assert.equal(A.extractNumber('x = 4 or x = -1'), null);
  assert.equal(A.extractNumber('Paris'), null);
});

test('answersEquivalent', () => {
  const eq = (a, b) => A.answersEquivalent(a, b);
  assert.ok(eq({ answer: '42' }, { answer: '42.0' }));
  assert.ok(eq({ answer: 'x = 4' }, { answer: '4' }));
  assert.ok(eq({ answer: '3.14' }, { answer: '3.14159' }));
  assert.ok(eq({ answer: '1/3' }, { answer: '0.333' }));
  assert.ok(!eq({ answer: '3.1' }, { answer: '3.2' }));
  assert.ok(eq({ answer: 'B) 42', choice: 'B' }, { answer: 'B', choice: 'B' }));
  assert.ok(!eq({ answer: 'B) 42', choice: 'B' }, { answer: 'C) 42', choice: 'C' }));
  assert.ok(eq({ answer: 'B) Paris' }, { answer: 'b. Paris' }));
  assert.ok(eq({ answer: 'The answer is Paris.' }, { answer: 'paris' }));
  assert.ok(!eq({ answer: 'Paris' }, { answer: 'London' }));
  assert.ok(!eq({ answer: '' }, { answer: '' }));
});

test('tally groups equivalent answers, largest first', () => {
  const g = A.tally([
    { answer: '5', confidence: 9 },
    { answer: '6', confidence: 9 },
    { answer: '5.0', confidence: 7 },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].members.length, 2);
  assert.equal(g[0].members[0].answer, '5');
});

test('mathCheck', () => {
  assert.equal(A.mathCheck({ answer: '36', check: '0.15*240' }), 'pass');
  assert.equal(A.mathCheck({ answer: '35', check: '0.15*240' }), 'fail');
  assert.equal(A.mathCheck({ answer: '15%', check: '36/240' }), 'pass');
  assert.equal(A.mathCheck({ answer: 'Paris', check: '' }), null);
  assert.equal(A.mathCheck({ answer: '36', check: 'nonsense(' }), null);
});

test('scoreConfidence rewards agreement and punishes doubt', () => {
  const groups = (...sizes) => sizes.map((n, i) => ({ members: Array.from({ length: n }, () => ({ answer: String(i), confidence: 9 })) }));
  assert.equal(A.scoreConfidence({ groups: groups(1), total: 1 }), 8); // single pass is capped
  assert.equal(A.scoreConfidence({ groups: groups(1), total: 1, math: 'pass' }), 9);
  assert.equal(A.scoreConfidence({ groups: groups(2), total: 2 }), 10);
  assert.equal(A.scoreConfidence({ groups: groups(2, 1), total: 3 }), 6);
  assert.equal(A.scoreConfidence({ groups: groups(1, 1, 1), total: 3 }), 3);
  assert.equal(A.scoreConfidence({ groups: groups(2), total: 2, math: 'fail' }), 4);
  assert.equal(A.scoreConfidence({ groups: groups(2), total: 2, legibility: 'partial' }), 7);
  assert.equal(A.scoreConfidence({ groups: [], total: 0 }), 1);
});

test('parseReader', () => {
  const r = A.parseReader('What is 2+2?\nA) 3 B) 4\nTASK: pick the sum\nLEGIBILITY: Partial');
  assert.equal(r.task, 'pick the sum');
  assert.equal(r.legibility, 'partial');
  assert.equal(A.parseReader('hello').legibility, 'good');
});
