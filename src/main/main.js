'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
  systemPreferences,
} = require('electron');
const { Settings } = require('./settings');
const { History, entryText } = require('./history');
const { buildDiagnostics } = require('./diagnostics');
const share = require('./share');
const { recommend } = require('../shared/speed');
const { Ollama } = require('./ollama');
const { solve, resolveModels, NUM_CTX } = require('./solver');
const { captureRegion } = require('./capture');
const { answerText } = require('./answer');
const monitors = require('./monitors');
const { RECOMMENDED_MODELS, settingsFile } = require('../shared/defaults');
const { readVersionInfo, versionLabels } = require('../shared/version');

const IS_MAC = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PRELOAD = path.join(ROOT, 'src', 'preload.js');
const ASSETS = path.join(ROOT, 'assets');

const HANDLE = 28; // corner marker window size
const PAD = 7; // where the bracket's corner sits inside the marker window
const DOT = 22; // capture button window size
const CLICK_SLOP = 6; // a press that moves less than this (px) on the dot is a click, not a drag
const BAR_H = 420; // answer bar window height (room for a hover-expanded table or long answer)

app.setName('Speck');
app.setPath('userData', path.dirname(settingsFile()));

const settings = new Settings(settingsFile());
const ollama = new Ollama(settings.get().ollamaUrl);
const localOllama = new Ollama('http://127.0.0.1:11434'); // fallback when a remote (e.g. the Mac) is unreachable
const history = new History(path.join(path.dirname(settingsFile()), 'history.json'));

const win = { tl: null, br: null, dot: null, frame: null, bar: null, settings: null, history: null };
let tray = null;
let hidden = false;
let barHasContent = false;
let barPayload = null; // what the answer bar shows, so it can be re-shown on another monitor
let lastResult = null;
let job = null;
let jobId = 0;
let drag = null;
let autoHideTimer = null;
let askedScreenPermission = false;
const askLog = []; // timing of recent asks, newest first (for Copy diagnostics)
const SLOW_MS = 40000; // answers slower than this get a hint to run the speed test
let permissionWatch = null;

// ---------------------------------------------------------------------------
// Geometry

function defaultRegion() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.round(wa.width * 0.4);
  const height = Math.round(wa.height * 0.3);
  return { x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width, height };
}

function defaultDot() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - DOT - 10, y: wa.y + wa.height - DOT - 10 };
}

function onSomeScreen(r) {
  return screen.getAllDisplays().some((d) => {
    const b = d.bounds;
    return r.x + Math.min(r.width || 1, 20) > b.x && r.x < b.x + b.width && r.y + Math.min(r.height || 1, 20) > b.y && r.y < b.y + b.height;
  });
}

