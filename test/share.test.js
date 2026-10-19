'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isLocalUrl, lanAddresses, pickOllama } = require('../src/main/share');

test('local vs remote AI addresses', () => {
  assert.ok(isLocalUrl('http://127.0.0.1:11434'));
  assert.ok(isLocalUrl('http://localhost:11434/'));
  assert.ok(!isLocalUrl('http://192.168.1.23:11434'));
});

test('home-network addresses skip loopback, link-local and IPv6', () => {
  const ips = lanAddresses({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.23', internal: false }],
    bridge: [{ family: 'IPv4', address: '169.254.10.2', internal: false }],
  });
  assert.deepEqual(ips, ['192.168.1.23']);
});

test('falls back to this computer when the remote AI is unreachable', async () => {
  const up = { version: async () => '1' };
  const down = { version: async () => { throw new Error('offline'); } };
  assert.deepEqual(await pickOllama(up, down, 'http://192.168.1.23:11434'), { client: up, fallback: false });
  assert.deepEqual(await pickOllama(down, up, 'http://192.168.1.23:11434'), { client: up, fallback: true });
  const local = await pickOllama(down, up, 'http://127.0.0.1:11434');
  assert.equal(local.client, down, 'local URL is used as-is');
});
