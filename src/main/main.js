'use strict';
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
const { Ollama } = require('./ollama');
const { solve, resolveModels } = require('./solver');
const { captureRegion } = require('./capture');
const { RECOMMENDED_MODELS, settingsFile } = require('../shared/defaults');

const IS_MAC = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PRELOAD = path.join(ROOT, 'src', 'preload.js');
const ASSETS = path.join(ROOT, 'assets');

const HANDLE = 28; // corner marker window size
const PAD = 7; // where the bracket's corner sits inside the marker window
const DOT = 22; // capture button window size
const BAR_H = 150; // answer bar window height (room for the hover-expanded answer)

app.setName('Speck');
app.setPath('userData', path.dirname(settingsFile()));

const settings = new Settings(settingsFile());
const ollama = new Ollama(settings.get().ollamaUrl);

const win = { tl: null, br: null, dot: null, frame: null, bar: null, settings: null };
let tray = null;
let hidden = false;
let barHasContent = false;
let lastResult = null;
let job = null;
let jobId = 0;
let drag = null;
let autoHideTimer = null;
let askedScreenPermission = false;

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
  win.tl.setPosition(Math.round(r.x - PAD), Math.round(r.y - PAD));
  win.br.setPosition(Math.round(r.x + r.width - HANDLE + PAD), Math.round(r.y + r.height - HANDLE + PAD));
}

function validatePositions() {
  const s = settings.get();
  const region = s.region && onSomeScreen(s.region) ? s.region : defaultRegion();
  const dot = s.dotPosition && onSomeScreen({ ...s.dotPosition, width: DOT, height: DOT }) ? s.dotPosition : defaultDot();
  if (win.tl) placeHandles(region);
  if (win.dot) win.dot.setPosition(Math.round(dot.x), Math.round(dot.y));
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
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.on('did-finish-load', () => w.webContents.send('appearance', settings.get().appearance));
  w.loadFile(path.join(RENDERER, 'overlay.html'), { query: { role } });
  return w;
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

  for (const w of [win.tl, win.br, win.dot]) {
    w.once('ready-to-show', () => {
      if (!hidden) w.showInactive();
    });
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

function showStatus(text) {
  barShow({ kind: 'status', text: settings.get().appearance.showStatus ? text : '' });
}

function showError(message, ms = 6000) {
  barShow({ kind: 'error', text: message });
  clearTimeout(autoHideTimer);
  autoHideTimer = setTimeout(barClear, ms);
}

function showAnswer(result) {
  barShow({ kind: 'answer', ...result });
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
  win.frame.setBounds(currentRegion());
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
  drag = { role, w, ox: c.x - wx, oy: c.y - wy, sx: c.x, sy: c.y, moved: 0, started: Date.now() };
  if (role !== 'dot') {
    win.frame.setBounds(currentRegion());
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
  if (drag.role === 'dot' && drag.moved < 4) return;
  drag.w.setPosition(Math.round(c.x - drag.ox), Math.round(c.y - drag.oy));
  if (drag.role !== 'dot') win.frame.setBounds(currentRegion());
}

function dragEnd() {
  if (!drag) return;
  dragTick();
  clearInterval(drag.timer);
  const d = drag;
  drag = null;
  if (d.role === 'dot') {
    if (d.moved < 4) ask(false);
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
  showError('Allow Screen Recording for Speck (Electron) in System Settings, then restart Speck', 10000);
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  return false;
}

async function grab(rect) {
  // Hide our own overlays for the instant of the screenshot.
  const visible = overlays().filter((w) => w.isVisible());
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

  let shot;
  try {
    if (!(await screenPermissionOk())) return;
    shot = await grab(rect);
  } catch (e) {
    return showError(e.message || 'Screen capture failed');
  }
  if (id !== jobId) return;

  send(win.tl, 'pulse');
  send(win.br, 'pulse');
  send(win.dot, 'busy', true);
  showStatus('reading');
  const s = settings.get();
  try {
    const result = await solve({
      image: shot.base64,
      settings: s,
      ollama,
      mode: deep ? 'max' : s.mode,
      signal: controller.signal,
      onStatus: (st) => id === jobId && showStatus(st),
    });
    if (id !== jobId) return;
    lastResult = result;
    showAnswer(result);
  } catch (e) {
    if (controller.signal.aborted || id !== jobId) return;
    showError(e.message || 'Something went wrong');
  } finally {
    if (id === jobId) {
      job = null;
      send(win.dot, 'busy', false);
    }
  }
}

function copyAnswer() {
  if (!lastResult) return;
  clipboard.writeText(lastResult.answer);
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

function menuTemplate() {
  const hk = settings.get().hotkeys;
  const acc = (k) => (hk[k] ? { accelerator: hk[k], registerAccelerator: false } : {});
  return [
    { label: 'Ask', click: () => ask(false), ...acc('capture') },
    { label: 'Ask (max accuracy)', click: () => ask(true), ...acc('deep') },
    { label: 'Copy answer', click: copyAnswer, enabled: !!lastResult, ...acc('copy') },
    { type: 'separator' },
    { label: hidden ? 'Show' : 'Hide', click: toggle, ...acc('toggle') },
    { label: 'Reset capture area', click: resetPositions },
    { label: 'Settings…', click: openSettings, ...acc('settings') },
    { type: 'separator' },
    { label: 'Quit Speck', click: () => app.quit() },
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
    const m = await resolveModels(ollama, settings.get());
    await ollama.warm(m.reader, settings.get().keepAlive);
    if (m.solver !== m.reader) await ollama.warm(m.solver, settings.get().keepAlive);
  } catch (e) {
    if (reportErrors) showError(e.message, 8000);
  }
}

function registerIpc() {
  ipcMain.on('drag:start', dragStart);
  ipcMain.on('drag:end', dragEnd);
  ipcMain.on('dot:menu', () => Menu.buildFromTemplate(menuTemplate()).popup());
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
  ipcMain.handle('app:open', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setHidden(false));
  app.on('window-all-closed', () => {
    // Overlays are never closed; the settings window closing must not quit the app.
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.whenReady().then(() => {
    if (IS_MAC && app.dock) app.dock.hide();
    registerIpc();
    createOverlays();
    const failed = registerHotkeys();
    updateTray();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, validatePositions);
    setTimeout(async () => {
      if (failed.length) showError(`Hotkey unavailable: ${failed.join(', ')} (change it in Settings)`, 8000);
      else {
        try {
          await ollama.version();
          warmModels(true);
        } catch (e) {
          showError(`${e.message}. Start Ollama, then try again`, 8000);
        }
      }
    }, 1200);
  });
}