function currentRegion() {
  if (!win.tl || !win.br) return settings.get().region || defaultRegion();
  const [ax, ay] = win.tl.getPosition();
  const [bx, by] = win.br.getPosition();
  const x1 = ax + PAD;
  const y1 = ay + PAD;
  const x2 = bx + HANDLE - PAD;
  const y2 = by + HANDLE - PAD;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function placeHandles(r) {
  moveSmall(win.tl, r.x - PAD, r.y - PAD);
  moveSmall(win.br, r.x + r.width - HANDLE + PAD, r.y + r.height - HANDLE + PAD);
}

// The markers and dot are tiny windows. Windows can make a new tiny window bigger than asked
// (its minimum window size), so they are always moved with their exact size, never setPosition.
function roleOf(w) {
  return w === win.tl ? 'tl' : w === win.br ? 'br' : w === win.dot ? 'dot' : null;
}

function sizeOf(w) {
  return roleOf(w) === 'dot' ? DOT : HANDLE;
}

function moveSmall(w, x, y) {
  const n = sizeOf(w);
  w.setBounds({ x: Math.round(x), y: Math.round(y), width: n, height: n });
}

function validatePositions() {
  const s = settings.get();
  const region = s.region && onSomeScreen(s.region) ? s.region : defaultRegion();
  const dot = s.dotPosition && onSomeScreen({ ...s.dotPosition, width: DOT, height: DOT }) ? s.dotPosition : defaultDot();
  if (win.tl) placeHandles(region);
  if (win.dot) moveSmall(win.dot, dot.x, dot.y);
  reshapeSmall(); // a display's scaling may have changed
}

// Moves the capture area, the dot and the answer to the next monitor, in the same layout.
function switchMonitor() {
  const displays = screen.getAllDisplays();
  if (displays.length < 2 || drag) return;
  const region = currentRegion();
  const from = screen.getDisplayMatching(region);
  const to = monitors.nextDisplay(displays, from.id);
  const r = monitors.moveRegion(region, from.workArea, to.workArea);
  const [dx, dy] = win.dot.getPosition();
  const dotFrom = screen.getDisplayMatching({ x: dx, y: dy, width: DOT, height: DOT });
  const d = dotFrom.id === to.id ? { x: dx, y: dy } : monitors.moveDot({ x: dx, y: dy }, DOT, dotFrom.workArea, to.workArea);
  settings.update({ region: r, dotPosition: d });
  placeHandles(r);
  moveSmall(win.dot, d.x, d.y);
  reshapeSmall();
  placeBar(to);
  if (barHasContent && barPayload) barShow(barPayload); // re-drawn (and re-trimmed) for the new width
  flashFrame();
}

function resetPositions() {
  settings.update({ region: null, dotPosition: null });
  validatePositions();
  flashFrame();
}

// ---------------------------------------------------------------------------
// Windows

function overlay(role, bounds, { clickThrough = false } = {}) {
  const w = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Windows: without these a borderless window still gets a faint system frame/shadow box.
    thickFrame: false,
    roundedCorners: false,
    focusable: false,
    acceptFirstMouse: true,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    show: false,
    title: '',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  if (clickThrough) w.setIgnoreMouseEvents(true, { forward: true });
  // macOS lets clicks fall through see-through pixels unless told otherwise. Saying so means the
  // markers and dot need no faint background to stay grabbable.
  else if (IS_MAC) w.setIgnoreMouseEvents(false);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.on('did-finish-load', () => w.webContents.send('appearance', settings.get().appearance));
  w.loadFile(path.join(RENDERER, 'overlay.html'), { query: { role } });
  return w;
}

// Windows (and Linux): clip each overlay window to what it actually draws, so the OS has no
// see-through area left to paint a faint backdrop "box" into. macOS draws nothing there and
// has no setShape. Rects are in window coordinates.
const CAN_SHAPE = !IS_MAC;
const SHAPES = {
  // L-shaped areas hugging the corner brackets (bracket corner sits at PAD in a HANDLE window)
  tl: [
    { x: 3, y: 3, width: 19, height: 9 },
    { x: 3, y: 12, width: 9, height: 10 },
  ],
  br: [
    { x: 6, y: 16, width: 19, height: 9 },
    { x: 16, y: 6, width: 9, height: 10 },
  ],
  // a small rounded area around the 7 px dot (centred in a DOT window)
  dot: [
    { x: 6, y: 4, width: 10, height: 14 },
    { x: 4, y: 6, width: 14, height: 10 },
  ],
};
const TINY = [{ x: 0, y: 0, width: 1, height: 1 }];

// The trim is stored in physical pixels for the display the window is on, so it's redone
// whenever a window may have moved to a display with different scaling.
function reshapeSmall() {
  for (const w of [win.tl, win.br, win.dot]) if (w) shape(w, SHAPES[roleOf(w)]);
}

// Logged once per window (speck.log and Copy diagnostics) if Windows still won't size it exactly.
const sizeLogged = new Set();
function checkSize(w) {
  const role = roleOf(w);
  const [width, height] = w.getSize();
  const n = sizeOf(w);
  if ((width !== n || height !== n) && !sizeLogged.has(role)) {
    sizeLogged.add(role);
    logError('size', `${role} window is ${width}x${height}, expected ${n}x${n} (drawn from its top-left, so still visible)`);
  }
}

let shapeBroken = false;
function shape(w, rects) {
  if (!CAN_SHAPE || shapeBroken || !settings.get().appearance.trimWindows || !w || w.isDestroyed()) return;
  try {
    w.setShape(rects);
  } catch (e) {
    shapeBroken = true; // cosmetic only: never let it break Speck, and don't retry
    logError('setShape', e);
  }
}

// The drag outline: just its four 2 px edges.
function setFrameBounds(r) {
  win.frame.setBounds(r);
  const t = 2;
  const { width: W, height: H } = r;
  send(win.frame, 'frame', { width: W, height: H }); // drawn at this size even if the window is bigger
  shape(win.frame, [
    { x: 0, y: 0, width: W, height: t },
    { x: 0, y: Math.max(0, H - t), width: W, height: t },
    { x: 0, y: 0, width: t, height: H },
    { x: Math.max(0, W - t), y: 0, width: t, height: H },
  ]);
}

function createOverlays() {
  const s = settings.get();
  const region = s.region && onSomeScreen(s.region) ? s.region : defaultRegion();
  const dot = s.dotPosition && onSomeScreen({ ...s.dotPosition, width: DOT, height: DOT }) ? s.dotPosition : defaultDot();

  win.tl = overlay('tl', { x: region.x - PAD, y: region.y - PAD, width: HANDLE, height: HANDLE });
  win.br = overlay('br', { x: region.x + region.width - HANDLE + PAD, y: region.y + region.height - HANDLE + PAD, width: HANDLE, height: HANDLE });
  win.dot = overlay('dot', { x: dot.x, y: dot.y, width: DOT, height: DOT });
  win.frame = overlay('frame', { ...region }, { clickThrough: true });
  win.frame.setIgnoreMouseEvents(true);
  win.bar = overlay('bar', { x: 0, y: 0, width: 800, height: BAR_H }, { clickThrough: true });
  placeBar(screen.getDisplayMatching(region));
  // Show the dot and corners as soon as they're ready, and again after a few seconds in case
  // the system never reports "ready" (they must never stay invisible).
  for (const w of [win.tl, win.br, win.dot]) {
    const [x, y] = w.getPosition();
    moveSmall(w, x, y);
    w.once('ready-to-show', () => {
      const [wx, wy] = w.getPosition();
      moveSmall(w, wx, wy);
      if (!hidden) w.showInactive();
      shape(w, SHAPES[roleOf(w)]);
      checkSize(w);
    });
  }
  setTimeout(() => {
    for (const w of [win.tl, win.br, win.dot]) {
      if (w.isDestroyed()) continue;
      if (!hidden && !w.isVisible()) w.showInactive();
      const [x, y] = w.getPosition();
      moveSmall(w, x, y);
      shape(w, SHAPES[roleOf(w)]);
      checkSize(w);
    }
  }, 4000);
  shape(win.bar, TINY); // the bar reports its answer's size once it has one
  try {
    setFrameBounds(region);
  } catch (e) {
    logError('frame', e);
  }

}

function placeBar(display) {
  const wa = display.workArea;
  win.bar.setBounds({ x: wa.x, y: wa.y + wa.height - BAR_H, width: wa.width, height: BAR_H });
}

function overlays() {
  return [win.tl, win.br, win.dot, win.frame, win.bar].filter((w) => w && !w.isDestroyed());
}

function send(w, channel, payload) {
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// Answer bar

function barShow(payload) {
  barHasContent = true;
  barPayload = payload;
  send(win.bar, 'bar', payload);
  // Shown even in hidden ("ghost") mode: a hotkey ask still gets its tiny answer.
  win.bar.showInactive();
  win.bar.moveTop();
}

function barClear() {
  barHasContent = false;
  clearTimeout(autoHideTimer);
  send(win.bar, 'bar', { kind: 'clear' });
  setTimeout(() => {
    if (!barHasContent && win.bar && !win.bar.isDestroyed()) win.bar.hide();
  }, 250);
}


function showError(message, ms = 6000) {
  barShow({ kind: 'error', text: message });
  clearTimeout(autoHideTimer);
  autoHideTimer = setTimeout(barClear, ms);
}

function showAnswer(result) {
  barShow({ kind: 'answer', ...result });
  if (settings.get().saveHistory && result.answer && result.answer !== '?') {
    history.add(result);
    send(win.history, 'history:changed');
  }
  clearTimeout(autoHideTimer);
  const secs = Number(settings.get().appearance.autoHideSeconds) || 0;
  if (secs > 0) autoHideTimer = setTimeout(barClear, secs * 1000);
}

// ---------------------------------------------------------------------------
// Visibility

function setHidden(h) {
  hidden = h;
  if (h) {
    for (const w of overlays()) w.hide();
    if (win.history && !win.history.isDestroyed()) win.history.hide();
  } else {
    for (const w of [win.tl, win.br, win.dot]) w.showInactive();
    if (barHasContent) win.bar.showInactive();
  }
  updateTrayMenu();
}

function toggle() {
  const anyVisible = overlays().some((w) => w.isVisible());
  setHidden(anyVisible);
}

function flashFrame(ms = 900) {
  if (hidden) return;
  setFrameBounds(currentRegion());
  win.frame.showInactive();
  send(win.frame, 'frame', { visible: true });
  setTimeout(() => {
    if (!drag) {
      send(win.frame, 'frame', { visible: false });
      setTimeout(() => !drag && win.frame.hide(), 200);
    }
  }, ms);
}

// ---------------------------------------------------------------------------
// Dragging (main process follows the cursor: smooth and immune to DPI quirks)

function dragStart(e, role) {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || drag) return;
  const [wx, wy] = w.getPosition();
  const c = screen.getCursorScreenPoint();
  const scale = screen.getDisplayMatching(w.getBounds()).scaleFactor;
  drag = { role, w, ox: c.x - wx, oy: c.y - wy, sx: c.x, sy: c.y, moved: 0, started: Date.now(), scale };
  if (role !== 'dot') {
    setFrameBounds(currentRegion());
    win.frame.showInactive();
    send(win.frame, 'frame', { visible: true });
  }
  drag.timer = setInterval(dragTick, 8);
}

function dragTick() {
  if (!drag) return;
  if (Date.now() - drag.started > 120000) return dragEnd(); // safety net if mouse-up was lost
  const c = screen.getCursorScreenPoint();
  drag.moved = Math.max(drag.moved, Math.abs(c.x - drag.sx) + Math.abs(c.y - drag.sy));
  if (drag.role === 'dot' && drag.moved < CLICK_SLOP) return;
  moveSmall(drag.w, c.x - drag.ox, c.y - drag.oy);
  if (drag.role !== 'dot') setFrameBounds(currentRegion());
  // Crossed onto a display with different scaling: redo the trim so nothing gets clipped.
  const scale = screen.getDisplayMatching(drag.w.getBounds()).scaleFactor;
  if (scale !== drag.scale) {
    drag.scale = scale;
    shape(drag.w, SHAPES[drag.role]);
  }
}

function dragEnd() {
  if (!drag) return;
  dragTick();
  clearInterval(drag.timer);
  const d = drag;
  drag = null;
  if (d.role === 'dot') {
    if (d.moved < CLICK_SLOP) ask(false);
    else {
      const [x, y] = d.w.getPosition();
      settings.update({ dotPosition: { x, y } });
    }
    return;
  }
  settings.update({ region: currentRegion() });
  setTimeout(() => {
    if (drag) return;
    send(win.frame, 'frame', { visible: false });
    setTimeout(() => !drag && win.frame.hide(), 200);
  }, 350);
}

// ---------------------------------------------------------------------------
// Ask: capture -> solve -> show

async function screenPermissionOk() {
  if (!IS_MAC) return true;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return true;
  if (!askedScreenPermission) {
    askedScreenPermission = true;
    return true; // the first capture attempt triggers the macOS prompt
  }
  showError('Turn on "Electron" in Screen Recording. Speck restarts itself once allowed (or right-click the dot, then Restart Speck)', 20000);
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  watchForPermission();
  return false;
}

// macOS only applies a new Screen Recording permission after a restart, so restart as soon as it's granted.
function watchForPermission() {
  if (permissionWatch) return;
  const started = Date.now();
  permissionWatch = setInterval(() => {
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') restartApp();
    else if (Date.now() - started > 10 * 60 * 1000) {
      clearInterval(permissionWatch);
      permissionWatch = null;
    }
  }, 1500);
}

function restartApp() {
  app.relaunch();
  app.exit(0);
}

async function grab(rect) {
  // Hide our own overlays for the instant of the screenshot.
  const visible = [...overlays(), win.history].filter((w) => w && !w.isDestroyed() && w.isVisible());
  for (const w of visible) w.setOpacity(0);
  await new Promise((r) => setTimeout(r, 80));
  try {
    return await captureRegion(rect);
  } finally {
    for (const w of visible) if (!w.isDestroyed()) w.setOpacity(1);
  }
}

async function ask(deep) {
  if (job) job.abort();
  const controller = new AbortController();
  job = controller;
  const id = ++jobId;
  const rect = currentRegion();
  if (rect.width < 10 || rect.height < 10) return showError('Capture area is too small');
  placeBar(screen.getDisplayMatching(rect));

  const t0 = Date.now();
  let shot;
  try {
    if (!(await screenPermissionOk())) return;
    shot = await grab(rect);
  } catch (e) {
    logAsk({ mode: deep ? 'max' : settings.get().mode, totalMs: Date.now() - t0, captureMs: Date.now() - t0, error: e.message });
    return showError(e.message || 'Screen capture failed');
  }
  if (id !== jobId) return;
  const captureMs = Date.now() - t0;

  send(win.tl, 'pulse');
  send(win.br, 'pulse');
  send(win.dot, 'busy', true);
  // Discreet: while working only the dot pulses. The bar stays empty until the answer is ready.
  if (barHasContent) barClear();
  const s = settings.get();
  try {
    const route = await share.pickOllama(ollama, localOllama, s.ollamaUrl);
    const result = await solve({
      image: shot.base64,
      settings: s,
      ollama: route.client,
      mode: deep ? 'max' : s.mode,
      signal: controller.signal,
    });
    if (id !== jobId) return;
    const totalMs = Date.now() - t0;
    logAsk({ mode: result.mode, totalMs, captureMs, answer: result.answer, confidence: result.confidence, calls: result.calls });
    result.slow = totalMs > SLOW_MS;
    result.fallback = route.fallback;
    lastResult = result;
    showAnswer(result);
  } catch (e) {
    if (controller.signal.aborted || id !== jobId) return;
    logAsk({ mode: deep ? 'max' : s.mode, totalMs: Date.now() - t0, captureMs, error: e.message });
    showError(e.message || 'Something went wrong');
  } finally {
    if (id === jobId) {
      job = null;
      send(win.dot, 'busy', false);
    }
  }
}

// Errors go to speck.log next to the settings (and into Copy diagnostics), so a problem on any
// computer can be seen and fixed instead of failing silently.
const LOG_FILE = path.join(path.dirname(settingsFile()), 'speck.log');
const recentErrors = [];
function logError(where, e) {
  const line = `${new Date().toISOString()} [${where}] ${(e && (e.stack || e.message)) || e}`;
  recentErrors.unshift(line.split('\n')[0]);
  recentErrors.length = Math.min(recentErrors.length, 10);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 200000) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    // nowhere to log
  }
}
process.on('uncaughtException', (e) => logError('uncaught', e));
process.on('unhandledRejection', (e) => logError('unhandled', e));

