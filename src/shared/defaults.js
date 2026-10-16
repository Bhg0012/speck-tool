'use strict';
// Shared between the Electron app and the launcher script - no Electron imports here.
const os = require('os');
const path = require('path');

const DEFAULT_READER = 'qwen3-vl:8b';

const DEFAULTS = {
  ollamaUrl: 'http://127.0.0.1:11434',
  readerModel: DEFAULT_READER, // vision model that reads the screen
  solverModel: 'auto', // 'auto' (gpt-oss if installed, else reader) | 'reader' | model name
  mode: 'careful', // 'fast' | 'careful' | 'max'
  keepAlive: '30m', // how long Ollama keeps models warm in memory
  hotkeys: {
    capture: 'CommandOrControl+Alt+A',
    deep: 'CommandOrControl+Alt+D',
    toggle: 'CommandOrControl+Alt+H',
    copy: 'CommandOrControl+Alt+C',
    settings: 'CommandOrControl+Alt+,',
  },
  appearance: {
    theme: 'dark-on-light', // 'dark-on-light' | 'light-on-dark' | 'plain-dark' | 'plain-light'
    fontSize: 11,
    opacity: 0.85, // answer text
    markerOpacity: 0.35, // corner markers + dot
    position: 'center', // 'left' | 'center' | 'right'
    showConfidence: true,
    showStatus: true,
    autoHideSeconds: 0, // 0 = keep the answer until the next one
  },
  showTray: true,
  region: null, // { x, y, width, height } in screen points
  dotPosition: null, // { x, y }
};

const RECOMMENDED_MODELS = [
  { name: 'qwen3-vl:8b', role: 'Reader', note: 'Best all-round screen reader (~6 GB)' },
  { name: 'qwen3-vl:4b', role: 'Reader', note: 'Lighter and faster, for 8 GB machines (~3 GB)' },
  { name: 'qwen2.5vl:7b', role: 'Reader', note: 'Proven alternative reader (~6 GB)' },
  { name: 'gemma3:12b', role: 'Reader', note: 'Strong general vision model (~8 GB)' },
  { name: 'gpt-oss:20b', role: 'Solver', note: 'Best reasoning and math. Needs 16 GB+ RAM (~14 GB)' },
];

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function settingsFile() {
  return path.join(appDataDir(), 'Speck', 'settings.json');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merges `patch` into a copy of `base`. Only keys from `base` are kept when
// `strict` is set, so stale keys from old settings files are dropped.
function merge(base, patch, strict = false) {
  const out = { ...base };
  if (!isPlainObject(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (strict && !(k in base)) continue;
    if (isPlainObject(base[k]) && isPlainObject(v)) out[k] = merge(base[k], v, strict);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

module.exports = { DEFAULTS, DEFAULT_READER, RECOMMENDED_MODELS, appDataDir, settingsFile, merge };
