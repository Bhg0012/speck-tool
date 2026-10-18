'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History, entryText } = require('../src/main/history');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'speck-hist-')), 'history.json');

test('keeps only the newest 30, newest first, and persists', () => {
  const file = tmpFile();
  const h = new History(file);
  for (let i = 1; i <= 35; i++) h.add({ question: `Q${i}`, answer: `A${i}`, confidence: 9 });
  assert.equal(h.list().length, 30);
  assert.equal(h.list()[0].answer, 'A35');
  assert.equal(h.list()[29].answer, 'A6');
  const again = new History(file);
  assert.equal(again.list().length, 30);
  assert.equal(again.list()[0].question, 'Q35');
  assert.ok(fs.statSync(file).size < 10 * 1024, '30 entries stay tiny');
});

test('clear empties it; a corrupt file starts fresh', () => {
  const file = tmpFile();
  const h = new History(file);
  h.add({ question: 'q', answer: 'a' });
  h.clear();
  assert.equal(new History(file).list().length, 0);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(new History(file).list(), []);
});

test('copy text includes the whole question and answer', () => {
  assert.equal(entryText({ question: 'What is 2+2?', answer: '4', confidence: 10 }), 'Question: What is 2+2?\nAnswer: 4 (10/10)');
  assert.equal(entryText({ question: '', answer: 'Paris' }), 'Answer: Paris');
});
