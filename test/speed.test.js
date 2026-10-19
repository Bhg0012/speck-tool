'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recommend } = require('../src/shared/speed');
const { buildDiagnostics } = require('../src/main/diagnostics');

test('fast machine: no changes suggested', () => {
  const r = recommend({ model: 'qwen3-vl:8b-instruct', mode: 'careful', fastS: 5, carefulS: 9, genTps: 40, correct: true });
  assert.equal(r.level, 'great');
  assert.deepEqual(r.actions, []);
});

test('CPU-only machine: explains why, offers smaller model + Fast mode', () => {
  const r = recommend({ model: 'qwen3-vl:8b-instruct', mode: 'careful', fastS: 140, carefulS: 200, genTps: 3.1, correct: true });
  assert.equal(r.level, 'slow');
  assert.match(r.text, /processor/);
  assert.match(r.text, /Mac as the AI server/);
  assert.match(r.text, /smaller model/);
  assert.deepEqual(r.actions.map((a) => a.value), ['qwen3-vl:4b-instruct', 'fast']);
});

test('diagnostics report names the GPU and shows per-step timing', () => {
  const text = buildDiagnostics({
    app: { version: '1.4.0', commit: 'abc1234' },
    system: { platform: 'win32', release: '10.0.26100', arch: 'x64', cpu: 'Intel Core i7', cores: 8, ramGb: 16, freeGb: 7 },
    gpu: { gpuDevice: [{ vendorId: 0x8086, deviceId: 0x46a6, active: true, driverVersion: '31.0' }] },
    ollama: { ok: true, version: '0.40.5', models: [{ name: 'qwen3-vl:8b-instruct', size: 6.1e9 }], running: [{ name: 'qwen3-vl:8b-instruct', size: 7e9, size_vram: 0, context_length: 4096 }] },
    settings: { ollamaUrl: 'http://127.0.0.1:11434', readerModel: 'qwen3-vl:8b-instruct', solverModel: 'reader', mode: 'careful' },
    asks: [{ at: 'now', mode: 'careful', totalMs: 151000, captureMs: 120, answer: 'C) 75', confidence: 10, calls: [{ step: 'first', loadS: 0, promptTokens: 1426, promptS: 75.3, genTokens: 183, genS: 58.5 }] }],
  });
  assert.match(text, /Intel/);
  assert.match(text, /0% in GPU memory/);
  assert.match(text, /read 1426 tok in 75.3s · write 183 tok in 58.5s \(3.1\/s\)/);
});