function logAsk(entry) {
  askLog.unshift({ at: new Date().toLocaleString(), ...entry });
  askLog.length = Math.min(askLog.length, 20);
}

// ---------------------------------------------------------------------------
// Diagnostics + speed test (to make every computer as quick as the Mac)

function step2(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

async function diagnosticsText() {
  let gpu = null;
  try {
    gpu = await app.getGPUInfo('complete');
  } catch {
    try {
      gpu = await app.getGPUInfo('basic');
    } catch {
      gpu = null;
    }
  }
  const ollamaInfo = { ok: false };
  try {
    ollamaInfo.version = await ollama.version();
    ollamaInfo.models = await ollama.list();
    ollamaInfo.running = await ollama.ps();
    ollamaInfo.ok = true;
  } catch (e) {
    ollamaInfo.error = e.message;
  }
  const cpus = os.cpus();
  return buildDiagnostics({
    app: { version: app.getVersion(), commit: LOADED_BUILD },
    system: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      cpu: (cpus[0] && cpus[0].model) || '?',
      cores: cpus.length,
      ramGb: Math.round(os.totalmem() / 1e9),
      freeGb: Math.round(os.freemem() / 1e9),
    },
    gpu,
    nvidia: step2(() => require('../shared/hardware').detectGpu()),
    errors: recentErrors,
    ollama: ollamaInfo,
    settings: settings.get(),
    asks: askLog,
  });
}

