'use strict';
// Windows: creates the "Speck" shortcut (Speck icon) in the Speck folder and the Start Menu.
// It runs Speck.vbs, which starts Speck silently (the Windows twin of Speck.app on Mac).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function shortcutPaths(root, env = process.env) {
  const list = [path.win32.join(root, 'Speck.lnk')];
  if (env.APPDATA) list.push(path.win32.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Speck.lnk'));
  return list;
}

// PowerShell that writes each shortcut (WScript.Shell COM, built into Windows).
function shortcutScript(root, env = process.env) {
  const vbs = path.win32.join(root, 'Speck.vbs');
  const ico = path.win32.join(root, 'assets', 'speck.ico');
  const parts = ['$w = New-Object -ComObject WScript.Shell'];
  for (const lnk of shortcutPaths(root, env)) {
    parts.push(
      `$s = $w.CreateShortcut(${psQuote(lnk)})`,
      `$s.TargetPath = (Join-Path $env:WINDIR 'System32\\wscript.exe')`,
      `$s.Arguments = ${psQuote(`"${vbs}"`)}`,
      `$s.WorkingDirectory = ${psQuote(root)}`,
      `$s.IconLocation = ${psQuote(`${ico},0`)}`,
      `$s.Description = 'Speck'`,
      '$s.Save()',
    );
  }
  return parts.join('; ');
}

// Creates the shortcuts when missing or when the Speck folder moved. Never fatal.
function ensureShortcuts(root) {
  if (process.platform !== 'win32') return false;
  const stamp = path.join(root, '.speck-shortcut');
  const have = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : '';
  if (have === root && shortcutPaths(root).every((p) => fs.existsSync(p))) return false;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', shortcutScript(root)], {
    windowsHide: true,
    timeout: 20000,
  });
  if (r.status === 0) fs.writeFileSync(stamp, root);
  return r.status === 0;
}

module.exports = { ensureShortcuts, shortcutScript, shortcutPaths };
