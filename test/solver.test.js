'use strict';
// Runs the full read -> solve -> verify pipeline against a fake Ollama server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Ollama } = require('../src/main/ollama');
const { solve } = require('../src/main/solver');
const { DEFAULTS } = require('../src/shared/defaults');

function fakeOllama({ models, caps, reply }) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      const send = (o, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (req.url === '/api/tags') return send({ models: models.map((name) => ({ name, size: 1 })) });
      if (req.url === '/api/show') return send({ capabilities: caps[json.model] || ['completion'] });
      if (req.url === '/api/chat') {
        calls.push(json);
        const system = json.messages[0].content;
        const kind = system.includes('screen reader') ? 'read' : system.includes('checker') ? 'verify' : 'solve';
        const content = reply(kind, json, calls);
        return send({ message: { role: 'assistant', content } });
      }
      send({ error: 'not found' }, 404);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() })),
  );
}

const VISION = { 'qwen3-vl:8b': ['completion', 'vision'], 'gpt-oss:20b': ['completion', 'thinking', 'tools'] };
const READ = 'What is 15% of 240?\nTASK: compute the percentage\nLEGIBILITY: good';

test('careful mode: read, solve, verify agree -> high confidence', async () => {
  const srv = await fakeOllama({
    models: ['qwen3-vl:8b'],
    caps: VISION,
    reply: (kind) =>
      kind === 'read'
        ? READ
        : kind === 'solve'
          ? JSON.stringify({ answer: '36', choice: '', check: '0.15*240', confidence: 9, note: '0.15 x 240' })
          : JSON.stringify({ correct: true, answer: '36', choice: '', confidence: 9 }),
  });
  try {
    const statuses = [];
    const r = await solve({ image: 'AAAA', settings: { ...DEFAULTS }, ollama: new Ollama(srv.url), mode: 'careful', onStatus: (s) => statuses.push(s) });
    assert.equal(r.answer, '36');
    assert.equal(r.confidence, 10);
    assert.equal(r.math, 'pass');
    assert.equal(srv.calls.length, 3);
    assert.deepEqual(statuses, ['reading', 'solving', 'verifying']);
    assert.ok(srv.calls[0].messages[1].images, 'reader gets the image');
    assert.ok(srv.calls[1].format, 'non-thinking solver gets a JSON schema');
  } finally {
    srv.close();
  }
});

test('auto solver picks gpt-oss, sends text only, uses reasoning effort', async () => {
  const srv = await fakeOllama({
    models: ['qwen3-vl:8b', 'gpt-oss:20b'],
    caps: VISION,
    reply: (kind) =>
      kind === 'read' ? READ : JSON.stringify({ answer: '36', correct: true, choice: '', check: '', confidence: 8, note: '' }),
  });
  try {
    const r = await solve({ image: 'AAAA', settings: { ...DEFAULTS }, ollama: new Ollama(srv.url), mode: 'max' });
    assert.equal(r.models.solver, 'gpt-oss:20b');
    const solveCall = srv.calls[1];
    assert.equal(solveCall.model, 'gpt-oss:20b');
    assert.equal(solveCall.think, 'high');
    assert.equal(solveCall.format, undefined);
    assert.equal(solveCall.messages[1].images, undefined);
    assert.match(solveCall.messages[1].content, /15% of 240/);
    assert.equal(r.agreement, '3/3');
  } finally {
    srv.close();
  }
});

test('disagreement triggers a tie-break and lowers confidence', async () => {
  let solves = 0;
  const srv = await fakeOllama({
    models: ['qwen3-vl:8b'],
    caps: VISION,
    reply: (kind) => {
      if (kind === 'read') return READ;
      if (kind === 'verify') return JSON.stringify({ correct: false, answer: '35', choice: '', confidence: 7 });
      solves++;
      return JSON.stringify({ answer: '36', choice: '', check: '', confidence: 9, note: '' });
    },
  });
  try {
    const statuses = [];
    const r = await solve({ image: 'AAAA', settings: { ...DEFAULTS }, ollama: new Ollama(srv.url), mode: 'careful', onStatus: (s) => statuses.push(s) });
    assert.equal(r.answer, '36');
    assert.equal(solves, 2);
    assert.ok(statuses.includes('re-checking'));
    assert.ok(r.confidence <= 6);
    assert.equal(r.agreement, '2/3');
  } finally {
    srv.close();
  }
});

test('no vision model -> friendly error', async () => {
  const srv = await fakeOllama({ models: ['gpt-oss:20b'], caps: VISION, reply: () => '' });
  try {
    await assert.rejects(
      solve({ image: 'AAAA', settings: { ...DEFAULTS }, ollama: new Ollama(srv.url), mode: 'careful' }),
      /No vision model/,
    );
  } finally {
    srv.close();
  }
});

test('offline Ollama -> friendly error', async () => {
  await assert.rejects(
    solve({ image: 'AAAA', settings: { ...DEFAULTS }, ollama: new Ollama('http://127.0.0.1:1'), mode: 'careful' }),
    /Ollama isn't running/,
  );
});
