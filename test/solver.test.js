'use strict';
// Runs the full answer pipeline against a fake Ollama server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Ollama } = require('../src/main/ollama');
const { solve, NUM_CTX } = require('../src/main/solver');
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
        const user = json.messages[1].content;
        const kind = system.startsWith('You transcribe') ? 'read' : /disagreed/.test(user) ? 'tiebreak' : /independently/.test(user) ? 'second' : 'first';
        return send({ message: { role: 'assistant', content: reply(kind, json) } });
      }
      send({ error: 'not found' }, 404);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() })),
  );
}

const CAPS = {
  'qwen3-vl:8b-instruct': ['completion', 'vision'],
  'qwen3-vl:8b': ['completion', 'vision', 'thinking'],
  'gpt-oss:20b': ['completion', 'thinking'],
};
const ans = (answer, extra = {}) => JSON.stringify({ question: 'q', work: 'w', answer, choice: '', check: '', confidence: 9, note: '', ...extra });
const run = (url, mode, settings = {}) => solve({ image: 'AAAA', settings: { ...DEFAULTS, ...settings }, ollama: new Ollama(url), mode });

test('careful: two agreeing attempts -> one answer, high confidence, consistent context', async () => {
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans('36', { check: '0.15*240' }) });
  try {
    const r = await run(srv.url, 'careful');
    assert.equal(r.answer, '36');
    assert.equal(r.question, 'q', 'question text is passed on for history');
    assert.equal(r.confidence, 10);
    assert.equal(r.agreement, '2/2');
    assert.equal(srv.calls.length, 2);
    for (const c of srv.calls) {
      assert.equal(c.options.num_ctx, NUM_CTX, 'same num_ctx on every call (no model reloads)');
      assert.equal(c.think, undefined, 'no thinking flag for instruct models');
      assert.ok(c.format, 'JSON schema for non-thinking models');
      assert.deepEqual(c.messages[1].images, ['AAAA']);
    }
    assert.equal(srv.calls[0].messages[0].content, srv.calls[1].messages[0].content, 'same system prompt so the image is reused');
  } finally {
    srv.close();
  }
});

test('fast: a single attempt', async () => {
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans('Paris') });
  try {
    const r = await run(srv.url, 'fast');
    assert.equal(r.answer, 'Paris');
    assert.equal(srv.calls.length, 1);
    assert.ok(r.confidence <= 8);
  } finally {
    srv.close();
  }
});

test('disagreement triggers a tie-break and lowers confidence', async () => {
  const srv = await fakeOllama({
    models: ['qwen3-vl:8b-instruct'],
    caps: CAPS,
    reply: (kind) => ans(kind === 'second' ? '35' : '36'),
  });
  try {
    const r = await run(srv.url, 'careful');
    assert.equal(srv.calls.length, 3);
    assert.match(srv.calls[2].messages[1].content, /"36" vs "35"/);
    assert.equal(r.answer, '36');
    assert.equal(r.agreement, '2/3');
    assert.ok(r.confidence <= 6);
  } finally {
    srv.close();
  }
});

test('max: three attempts, tie-break only without a majority', async () => {
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans('B) 42', { choice: 'B' }) });
  try {
    const r = await run(srv.url, 'max');
    assert.equal(srv.calls.length, 3);
    assert.equal(r.agreement, '3/3');
    assert.equal(r.answer, 'B) 42');
  } finally {
    srv.close();
  }
});

test('multiple choice answers always show the letter', async () => {
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans('75', { choice: 'C' }) });
  try {
    assert.equal((await run(srv.url, 'careful')).answer, 'C) 75');
  } finally {
    srv.close();
  }
});

test('old thinking model setting still works and turns thinking off', async () => {
  const srv = await fakeOllama({ models: ['qwen3-vl:8b'], caps: CAPS, reply: () => ans('7') });
  try {
    const r = await run(srv.url, 'fast', { readerModel: 'qwen3-vl:8b' });
    assert.equal(r.answer, '7');
    assert.equal(srv.calls[0].think, false);
  } finally {
    srv.close();
  }
});

test('text-only solver: vision model transcribes first, solver gets text only', async () => {
  const srv = await fakeOllama({
    models: ['qwen3-vl:8b-instruct', 'gpt-oss:20b'],
    caps: CAPS,
    reply: (kind) => (kind === 'read' ? 'What is 6*7?\nLEGIBILITY: good' : ans('42')),
  });
  try {
    const r = await run(srv.url, 'careful', { solverModel: 'gpt-oss:20b' });
    assert.equal(r.answer, '42');
    assert.equal(srv.calls[0].model, 'qwen3-vl:8b-instruct');
    assert.equal(srv.calls[1].model, 'gpt-oss:20b');
    assert.equal(srv.calls[1].think, 'medium');
    assert.equal(srv.calls[1].messages[1].images, undefined);
    assert.match(srv.calls[1].messages[1].content, /6\*7/);
  } finally {
    srv.close();
  }
});

test('no vision model -> friendly error', async () => {
  const srv = await fakeOllama({ models: ['gpt-oss:20b'], caps: CAPS, reply: () => '' });
  try {
    await assert.rejects(run(srv.url, 'careful'), /No vision model/);
  } finally {
    srv.close();
  }
});

test('offline Ollama -> friendly error', async () => {
  await assert.rejects(run('http://127.0.0.1:1', 'careful'), /Ollama isn't running/);
});

test('settings from older versions move to the fast instruct model', () => {
  const { migrate } = require('../src/shared/defaults');
  const m = migrate({ readerModel: 'qwen3-vl:8b', solverModel: 'auto', keepAlive: '30m', appearance: { showStatus: true } });
  assert.equal(m.readerModel, 'qwen3-vl:8b-instruct');
  assert.equal(m.solverModel, 'reader');
  assert.equal(m.keepAlive, '2h');
  assert.equal(m.appearance.showStatus, undefined);
  assert.equal(migrate({ configVersion: 2, readerModel: 'qwen3-vl:8b' }).readerModel, 'qwen3-vl:8b', 'explicit choice kept after v2');
  assert.equal(migrate({ configVersion: 2, readerModel: 'qwen3-vl:8b' }).modelAuto, false);
});
