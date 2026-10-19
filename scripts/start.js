#!/usr/bin/env node
'use strict';
// Cross-platform launcher used by "Start Speck (Mac).command", "Start Speck (Windows).bat" and Speck.app.
// 0. updates Speck to the latest version on GitHub (scripts/update.js), then re-runs itself
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
const { DEFAULTS, settingsFile, merge, migrate } = require('../src/shared/defaults');
const { update } = require('./update');
const { ensureShortcuts } = require('./shortcut');
const { detectGpu, pickModel } = require('../src/shared/hardware');
const { readVersionInfo } = require('../src/shared/version');

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
  // Keep the window open so the message can be read (the launchers exit right after this).
  if (!QUIET && process.stdin.isTTY) {
    process.stdout.write('\n  Press Enter to close...');
    try {
      fs.readSync(0, Buffer.alloc(1), 0, 1);
    } catch {
      // stdin not readable: just exit
    }
  }
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

function saveSettingsPatch(patch) {
  try {
    const file = settingsFile();
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // new file
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merge(migrate(raw), patch), null, 2));
  } catch (e) {
    say(dim(`Couldn't save settings: ${e.message}`));
  }
}

function loadSettings() {
  try {
    return merge(DEFAULTS, migrate(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))), true);
  } catch {
    return DEFAULTS;
  }
}

// ---------------------------------------------------------------------------
// 1. Dependencies

function ensureDeps() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail(`Node.js ${process.versions.node} is too old.`, 'Install the LTS version from https://nodejs.org');

  const want = depsFingerprint();
  const stamp = path.join(ROOT, 'node_modules', '.speck-deps');
  const have = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
  if (have === want && electronPath()) return;
  // Speck.app has no window: only open Terminal when there's a big download to watch.
  if (!electronUpToDate()) needsSetup();

  say(have ? 'Updating components…' : 'Installing components (first run only, about a minute)…');
  const r = spawnSync(IS_WIN ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: ROOT,
    stdio: QUIET ? 'ignore' : 'inherit',
    shell: IS_WIN,
  });
  if (r.status !== 0 || !electronPath()) {
    fail('Installing components failed.', 'Check your internet connection, delete the "node_modules" folder and try again.');
  }
  fs.writeFileSync(stamp, want);
}

// Only what affects node_modules (not Speck's own version number), so a normal update
// doesn't trigger a reinstall.
function depsFingerprint() {
  const readJson = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    } catch {
      return {};
    }
  };
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const packages = { ...(lock.packages || {}) };
  delete packages['']; // the root entry only repeats Speck's own name/version
  const data = JSON.stringify({ deps: pkg.dependencies || {}, dev: pkg.devDependencies || {}, packages });
  return crypto.createHash('sha1').update(data).digest('hex');
}

// True when the installed Electron already matches the lockfile (npm install is then quick).
function electronUpToDate() {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const want = lock.packages['node_modules/electron'].version;
    const have = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
    return want === have && !!electronPath();
  } catch {
    return false;
  }
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

function speckLogTail() {
  try {
    const lines = fs.readFileSync(path.join(path.dirname(settingsFile()), 'speck.log'), 'utf8').trim().split('\n');
    return lines.slice(-4).join('\n');
  } catch {
    return '';
  }
}

async function launch(s) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // A running Speck restarts itself when this build differs from the one it loaded.
  const args = [ROOT, `--speck-build=${readVersionInfo(ROOT).commit || 'dev'}`];
  let child = null;
  if (IS_MAC) {
    // Launch through LaunchServices so macOS treats Speck as its own app ("Electron") for
    // Screen Recording, instead of inheriting Terminal's or Speck.app's permission.
    // -n starts a new instance (an already-running Speck just shows itself), -g keeps focus where it is.
    const bundle = path.resolve(electronPath(), '..', '..', '..');
    spawnSync('open', ['-n', '-g', '-a', bundle, '--args', ...args], { stdio: 'ignore' });
  } else {
    child = spawn(electronPath(), args, { cwd: ROOT, detached: true, stdio: 'ignore', env });
    child.unref();
  }
  // Make sure it actually stayed up, so nothing ever fails silently.
  await sleep(5000);
  const crashed = child
    ? child.exitCode !== null && child.exitCode !== 0
    : spawnSync('pgrep', ['-f', '[-]-speck-build='], { encoding: 'utf8' }).status !== 0;
  if (crashed) fail('Speck closed right after starting.', speckLogTail() || 'Run "Start Speck" again; if it keeps happening, send Claude the speck.log file.');
  const hk = s.hotkeys;
  say();
  say(`${mint('●')} Speck is running.`);
  say(dim(`Ask            ${pretty(hk.capture)}   (or click the tiny dot)`));
  say(dim(`Max accuracy   ${pretty(hk.deep)}`));
  say(dim(`Hide / show    ${pretty(hk.toggle)}`));
  say(dim(`Copy answer    ${pretty(hk.copy)}`));
  say(dim(`Settings       ${pretty(hk.settings)}   (or right-click the dot)`));
  say(dim(`Quit           ${pretty(hk.quit)}   (or right-click the dot, then Quit Speck)`));
  say();
}

