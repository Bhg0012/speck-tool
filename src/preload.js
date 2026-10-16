'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set(['drag:start', 'drag:end', 'dot:menu', 'bar:hover', 'bar:copy', 'bar:dismiss']);
const INVOKE = new Set([
  'settings:get',
  'settings:save',
  'ollama:status',
  'ollama:pull',
  'ollama:cancel-pull',
  'app:reset-area',
  'app:quit',
  'app:open',
]);
const ON = new Set(['appearance', 'bar', 'frame', 'pulse', 'busy', 'pull:progress']);

contextBridge.exposeInMainWorld('speck', {
  platform: process.platform,
  send: (channel, ...args) => {
    if (SEND.has(channel)) ipcRenderer.send(channel, ...args);
  },
  invoke: (channel, ...args) =>
    INVOKE.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error(`Blocked channel ${channel}`)),
  on: (channel, fn) => {
    if (!ON.has(channel)) return () => {};
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
