'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextDisplay, moveRegion, moveDot } = require('../src/main/monitors');

const laptop = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } };
const monitor = { id: 2, bounds: { x: 1512, y: -200, width: 2560, height: 1440 } };
const left = { id: 3, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };
const waLaptop = { x: 0, y: 38, width: 1512, height: 944 };
const waMonitor = { x: 1512, y: -175, width: 2560, height: 1415 };

test('next monitor goes left to right and wraps', () => {
  assert.equal(nextDisplay([laptop, monitor], 1).id, 2);
  assert.equal(nextDisplay([laptop, monitor], 2).id, 1);
  assert.equal(nextDisplay([monitor, laptop, left], 3).id, 1);
  assert.equal(nextDisplay([monitor, laptop, left], 2).id, 3);
});

test('capture area keeps its size and relative spot', () => {
  const r = { x: 100, y: 100, width: 400, height: 300 };
  const m = moveRegion(r, waLaptop, waMonitor);
  assert.equal(m.width, 400);
  assert.equal(m.height, 300);
  // centre at the same fraction of the work area
  const fx = (r.x + 200 - waLaptop.x) / waLaptop.width;
  assert.ok(Math.abs((m.x + 200 - waMonitor.x) / waMonitor.width - fx) < 0.001);
  // and back again lands where it started
  assert.deepEqual(moveRegion(m, waMonitor, waLaptop), r);
});

test('capture area stays fully on a smaller monitor', () => {
  const r = { x: 2000, y: 0, width: 2000, height: 1300 };
  const m = moveRegion(r, waMonitor, waLaptop);
  assert.ok(m.width <= waLaptop.width && m.height <= waLaptop.height);
  assert.ok(m.x >= waLaptop.x && m.x + m.width <= waLaptop.x + waLaptop.width);
  assert.ok(m.y >= waLaptop.y && m.y + m.height <= waLaptop.y + waLaptop.height);
});

test('dot keeps its distance from the nearest corner', () => {
  const size = 22;
  // bottom-right, 10 px in from each edge
  const p = { x: waLaptop.x + waLaptop.width - size - 10, y: waLaptop.y + waLaptop.height - size - 10 };
  assert.deepEqual(moveDot(p, size, waLaptop, waMonitor), {
    x: waMonitor.x + waMonitor.width - size - 10,
    y: waMonitor.y + waMonitor.height - size - 10,
  });
  // top-left, 40 px in
  assert.deepEqual(moveDot({ x: 40, y: 78 }, size, waLaptop, waMonitor), { x: waMonitor.x + 40, y: waMonitor.y + 40 });
});
