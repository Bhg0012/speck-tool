'use strict';
// Shared between the Electron app and the launcher script - no Electron imports here.
const os = require('os');
const path = require('path');

const DEFAULT_READER = 'qwen3-vl:8b-instruct';

const DEFAULTS = {
  configVersion: 3,
  ollamaUrl: 'http://127.0.0.1:11434',
  readerModel: DEFAULT_READER, // vision model that reads the screen
  modelAuto: true, // launcher picks the best model for this computer's graphics card
  solverModel: 'reader', // 'reader' (same model does everything) | any installed model name
  mode: 'careful', // 'fast' | 'careful' | 'max'
  keepAlive: '2h', // how long Ollama keeps the model loaded (first answer after that is slower)
  hotkeys: {
    capture: 'CommandOrControl+Alt+A',
    deep: 'CommandOrControl+Alt+D',
    toggle: 'CommandOrControl+Alt+H',
    copy: 'CommandOrControl+Alt+C',
    settings: 'CommandOrControl+Alt+,',
    quit: 'CommandOrControl+Alt+Q',
    history: 'CommandOrControl+Alt+Y',
  },
  appearance: {
    theme: 'dark-on-light', // 'dark-on-light' | 'light-on-dark' | 'plain-dark' | 'plain-light'
    fontSize: 11,
    opacity: 0.85, // answer text
    markerOpacity: 0.35, // corner markers + dot
    position: 'center', // 'left' | 'center' | 'right'
    showConfidence: true,
    autoHideSeconds: 0, // 0 = keep the answer until the next one
    trimWindows: true, // Windows/Linux: clip overlay windows to what they draw (removes the faint box)
  },
  showTray: true,
  shareAi: false, // let other computers on the home network use this computer's Ollama
  saveHistory: true, // keep the last 30 questions + answers (text only, on this computer)
  region: null, // { x, y, width, height } in screen points
  dotPosition: null, // { x, y }
};

const RECOMMENDED_MODELS = [
  { name: 'qwen3-vl:8b-instruct', role: 'Vision', note: 'Recommended. Fast and accurate (~6 GB)' },
  { name: 'qwen3-vl:4b-instruct', role: 'Vision', note: 'About twice as fast, a little less accurate (~3 GB)' },
  { name: 'qwen3-vl:8b', role: 'Vision', note: 'Thinking version: more careful but much slower' },
  { name: 'gemma3:12b', role: 'Vision', note: 'Strong alternative (~8 GB)' },
  { name: 'gpt-oss:20b', role: 'Solver', note: 'Text-only reasoning model, slow. Needs 16 GB+ RAM (~14 GB)' },
];

// Brings settings files from older versions up to date.
function migrate(raw) {
  const s = raw && typeof raw === 'object' ? { ...raw } : {};
  if (!s.configVersion || s.configVersion < 2) {
    // v1 defaulted to the slow "thinking" qwen3-vl:8b and a gpt-oss auto-solver.
    if (!s.readerModel || s.readerModel === 'qwen3-vl:8b') s.readerModel = DEFAULT_READER;
    if (!s.solverModel || s.solverModel === 'auto') s.solverModel = 'reader';
    if (s.keepAlive === '30m') s.keepAlive = '2h';
    if (s.appearance) delete s.appearance.showStatus;
    s.configVersion = 2;
  }
  if (s.configVersion < 3) {
    // v3: the launcher picks the model for the graphics card, unless one was chosen by hand.
    s.modelAuto = !s.readerModel || s.readerModel === DEFAULT_READER;
    s.configVersion = 3;
  }
  return s;
}

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

module.exports = { DEFAULTS, DEFAULT_READER, RECOMMENDED_MODELS, appDataDir, settingsFile, merge, migrate };