async function copyDiagnostics() {
  clipboard.writeText(await diagnosticsText());
  barShow({ kind: 'note', text: 'Diagnostics copied. Paste them to Claude' });
  clearTimeout(autoHideTimer);
  autoHideTimer = setTimeout(barClear, 4000);
}

// One real answer on a built-in sample question, timed. Careful mode = this + one more
// attempt that reuses the processed image, so only the writing time repeats.
async function speedTest() {
  const s = settings.get();
  try {
    const m = await resolveModels(ollama, s);
    const t0 = Date.now();
    await ollama.warm(m.reader, s.keepAlive, NUM_CTX);
    const loadS = (Date.now() - t0) / 1000;
    // Change one pixel so Ollama can't reuse a cached copy of the sample image.
    const img = nativeImage.createFromPath(path.join(ASSETS, 'speedtest.png'));
    const size = img.getSize();
    const bmp = img.toBitmap();
    const i = 4 * Math.floor(Math.random() * size.width * size.height);
    bmp[i] = (bmp[i] + 1) % 256;
    const fresh = nativeImage.createFromBitmap(bmp, size).toPNG().toString('base64');
    const t1 = Date.now();
    const r = await solve({ image: fresh, settings: s, ollama, mode: 'fast', timeoutScale: 2 });
    const fastS = (Date.now() - t1) / 1000;
    const last = r.calls[r.calls.length - 1] || { genS: 0, genTokens: 0, promptS: 0 };
    const carefulS = fastS + last.genS;
    const genTps = last.genS ? last.genTokens / last.genS : 0;
    const correct = /\b75\b/.test(r.answer);
    const measured = { model: m.reader, mode: s.mode, loadS, fastS, carefulS, readS: last.promptS, genTps, correct, answer: r.answer };
    logAsk({ mode: 'speed test', totalMs: Date.now() - t1, captureMs: 0, answer: r.answer, confidence: r.confidence, calls: r.calls });
    return { ok: true, ...measured, advice: recommend(measured) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function copyAnswer() {
  if (!lastResult) return;
  clipboard.writeText(answerText(lastResult)); // a table copies as rows and columns
  send(win.bar, 'bar', { kind: 'copied' });
}

// ---------------------------------------------------------------------------
// Hotkeys, tray, menus

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = settings.get().hotkeys;
  const actions = {
    capture: () => ask(false),
    deep: () => ask(true),
    toggle,
    copy: copyAnswer,
    settings: openSettings,
    quit: () => app.quit(),
    history: openHistory,
  };
  const failed = [];
  for (const [name, fn] of Object.entries(actions)) {
    const acc = hk[name];
    if (!acc) continue;
    try {
      if (!globalShortcut.register(acc, fn)) failed.push(name);
    } catch {
      failed.push(name);
    }
  }
  return failed;
}

// Build this process loaded (compared with newer launches to restart after an update).
const LOADED_BUILD = readVersionInfo(ROOT).commit || 'dev';

function buildArg(argv) {
  const a = argv.find((x) => typeof x === 'string' && x.startsWith('--speck-build='));
  return a ? a.slice('--speck-build='.length) : null;
}

function menuTemplate() {
  const hk = settings.get().hotkeys;
  const acc = (k) => (hk[k] ? { accelerator: hk[k], registerAccelerator: false } : {});
  const info = versionLabels(readVersionInfo(ROOT)).map((label) => ({ label, enabled: false }));
  return [
    ...info,
    { type: 'separator' },
    { label: 'Ask', click: () => ask(false), ...acc('capture') },
    { label: 'Ask (max accuracy)', click: () => ask(true), ...acc('deep') },
    { label: 'Copy answer', click: copyAnswer, enabled: !!lastResult, ...acc('copy') },
    { type: 'separator' },
    { label: hidden ? 'Show' : 'Hide', click: toggle, ...acc('toggle') },
    ...(screen.getAllDisplays().length > 1
      ? [{ label: screen.getAllDisplays().length > 2 ? 'Switch to next monitor' : 'Switch to other monitor', click: switchMonitor }]
      : []),
    { label: 'Reset capture area', click: resetPositions },
    { label: 'History…', click: openHistory, ...acc('history') },
    { label: 'Copy diagnostics', click: copyDiagnostics },
    { label: 'Settings…', click: openSettings, ...acc('settings') },
    { type: 'separator' },
    { label: 'Restart Speck', click: restartApp },
    { label: 'Quit Speck', click: () => app.quit(), ...acc('quit') },
  ];
}

function trayIcon() {
  if (IS_MAC) {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
}

function updateTray() {
  const want = settings.get().showTray;
  if (want && !tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('Speck');
    if (!IS_MAC) tray.on('click', toggle);
  } else if (!want && tray) {
    tray.destroy();
    tray = null;
  }
  updateTrayMenu();
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

// ---------------------------------------------------------------------------
// Settings window

function openSettings() {
  if (win.settings && !win.settings.isDestroyed()) {
    win.settings.show();
    win.settings.focus();
    if (IS_MAC) app.focus({ steal: true });
    return;
  }
  win.settings = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 400,
    minHeight: 420,
    show: false,
    title: 'Speck',
    backgroundColor: '#0b0b0e',
    autoHideMenuBar: true,
    fullscreenable: false,
    maximizable: false,
    icon: path.join(ASSETS, 'icon.png'),
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.settings.setMenuBarVisibility(false);
  win.settings.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.settings.webContents.on('will-navigate', (e) => e.preventDefault());
  win.settings.loadFile(path.join(RENDERER, 'settings.html'));
  win.settings.once('ready-to-show', () => {
    win.settings.show();
    if (IS_MAC) app.focus({ steal: true });
  });
  win.settings.on('closed', () => {
    win.settings = null;
  });
}

// ---------------------------------------------------------------------------
// History window: small and dark, near the dot, never in the taskbar/dock

function openHistory() {
  if (win.history && !win.history.isDestroyed()) {
    win.history.show();
    win.history.focus();
    if (IS_MAC) app.focus({ steal: true });
    return;
  }
  const W = 380;
  const H = 480;
  const [dx, dy] = win.dot.getPosition();
  const wa = screen.getDisplayNearestPoint({ x: dx, y: dy }).workArea;
  const x = Math.max(wa.x + 8, Math.min(dx + DOT - W, wa.x + wa.width - W - 8));
  const y = Math.max(wa.y + 8, Math.min(dy - H - 8, wa.y + wa.height - H - 8));
  win.history = new BrowserWindow({
    x,
    y,
    width: W,
    height: H,
    minWidth: 300,
    minHeight: 240,
    show: false,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    title: 'History',
    backgroundColor: '#0e0e12',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.history.setAlwaysOnTop(true, 'floating');
  if (IS_MAC) win.history.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.history.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.history.webContents.on('will-navigate', (e) => e.preventDefault());
  win.history.loadFile(path.join(RENDERER, 'history.html'));
  win.history.once('ready-to-show', () => {
    win.history.show();
    if (IS_MAC) app.focus({ steal: true });
  });
  win.history.on('closed', () => {
    win.history = null;
  });
}

function applySettings() {
  const s = settings.get();
  ollama.setBaseUrl(s.ollamaUrl);
  const failed = registerHotkeys();
  for (const w of overlays()) send(w, 'appearance', s.appearance);
  updateTray();
  warmModels();
  return failed;
}

async function warmModels(reportErrors = false) {
  try {
    const { client } = await share.pickOllama(ollama, localOllama, settings.get().ollamaUrl);
    const m = await resolveModels(client, settings.get());
    await client.warm(m.reader, settings.get().keepAlive, NUM_CTX);
    if (m.solver !== m.reader) await client.warm(m.solver, settings.get().keepAlive, NUM_CTX);
  } catch (e) {
    if (reportErrors) showError(e.message, 8000);
  }
}

function registerIpc() {
  ipcMain.on('drag:start', dragStart);
  ipcMain.on('drag:end', dragEnd);
  ipcMain.on('dot:menu', () => Menu.buildFromTemplate(menuTemplate()).popup());
  ipcMain.on('bar:shape', (_e, r) => {
    const ok = r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
    shape(win.bar, ok ? [{ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }] : TINY);
  });
  ipcMain.on('bar:hover', (e, over) => {
    if (win.bar && !win.bar.isDestroyed()) win.bar.setIgnoreMouseEvents(!over, { forward: true });
  });
  ipcMain.on('bar:copy', copyAnswer);
  ipcMain.on('bar:dismiss', barClear);

  ipcMain.handle('settings:get', () => ({
    settings: settings.get(),
    recommended: RECOMMENDED_MODELS,
    platform: process.platform,
    version: app.getVersion(),
  }));
  ipcMain.handle('settings:save', (_e, patch) => {
    settings.update(patch);
    return { failedHotkeys: applySettings() };
  });
  ipcMain.handle('ollama:status', async () => {
    try {
      const version = await ollama.version();
      const list = await ollama.list();
      const models = await Promise.all(
        list.map(async (m) => {
          let caps = [];
          try {
            caps = await ollama.capabilities(m.name);
          } catch {
            // leave unknown
          }
          return { ...m, vision: caps.includes('vision'), thinking: caps.includes('thinking') };
        }),
      );
      return { ok: true, version, models };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  const pulls = new Map();
  ipcMain.handle('ollama:pull', async (e, name) => {
    if (pulls.has(name)) return { ok: false, error: 'Already downloading' };
    const controller = new AbortController();
    pulls.set(name, controller);
    try {
      await ollama.pull(name, (p) => send(BrowserWindow.fromWebContents(e.sender), 'pull:progress', { name, ...p }), controller.signal);
      warmModels();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: controller.signal.aborted ? 'Cancelled' : err.message };
    } finally {
      pulls.delete(name);
    }
  });
  ipcMain.handle('ollama:cancel-pull', (_e, name) => {
    const c = pulls.get(name);
    if (c) c.abort();
  });
  ipcMain.handle('app:reset-area', resetPositions);
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('speed:test', speedTest);
  ipcMain.handle('share:get', () => ({ on: settings.get().shareAi, urls: share.shareUrls(), platform: process.platform }));
  ipcMain.handle('share:set', async (_e, on) => {
    settings.update({ shareAi: !!on });
    return share.setShare(!!on);
  });
  ipcMain.handle('diag:copy', async () => {
    clipboard.writeText(await diagnosticsText());
    return true;
  });
  ipcMain.handle('history:list', () => ({ items: history.list(), enabled: settings.get().saveHistory }));
  ipcMain.handle('history:copy', (_e, at) => {
    const item = history.list().find((h) => h.at === at);
    if (item) clipboard.writeText(entryText(item));
    return !!item;
  });
  ipcMain.handle('history:clear', () => {
    history.clear();
    return true;
  });
  ipcMain.handle('history:close', () => win.history && !win.history.isDestroyed() && win.history.close());
  ipcMain.handle('app:open', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    // Launched again after an update: restart into the new code. Otherwise just show.
    const build = buildArg(argv);
    if (argv.includes('--restart') || (build && build !== 'dev' && build !== LOADED_BUILD)) restartApp();
    else setHidden(false);
  });
  app.on('window-all-closed', () => {
    // Overlays are never closed; the settings window closing must not quit the app.
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.whenReady().then(() => {
    const step = (name, fn, fallback) => {
      try {
        return fn();
      } catch (e) {
        logError(`startup:${name}`, e);
        return fallback;
      }
    };
    logError('startup', `Speck ${app.getVersion()} (${LOADED_BUILD}) starting on ${process.platform} ${os.release()}`);
    step('dock', () => IS_MAC && app.dock && app.dock.hide());
    step('ipc', registerIpc);
    step('overlays', createOverlays);
    const failed = step('hotkeys', registerHotkeys, []);
    step('tray', updateTray);
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, () => {
        validatePositions();
        updateTrayMenu(); // shows/hides "Switch to other monitor"
      });
    }
    step('share', () => settings.get().shareAi && !share.shareActive() && share.setShare(true));
    setTimeout(async () => {
      if (failed.length) showError(`Hotkey unavailable: ${failed.join(', ')} (change it in Settings)`, 8000);
      else {
        try {
          // The configured AI, or this computer's own if a shared one (e.g. the Mac) is unreachable.
          const { client } = await share.pickOllama(ollama, localOllama, settings.get().ollamaUrl);
          await client.version();
          warmModels(true);
        } catch (e) {
          showError(`${e.message}. Start Ollama, then try again`, 8000);
        }
      }
    }, 1200);
  });
}
