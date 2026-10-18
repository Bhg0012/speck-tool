'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shortcutScript, shortcutPaths, ensureShortcuts } = require('../scripts/shortcut');

const root = "C:\\Users\\Bruce O'Neil\\speck-tool";
const env = { APPDATA: "C:\\Users\\Bruce O'Neil\\AppData\\Roaming" };

test('shortcuts go in the Speck folder and the Start Menu', () => {
  assert.deepEqual(shortcutPaths(root, env), [
    "C:\\Users\\Bruce O'Neil\\speck-tool\\Speck.lnk",
    "C:\\Users\\Bruce O'Neil\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Speck.lnk",
  ]);
});

test('PowerShell script points at Speck.vbs with the Speck icon, quotes safely', () => {
  const ps = shortcutScript(root, env);
  assert.match(ps, /System32\\wscript\.exe/);
  assert.ok(ps.includes(`$s.Arguments = '"C:\\Users\\Bruce O''Neil\\speck-tool\\Speck.vbs"'`), 'apostrophes doubled for PowerShell');
  assert.ok(ps.includes(`$s.IconLocation = 'C:\\Users\\Bruce O''Neil\\speck-tool\\assets\\speck.ico,0'`));
  assert.equal((ps.match(/\$s\.Save\(\)/g) || []).length, 2);
});

test('does nothing outside Windows', () => {
  if (process.platform !== 'win32') assert.equal(ensureShortcuts('/tmp'), false);
});