function selfUpdate() {
  if (process.argv.includes('--no-update')) return;
  say('Checking for updates...');
  const r = update(ROOT);
  if (r.status === 'updated') {
    const v = readVersionInfo(ROOT);
    say(`${mint('↑')} Updated to v${v.version} (${v.commit})`);
    // Run the freshly downloaded launcher for the rest of the steps.
    const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2), '--no-update'], { stdio: 'inherit' });
    process.exit(child.status === null ? 1 : child.status);
  }
  if (r.status === 'current') say(dim(`Up to date (v${readVersionInfo(ROOT).version}, ${readVersionInfo(ROOT).commit})`));
  else if (r.status === 'offline') say(dim("Couldn't reach GitHub to check for updates. Starting the current version."));
  else if (r.status === 'auth') {
    say(red('Speck can\'t update: GitHub needs a login for this private repository.'));
    say(dim('Fix once: make the repository public, or run "gh auth login" (GitHub CLI). See README > Updates.'));
  }
  else if (r.status === 'no-git') {
    say(red('Git is not installed, so Speck cannot update itself.'));
    if (!QUIET && IS_MAC) {
      say('Opening Apple\'s installer for it (click Install). Then start Speck again.');
      spawnSync('xcode-select', ['--install'], { stdio: 'ignore' });
    } else if (!QUIET && IS_WIN && which('winget')) {
      say('Installing Git...');
      spawnSync('winget', ['install', '-e', '--id', 'Git.Git', '--accept-source-agreements', '--accept-package-agreements'], { stdio: 'inherit' });
      const again = update(ROOT);
      if (again.status === 'updated') {
        const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2), '--no-update'], { stdio: 'inherit' });
        process.exit(child.status === null ? 1 : child.status);
      }
    } else {
      say(dim('Install Git from https://git-scm.com/downloads, then start Speck again.'));
    }
  } else if (r.status === 'failed') say(red(`Update failed (${r.message || 'unknown error'}). Starting the current version.`));
}

(async () => {
  console.log();
  say(`${mint('·')} speck`);
  selfUpdate();
  if (ensureShortcuts(ROOT)) say(`${mint('◆')} Added a "Speck" shortcut (Speck icon) here and in the Start Menu. Use it to start Speck.`);
  ensureDeps();
  const s = loadSettings();
  if (s.modelAuto) {
    // Biggest model that fits this computer's graphics card = answers in seconds.
    const gpu = detectGpu();
    const best = pickModel(gpu);
    if (best !== s.readerModel) {
      s.readerModel = best;
      saveSettingsPatch({ readerModel: best });
    }
    say(dim(`Model: ${best} (best fit for ${gpu.name}${gpu.vramGb ? `, ${gpu.vramGb} GB` : ''})`));
  }
  let base = String(s.ollamaUrl).replace(/\/+$/, '');
  if (!/\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base) && !(await ollamaUp(base))) {
    say(dim(`Can't reach the AI at ${base} right now (asleep or off?). Using this computer's Ollama instead.`));
    base = 'http://127.0.0.1:11434';
  }
  // Sharing this computer's AI (Settings): macOS forgets this setting after a restart.
  if (IS_MAC && s.shareAi) spawnSync('launchctl', ['setenv', 'OLLAMA_HOST', '0.0.0.0:11434']);
  await ensureOllama(base);
  try {
    await ensureModels(base, s);
  } catch (e) {
    say(red(`Couldn't check models: ${e.message}`));
  }
  await launch(s);
  if (os.platform() === 'darwin' && !QUIET) say(dim('You can close this window.'));
})().catch((e) => fail(e.message));
