'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNvidiaSmi, pickModel, detectGpu } = require('../src/shared/hardware');
const { migrate } = require('../src/shared/defaults');

test('reads nvidia-smi output', () => {
  assert.deepEqual(parseNvidiaSmi('NVIDIA GeForce RTX 3050 Ti Laptop GPU, 4096\r\n'), [{ name: 'NVIDIA GeForce RTX 3050 Ti Laptop GPU', vramGb: 4 }]);
  assert.deepEqual(parseNvidiaSmi('garbage'), []);
});

test('picks the biggest model that fits the graphics card', () => {
  assert.equal(pickModel({ kind: 'nvidia', vramGb: 4 }), 'qwen3-vl:4b-instruct'); // Bruce's Surface Laptop Studio
  assert.equal(pickModel({ kind: 'nvidia', vramGb: 8 }), 'qwen3-vl:8b-instruct');
  assert.equal(pickModel({ kind: 'nvidia', vramGb: 2 }), 'qwen3-vl:2b-instruct');
  assert.equal(pickModel({ kind: 'apple', vramGb: 16 }), 'qwen3-vl:8b-instruct');
  assert.equal(pickModel({ kind: 'none', vramGb: 0 }), 'qwen3-vl:4b-instruct');
  assert.equal(detectGpu({ SPECK_FAKE_GPU: 'nvidia:4' }).vramGb, 4);
});

test('auto model stays on unless a model was picked by hand', () => {
  assert.equal(migrate({ configVersion: 2, readerModel: 'qwen3-vl:8b-instruct' }).modelAuto, true);
  assert.equal(migrate({ configVersion: 2, readerModel: 'gemma3:12b' }).modelAuto, false);
  assert.equal(migrate({}).modelAuto, true);
});
