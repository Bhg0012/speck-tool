'use strict';
// "Let my other computers use this computer's AI": makes Ollama listen on the home network
// (OLLAMA_HOST=0.0.0.0) so e.g. a Windows PC without a graphics card gets Mac-speed answers.
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const PORT = 11434;
const ANY = `0.0.0.0:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isLocalUrl(url) {
  return /\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(String(url));
}

// This computer's addresses on the home network (what the other computer should type in).
function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return out;
}

function shareUrls() {
  return lanAddresses().map((ip) => `http://${ip}:${PORT}`);
}

function shareActive() {
  if (process.platform === 'darwin') {
    return (spawnSync('launchctl', ['getenv', 'OLLAMA_HOST'], { encoding: 'utf8' }).stdout || '').trim() === ANY;
  }
  if (process.platform === 'win32') {
    const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'OLLAMA_HOST'], { encoding: 'utf8', windowsHide: true });
    return r.status === 0 && r.stdout.includes(ANY);
  }
  return false;
}

async function restartOllama(env) {
  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', 'quit app "Ollama"']);
    await sleep(2000);
    spawn('open', ['-g', '-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'win32') {
    spawnSync('taskkill', ['/IM', 'ollama app.exe', '/F'], { windowsHide: true });
    spawnSync('taskkill', ['/IM', 'ollama.exe', '/F'], { windowsHide: true });
    await sleep(1500);
    const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe');
    spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref();
  }
}

/** Turns sharing on/off (persists across restarts) and restarts Ollama so it takes effect. */
async function setShare(on) {
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    spawnSync('launchctl', on ? ['setenv', 'OLLAMA_HOST', ANY] : ['unsetenv', 'OLLAMA_HOST']);
  } else if (process.platform === 'win32') {
    if (on) spawnSync('setx', ['OLLAMA_HOST', ANY], { windowsHide: true });
    else spawnSync('reg', ['delete', 'HKCU\\Environment', '/f', '/v', 'OLLAMA_HOST'], { windowsHide: true });
    if (on) env.OLLAMA_HOST = ANY;
    else delete env.OLLAMA_HOST;
  } else {
    return { ok: false, error: 'Not supported on this system' };
  }
  await restartOllama(env);
  return { ok: true, urls: on ? shareUrls() : [] };
}

/**
 * Picks which Ollama answers: the configured one, or this computer's own when the configured
 * remote one (e.g. the Mac) can't be reached right now.
 */
async function pickOllama(primary, local, url) {
  if (isLocalUrl(url)) return { client: primary, fallback: false };
  try {
    await primary.version();
    return { client: primary, fallback: false };
  } catch {
    try {
      await local.version();
      return { client: local, fallback: true };
    } catch {
      return { client: primary, fallback: false };
    }
  }
}

module.exports = { isLocalUrl, lanAddresses, shareUrls, shareActive, setShare, pickOllama, ANY, PORT };
