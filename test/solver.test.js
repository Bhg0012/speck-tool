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

test('careful keeps solving until two attempts agree, telling it which numbers were left out', async () => {
  const q = 'Sales $84,750, COGS $51,238, operating expenses $18,945, interest $1,275, tax 21%. Net income?';
  const forgot = [
    { name: 'op', expr: '84750 - 51238 - 18945' },
    { name: 'net', expr: 'op - op * 0.21' },
  ];
  const right = [
    { name: 'ebt', expr: '84750 - 51238 - 18945 - 1275' },
    { name: 'net', expr: 'ebt * (1 - 0.21)' },
  ];
  const wrongTax = [{ name: 'net', expr: '84750 - 51238 - 18945 - 1275' }];
  const plan = [forgot, right, wrongTax, right]; // 1st, 2nd, 3rd, 4th call
  let n = 0;
  const reply = () => ans('${net:2}', { question: q, calc: plan[n++] });
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply });
  try {
    const r = await run(srv.url, 'careful');
    assert.equal(srv.calls.length, 4, 'three different answers -> a fourth attempt');
    assert.match(srv.calls[2].messages[1].content, /never used 1275/);
    assert.equal(r.answer, '$10,500.68');
    assert.equal(r.agreement, '2/4');
    assert.ok(r.confidence <= 5 && r.confidence >= 4);
  } finally {
    srv.close();
  }
});

test('careful stops after 4 attempts even without agreement, with low confidence', async () => {
  let n = 0;
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans(String(100 + n++)) });
  try {
    const r = await run(srv.url, 'careful');
    assert.equal(srv.calls.length, 4);
    assert.ok(r.confidence <= 3);
  } finally {
    srv.close();
  }
});

test('max wants three agreeing attempts', async () => {
  const answers = ['36', '35', '36', '36'];
  let n = 0;
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans(answers[n++]) });
  try {
    const r = await run(srv.url, 'max');
    assert.equal(srv.calls.length, 4);
    assert.equal(r.agreement, '3/4');
    assert.equal(r.answer, '36');
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

test('a table to fill in comes back as a table; multiple choice never does', async () => {
  const table = [['x', 'y'], ['1', '3'], ['2', '5']];
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans('Table completed', { table, full: '' }) });
  try {
    const r = await run(srv.url, 'careful');
    assert.deepEqual(r.table, table);
    assert.equal(r.full, '');
    assert.equal(r.agreement, '2/2');
    assert.ok(srv.calls[0].format.required.includes('table'), 'the model is asked for the table');
  } finally {
    srv.close();
  }
  const mc = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans('B) 42', { choice: 'B', table, full: 'x' }) });
  try {
    const r = await run(mc.url, 'fast');
    assert.equal(r.answer, 'B) 42');
    assert.deepEqual(r.table, []);
    assert.equal(r.full, '');
  } finally {
    mc.close();
  }
});

test('a long answer without a full version is still shown on hover', async () => {
  const long = 'First, the mitochondria produce ATP through cellular respiration, which powers most of the cell.';
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans(long) });
  try {
    const r = await run(srv.url, 'fast');
    assert.equal(r.full, long);
  } finally {
    srv.close();
  }
});

test('a one-line "full" answer still shows directly', async () => {
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply: () => ans('5', { full: 'x = 5' }) });
  try {
    const r = await run(srv.url, 'fast');
    assert.equal(r.answer, '5');
    assert.equal(r.full, '');
  } finally {
    srv.close();
  }
});

test('the model never does the arithmetic: Speck computes its steps exactly', async () => {
  // Both attempts set up the right calculation; the "work" mental math is wrong and is ignored.
  const reply = () =>
    ans('Net income ${net:2}', {
      work: 'revenue minus expenses = 31,000 (wrong mental math)',
      calc: [
        { name: 'revenue', expr: '1,250 * 48.60' },
        { name: 'expenses', expr: '18,420.75 + 9,315.40 + 0.1 + 0.2' },
        { name: 'net', expr: 'revenue - expenses' },
      ],
    });
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply });
  try {
    const r = await run(srv.url, 'careful');
    assert.equal(r.answer, 'Net income $33,013.55');
    assert.equal(r.math, 'pass');
    assert.equal(r.confidence, 10);
    assert.ok(srv.calls[0].format.required.includes('calc'), 'the model is asked for calculation steps');
  } finally {
    srv.close();
  }
});

test('one asked-for number still shows directly even if the model lists its steps', async () => {
  const reply = () =>
    ans('{net:2}', {
      full: 'gross: {gross}\nnet: {net:2}',
      calc: [
        { name: 'gross', expr: '84750 - 51238' },
        { name: 'net', expr: '(gross - 18945 - 1275) * (1 - 0.21)' },
      ],
    });
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply });
  try {
    const r = await run(srv.url, 'fast');
    assert.equal(r.answer, '10,500.68');
    assert.equal(r.full, '');
  } finally {
    srv.close();
  }
});

test('attempts that agree on the answer agree, even if each listed its working differently', async () => {
  const calc = [
    { name: 'subtotal', expr: '37 * 24.95 + 112 * 8.49 + 9 * 149.99' },
    { name: 'total', expr: 'subtotal * 1.0725' },
  ];
  const workings = ['subtotal: 3223.94\ntotal: 3457.68', 'subtotal: 3,224\ntotal: 3,457.67'];
  let n = 0;
  const reply = () => ans('${total:2}', { calc, full: workings[n++ % 2] });
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply });
  try {
    const r = await run(srv.url, 'careful');
    assert.equal(r.answer, '$3,457.68');
    assert.equal(r.agreement, '2/2');
    assert.equal(r.math, 'pass');
    assert.equal(r.confidence, 10);
  } finally {
    srv.close();
  }
});

test('multiple choice: a wrong letter is corrected by the exact calculation', async () => {
  const q = 'Total cost of 12 items at $14.75? A) $165.00 B) $177.00 C) $187.50 D) $170.25';
  const reply = () => ans('A) $165.00', { question: q, choice: 'A', calc: [{ name: 'total', expr: '12 * 14.75' }] });
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply });
  try {
    const r = await run(srv.url, 'careful');
    assert.equal(r.answer, 'B) $177.00');
    assert.equal(r.choice, 'B');
    assert.match(r.note, /exact calculation/);
  } finally {
    srv.close();
  }
});

test('a calculation that breaks never shows a confident number', async () => {
  const reply = () => ans('{total}', { calc: [{ name: 'total', expr: 'price * qty' }] });
  const srv = await fakeOllama({ models: ['qwen3-vl:8b-instruct'], caps: CAPS, reply });
  try {
    const r = await run(srv.url, 'fast');
    assert.equal(r.answer, '?');
    assert.ok(r.confidence <= 4);
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
