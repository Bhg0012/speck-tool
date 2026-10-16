#!/usr/bin/env node
'use strict';
// Cross-platform launcher used by "Start Speck (Mac).command" and "Start Speck (Windows).bat".
// 1. installs/updates dependencies when needed
// 2. makes sure Ollama is running
// 3. downloads the chosen model the first time
// 4. starts Speck in the background and exits
//
// With --quiet (used by Speck.app, which has no window), any step that needs the user to
// watch or act (installing, first model download, installing Ollama) exits with code 3
// instead, so the app can open the visible launcher in Terminal.

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULTS, settingsFile, merge } = require('../src/shared/defaults');

const ROOT = path.join(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const QUIET = process.argv.includes('--quiet');
const NEEDS_SETUP = 3;

const plain = (s) => s;
const dim = QUIET ? plain : (s) => `\x1b[2m${s}\x1b[0m`;
const mint = QUIET ? plain : (s) => `\x1b[38;2;124;247;212m${s}\x1b[0m`;
const red = QUIET ? plain : (s) => `\x1b[31m${s}\x1b[0m`;
const say = (s = '') => console.log(`  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg, hint) {
  say(red(msg));
  if (hint) say(hint);
  process.exit(1);
}

function needsSetup() {
  if (QUIET) process.exit(NEEDS_SETUP);
}

function openUrl(url) {
  const cmd = IS_WIN ? 'cmd' : IS_MAC ? 'open' : 'xdg-open';
  const args = IS_WIN ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // ignore
  }
}

function loadSettings() {
  try {
    return merge(DEFAULTS, JSON.parse(fs.readFileSync(settingsFile(), 'utf8')), true);
  } catch {
    return DEFAULTS;
  }
}

// ---------------------------------------------------------------------------
// 1. Dependencies

function ensureDeps() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail(`Node.js ${process.versions.node} is too old.`, 'Install the LTS version from https://nodejs.org');

  const hash = crypto.createHash('sha1');
  for (const f of ['package.json', 'package-lock.json']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) hash.update(fs.readFileSync(p));
  }
  const want = hash.digest('hex');
  const stamp = path.join(ROOT, 'node_modules', '.speck-deps');
  const have = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
  if (have === want && electronPath()) return;
  needsSetup();

  say(have ? 'Updating components…' : 'Installing components (first run only, about a minute)…');
  const r = spawnSync(IS_WIN ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WIN,
  });
  if (r.status !== 0 || !electronPath()) {
    fail('Installing components failed.', 'Check your internet connection, delete the "node_modules" folder and try again.');
  }
  fs.writeFileSync(stamp, want);
}

function electronPath() {
  try {
    const p = require(path.join(ROOT, 'node_modules', 'electron'));
    return typeof p === 'string' && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Ollama

async function ollamaUp(base) {
  try {
    const res = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function which(cmd) {
  const r = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function startOllama() {
  if (IS_MAC && fs.existsSync('/Applications/Ollama.app')) {
    spawn('open', ['-g', '-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (IS_WIN) {
    const app = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe');
    if (fs.existsSync(app)) {
      spawn(app, [], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
  }
  const bin =
    which('ollama') ||
    (IS_WIN ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe')].find(fs.existsSync) : null) ||
    (IS_MAC ? ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama'].find(fs.existsSync) : null);
  if (!bin) return false;
  spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return true;
}

async function ensureOllama(base) {
  if (await ollamaUp(base)) return;
  const local = /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base);
  if (!local) fail(`Can't reach Ollama at ${base}.`, 'Check the server URL in Speck settings.');
  say('Starting Ollama…');
  if (!startOllama()) {
    needsSetup();
    openUrl('https://ollama.com/download');
    fail(
      'Ollama is not installed. It runs the AI locally.',
      IS_WIN
        ? 'Install it from https://ollama.com/download (or run: winget install Ollama.Ollama), then start Speck again.'
        : 'Install it from https://ollama.com/download (or run: brew install ollama), then start Speck again.',
    );
  }
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await ollamaUp(base)) return;
  }
  fail('Ollama did not start.', 'Open the Ollama app manually, then start Speck again.');
}

// ---------------------------------------------------------------------------
// 3. Model

async function installedModels(base) {
  const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

function has(names, model) {
  return names.includes(model) || (!model.includes(':') && names.includes(`${model}:latest`));
}

async function pullModel(base, model) {
  say(`Downloading ${mint(model)} (first run only; a few GB)…`);
  const res = await fetch(`${base}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!res.ok) fail(`Download of ${model} failed (${res.status}).`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let last = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.error) fail(`Download failed: ${m.error}`);
      let text = m.status || '';
      if (m.total) {
        const pct = Math.floor(((m.completed || 0) / m.total) * 100);
        const bar = '━'.repeat(Math.floor(pct / 4)).padEnd(25, '·');
        text = `${bar} ${String(pct).padStart(3)}%  ${((m.completed || 0) / 1e9).toFixed(1)}/${(m.total / 1e9).toFixed(1)} GB`;
      }
      if (text !== last) {
        process.stdout.write(`\r  ${text}`.padEnd(70));
        last = text;
      }
    }
  }
  process.stdout.write('\n');
}

async function ensureModels(base, s) {
  let names = await installedModels(base);
  const missingSolver = !['auto', 'reader'].includes(s.solverModel) && !has(names, s.solverModel);
  if (!has(names, s.readerModel) || missingSolver) needsSetup();
  if (!has(names, s.readerModel)) {
    await pullModel(base, s.readerModel);
    names = await installedModels(base);
  }
  if (missingSolver) {
    await pullModel(base, s.solverModel);
  }
}

// ---------------------------------------------------------------------------
// 4. Launch

function pretty(acc) {
  if (!acc) return '(none)';
  if (!IS_MAC) return acc.replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl');
  return acc
    .replace(/CommandOrControl|CmdOrCtrl/g, 'Cmd')
    .replace(/Alt/g, 'Option');
}

function launch(s) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath(), [ROOT], { cwd: ROOT, detached: true, stdio: 'ignore', env });
  child.unref();
  const hk = s.hotkeys;
  say();
  say(`${mint('●')} Speck is running.`);
  say(dim(`Ask            ${pretty(hk.capture)}   (or click the tiny dot)`));
  say(dim(`Max accuracy   ${pretty(hk.deep)}`));
  say(dim(`Hide / show    ${pretty(hk.toggle)}`));
  say(dim(`Copy answer    ${pretty(hk.copy)}`));
  say(dim(`Settings       ${pretty(hk.settings)}   (or right-click the dot)`));
  say();
}

(async () => {
  console.log();
  say(`${mint('·')} speck`);
  ensureDeps();
  const s = loadSettings();
  const base = String(s.ollamaUrl).replace(/\/+$/, '');
  await ensureOllama(base);
  try {
    await ensureModels(base, s);
  } catch (e) {
    say(red(`Couldn't check models: ${e.message}`));
  }
  launch(s);
  if (os.platform() === 'darwin' && !QUIET) say(dim('You can close this window.'));
})().catch((e) => fail(e.message));
