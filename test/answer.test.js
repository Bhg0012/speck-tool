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

test('tables are tidied into equal-width rows; non-tables become []', () => {
  assert.deepEqual(A.normalizeTable([['x', 'y'], ['1'], ['2', 4]]), [['x', 'y'], ['1', ''], ['2', '4']]);
  assert.deepEqual(A.normalizeTable([['only a header']]), []);
  assert.deepEqual(A.normalizeTable('not a table'), []);
  assert.deepEqual(A.normalizeTable([['', ''], ['', '']]), []);
  const r = A.normalizeResult({ answer: 'Table filled', table: [['x', 'y'], ['1', '3']], full: ' a) 12 \n\n\n b)  30 ' });
  assert.deepEqual(r.table, [['x', 'y'], ['1', '3']]);
  assert.equal(r.full, 'a) 12\n\nb) 30');
});

test('tables agree when their numbers match in order, not by their summaries', () => {
  const t = (rows, answer = 'Completed table') => ({ answer, table: rows });
  const a = t([['x', 'y = 2x + 1'], ['1', '3'], ['2', '5'], ['3', '7']]);
  const same = t([['x', 'y=2x+1'], ['1', '3.0'], ['2', '5'], ['3', '7']], 'All values filled');
  const wrong = t([['x', 'y = 2x + 1'], ['1', '3'], ['2', '5'], ['3', '8']]);
  assert.ok(A.answersEquivalent(a, same));
  assert.ok(!A.answersEquivalent(a, wrong), 'same summary, different cell -> disagree');
  assert.equal(A.tally([a, same, wrong])[0].members.length, 2);
});

test('multi-part answers agree by their numbers; written ones fall back to the summary', () => {
  assert.ok(A.answersEquivalent({ answer: 'a) 12, b) 30', full: 'a) 12 cm\nb) 30 cm' }, { answer: '12 and 30', full: 'a) 12cm\nb) 30 cm' }));
  assert.ok(!A.answersEquivalent({ answer: 'x', full: 'a) 12\nb) 30' }, { answer: 'x', full: 'a) 12\nb) 31' }));
  assert.ok(A.answersEquivalent({ answer: 'Photosynthesis', full: 'Plants make sugar from light.' }, { answer: 'photosynthesis', full: 'Light energy is turned into glucose by plants.' }));
});

test('copying gives a table as tab-separated rows, else the full or short answer', () => {
  assert.equal(A.answerText({ answer: 'done', table: [['x', 'y'], ['1', '3']] }), 'x\ty\n1\t3');
  assert.equal(A.answerText({ answer: 'a) 12', full: 'a) 12\nb) 30', table: [] }), 'a) 12\nb) 30');
  assert.equal(A.answerText({ answer: '42' }), '42');
});

test('answer options are read from the question text', () => {
  assert.deepEqual(A.optionsFrom('What is 15% of 240? A) 30 B) 36 C) 40 D) 24'), { A: '30', B: '36', C: '40', D: '24' });
  assert.deepEqual(A.optionsFrom('(a) $1,250.00 (b) $1,520.00 (c) None'), { A: '$1,250.00', B: '$1,520.00', C: 'None' });
  assert.deepEqual(A.optionsFrom('No options here.'), {});
});

test('multiple choice is picked by the exact result', () => {
  const q = 'Net income? A) $1,250.00 B) $1,520.00 C) $2,150.00 D) $1,502.00';
  // the model picked A, but its own exact calculation gives 1,520 -> B
  const fixed = A.checkChoice({ choice: 'A', answer: 'A) $1,250.00', finalValue: 1520, math: 'pass' }, q);
  assert.equal(fixed.choice, 'B');
  assert.equal(fixed.answer, 'B) $1,520.00');
  // matches the model's pick: unchanged
  assert.equal(A.checkChoice({ choice: 'B', answer: 'B) $1,520.00', finalValue: 1520, math: 'pass' }, q).answer, 'B) $1,520.00');
  // matches nothing: flagged, which lowers confidence
  assert.equal(A.checkChoice({ choice: 'B', answer: 'B', finalValue: 1600, math: 'pass' }, q).math, 'nomatch');
  // percent options
  assert.equal(A.checkChoice({ choice: 'A', answer: 'A', finalValue: 0.25 }, 'Rate? A) 20% B) 25% C) 30%').choice, 'B');
  // options rounded to whole numbers still match
  assert.equal(A.checkChoice({ choice: 'C', answer: 'C', finalValue: 36.8131 }, 'Margin? A) 35 B) 37 C) 40').choice, 'B');
});

test('an exact result that matches no option caps confidence at 5', () => {
  const g = [{ members: [{ confidence: 9 }, { confidence: 9 }] }];
  assert.equal(A.scoreConfidence({ groups: g, total: 2, math: 'pass' }), 10);
  assert.equal(A.scoreConfidence({ groups: g, total: 2, math: 'nomatch' }), 5);
  assert.equal(A.scoreConfidence({ groups: g, total: 2, math: 'fail' }), 4);
  assert.equal(A.scoreConfidence({ groups: g, total: 2, math: 'unverified' }), 6);
});

test('a "full" answer that only lists the calculation steps is recognised', () => {
  const steps = [{ name: 'gross_profit' }, { name: 'net_income' }];
  assert.ok(A.stepsEcho('gross_profit: 33,512\nNet income: 10,500.68', steps));
  assert.ok(!A.stepsEcho('a) Perimeter: 26 cm\nb) Area: 40 cm²', [{ name: 'perimeter' }, { name: 'area' }]));
  assert.ok(!A.stepsEcho('gross_profit: 33,512', steps), 'one line is not a list');
});

test('numbers from the question that no calculation uses are found (not options, not percents used as fractions)', () => {
  const q = 'Sales $84,750; COGS $51,238; operating expenses $18,945; interest expense $1,275; tax rate 21%.';
  const steps = [
    { name: 'op', expr: '84750 - 51238 - 18945' },
    { name: 'tax', expr: 'op * 0.21' },
  ];
  assert.deepEqual(A.unusedGivens(q, steps), [1275]);
  assert.deepEqual(A.unusedGivens('Bought 1,250 at $18.40 and 875 at $19.15. Average? A) $18.71 B) $18.78', [{ name: 'a', expr: '(1250*18.40+875*19.15)/(1250+875)' }]), []);
  assert.deepEqual(A.unusedGivens(q, []), []);
});

test('ties go to the attempt that left out fewer of the question\'s numbers', () => {
  const g = A.tally([
    { answer: '11,775.68', confidence: 9, unused: [1275] },
    { answer: '10,500.68', confidence: 7, unused: [] },
  ]);
  assert.equal(g[0].members[0].answer, '10,500.68');
});

test('answers with several numbers agree when the numbers match, whatever the labels', () => {
  assert.ok(A.answersEquivalent({ answer: '26 cm, 40 cm²', full: 'a) 26 cm\nb) 40 cm²' }, { answer: 'a) 26 cm, b) 40 cm²', full: '' }));
  assert.ok(!A.answersEquivalent({ answer: '26 cm, 40 cm²' }, { answer: '26 cm, 42 cm²' }));
});
