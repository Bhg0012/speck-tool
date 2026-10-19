'use strict';
/* global speck */
const $ = (id) => document.getElementById(id);
const IS_MAC = speck.platform === 'darwin';
if (IS_MAC) document.body.classList.add('mac');

const HOTKEYS = [
  ['capture', 'Ask (capture and answer)'],
  ['deep', 'Ask with max accuracy'],
  ['toggle', 'Hide / show everything'],
  ['copy', 'Copy last answer'],
  ['settings', 'Open settings'],
  ['history', 'Show history'],
  ['quit', 'Quit Speck'],
];
const MODE_HINTS = {
  fast: 'One attempt. Fastest, but not double-checked (confidence capped at 8).',
  careful: 'Two independent attempts that must agree; a tie-breaker runs if they don\'t. Recommended.',
  max: 'Three independent attempts plus a tie-breaker if needed. Slowest, most reliable.',
};

let state = null; // { settings, recommended, platform, version }
let installed = []; // [{ name, size, vision, thinking }]
const pulling = new Map(); // name -> progress element

// ---------------------------------------------------------------------------
// Saving

let pending = {};
let saveTimer = null;

function mergeInto(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
      mergeInto(target[k], v);
    } else target[k] = v;
  }
}

function save(patch) {
  mergeInto(pending, patch);
  mergeInto(state.settings, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const p = pending;
    pending = {};
    const res = await speck.invoke('settings:save', p);
    document.querySelectorAll('.hk input').forEach((el) => {
      el.classList.toggle('fail', res.failedHotkeys.includes(el.dataset.key));
      el.title = res.failedHotkeys.includes(el.dataset.key) ? 'Taken by another app. Pick another combination.' : '';
    });
    $('saved').classList.add('on');
    setTimeout(() => $('saved').classList.remove('on'), 900);
  }, 250);
}

// ---------------------------------------------------------------------------
// Rendering helpers

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function gb(bytes) {
  return bytes ? `${(bytes / 1e9).toFixed(1)} GB` : '';
}

function seg(id, value, onPick) {
  const box = $(id);
  box.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === value);
    b.onclick = () => {
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onPick(b.dataset.v);
    };
  });
}

function prettyAccel(acc) {
  if (!acc) return '';
  if (!IS_MAC) return acc.replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl');
  return acc
    .replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, '⌘')
    .replace(/Control|Ctrl/g, '⌃')
    .replace(/Alt|Option/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, '');
}

// ---------------------------------------------------------------------------
// Ollama + models

async function refreshOllama() {
  $('ollama-text').textContent = 'Checking…';
  $('ollama-dot').className = 'status-dot';
  const st = await speck.invoke('ollama:status');
  if (st.ok) {
    installed = st.models;
    $('ollama-dot').className = 'status-dot ok';
    $('ollama-text').textContent = `Connected · Ollama ${st.version} · ${installed.length} model${installed.length === 1 ? '' : 's'}`;
  } else {
    installed = [];
    $('ollama-dot').className = 'status-dot bad';
    $('ollama-text').textContent = `${st.error}. Install from ollama.com, then Refresh.`;
  }
  renderModels();
}

function renderModels() {
  const s = state.settings;
  const vision = installed.filter((m) => m.vision);

  const reader = $('readerModel');
  reader.innerHTML = '';
  for (const m of vision) reader.append(el('option', { value: m.name }, `${m.name}  ${gb(m.size)}`));
  if (!vision.some((m) => m.name === s.readerModel)) {
    reader.prepend(el('option', { value: s.readerModel }, `${s.readerModel} (not installed)`));
  }
  reader.value = s.readerModel;

  const solver = $('solverModel');
  solver.innerHTML = '';
  solver.append(el('option', { value: 'reader' }, 'Same model (recommended, fastest)'));
  for (const m of installed) {
    solver.append(el('option', { value: m.name }, `${m.name}${m.thinking ? '  · reasoning' : ''}  ${gb(m.size)}`));
  }
  if (![...solver.options].some((o) => o.value === s.solverModel)) {
    solver.append(el('option', { value: s.solverModel }, `${s.solverModel} (not installed)`));
  }
  solver.value = s.solverModel;

  const list = $('recommended');
  list.innerHTML = '';
  for (const r of state.recommended) {
    const have = installed.some((m) => m.name === r.name);
    const action = have
      ? el('span', { class: 'done' }, 'installed')
      : el('button', { class: 'small', onclick: () => pull(r.name) }, 'Download');
    const progress = el('div', { class: 'bar' }, el('i'));
    progress.hidden = !pulling.has(r.name);
    list.append(
      el(
        'div',
        { class: 'item', 'data-model': r.name },
        el('div', { class: 'grow' }, el('div', {}, el('span', { class: 'name' }, r.name), el('span', { class: 'tag' }, r.role)), el('div', { class: 'desc' }, r.note), progress),
        action,
      ),
    );
  }
}

async function pull(name) {
  name = name.trim();
  if (!name || pulling.has(name)) return;
  pulling.set(name, true);
  renderModels();
  const btn = document.querySelector(`.item[data-model="${CSS.escape(name)}"] button`);
  if (btn) {
    btn.textContent = 'Cancel';
    btn.onclick = () => speck.invoke('ollama:cancel-pull', name);
  }
  $('ollama-text').textContent = `Downloading ${name}…`;
  const res = await speck.invoke('ollama:pull', name);
  pulling.delete(name);
  if (!res.ok) $('ollama-text').textContent = `${name}: ${res.error}`;
  await refreshOllama();
  if (res.ok && installed.find((m) => m.name === name && m.vision) && !installed.some((m) => m.name === state.settings.readerModel)) {
    save({ readerModel: name });
    renderModels();
  }
}

speck.on('pull:progress', (p) => {
  const row = document.querySelector(`.item[data-model="${CSS.escape(p.name)}"] .bar`);
  const pct = p.total ? Math.round((p.completed / p.total) * 100) : null;
  if (row) {
    row.hidden = false;
    if (pct !== null) row.firstChild.style.width = `${pct}%`;
  }
  $('ollama-text').textContent = `${p.name}: ${p.status}${pct !== null ? ` ${pct}%` : ''}`;
});

// ---------------------------------------------------------------------------
// Hotkey recorder

function accelFromEvent(e) {
  const code = e.code;
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else {
    key = {
      Space: 'Space',
      Enter: 'Enter',
      Tab: 'Tab',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Comma: ',',
      Period: '.',
      Slash: '/',
      Semicolon: ';',
      Quote: "'",
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Minus: '-',
      Equal: '=',
      Backquote: '`',
    }[code];
  }
  if (!key) return null;
  const mods = [];
  if ((IS_MAC && e.metaKey) || (!IS_MAC && e.ctrlKey)) mods.push('CommandOrControl');
  if (IS_MAC && e.ctrlKey) mods.push('Control');
  if (!IS_MAC && e.metaKey) mods.push('Super');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mods.length || (mods.length === 1 && mods[0] === 'Shift')) return null; // needs a real modifier
  return [...mods, key].join('+');
}

function renderHotkeys() {
  const box = $('hotkeys');
  box.innerHTML = '';
  for (const [key, label] of HOTKEYS) {
    const input = el('input', { type: 'text', readonly: '', 'data-key': key });
    const value = () => state.settings.hotkeys[key] || '';
    input.value = prettyAccel(value());
    input.addEventListener('focus', () => {
      input.classList.add('recording');
      input.value = 'press keys…';
    });
    input.addEventListener('blur', () => {
      input.classList.remove('recording');
      input.value = prettyAccel(value()) || 'none';
    });
    input.addEventListener('keydown', (e) => {
      e.preventDefault();
      if (e.key === 'Escape') return input.blur();
      if (e.key === 'Backspace' || e.key === 'Delete') {
        save({ hotkeys: { [key]: '' } });
        return input.blur();
      }
      const acc = accelFromEvent(e);
      if (!acc) return;
      save({ hotkeys: { [key]: acc } });
      input.blur();
    });
    box.append(el('div', { class: 'hk' }, el('span', {}, label), input));
  }
}

// ---------------------------------------------------------------------------
// Wire-up

function bindRange(id) {
  const input = $(id);
  const out = $(`${id}-v`);
  const fmt = (v) => (id === 'fontSize' ? `${v}px` : `${Math.round(v * 100)}%`);
  input.value = state.settings.appearance[id];
  out.textContent = fmt(input.value);
  input.addEventListener('input', () => {
    out.textContent = fmt(input.value);
    save({ appearance: { [id]: Number(input.value) } });
  });
}

// ---------------------------------------------------------------------------
// Speed test + diagnostics

function fmtS(s) {
  return s >= 90 ? `${Math.round(s / 60)} min` : `${s.toFixed(1)} s`;
}

async function runSpeedTest() {
  const btn = $('speed-run');
  const box = $('speed-result');
  btn.disabled = true;
  btn.textContent = 'Testing… (up to a few minutes on slow PCs)';
  box.hidden = false;
  box.className = 'speed';
  $('speed-numbers').textContent = '';
  $('speed-advice').textContent = 'Answering a sample question with your current model…';
  $('speed-actions').innerHTML = '';
  const r = await speck.invoke('speed:test');
  btn.disabled = false;
  btn.textContent = 'Run speed test again';
  if (!r.ok) {
    $('speed-advice').textContent = r.error;
    return;
  }
  box.className = `speed ${r.advice.level}`;
  $('speed-numbers').textContent =
    `${r.model}: Careful ${fmtS(r.carefulS)} · Fast ${fmtS(r.fastS)} · reading the screen ${fmtS(r.readS)} · ` +
    `writing ${r.genTps.toFixed(1)} words/s · sample answer ${r.correct ? 'correct' : `WRONG (${r.answer})`}`;
  $('speed-advice').textContent = r.advice.text;
  for (const a of r.advice.actions) {
    const b = el('button', { class: 'small' }, a.label);
    b.onclick = async () => {
      if (a.type === 'mode') {
        save({ mode: a.value });
        seg('mode', a.value, (v) => {
          save({ mode: v });
          $('mode-hint').textContent = MODE_HINTS[v];
        });
        $('mode-hint').textContent = MODE_HINTS[a.value];
        b.textContent = 'Done';
      } else if (a.type === 'model') {
        if (!installed.some((m) => m.name === a.value)) {
          b.textContent = 'Downloading…';
          b.disabled = true;
          await pull(a.value);
        }
        if (installed.some((m) => m.name === a.value)) {
          save({ readerModel: a.value });
          renderModels();
          b.textContent = 'Done. Run the test again';
        } else {
          b.textContent = 'Download failed';
        }
      }
    };
    $('speed-actions').append(b);
  }
}

async function init() {
  state = await speck.invoke('settings:get');
  const s = state.settings;
  const a = s.appearance;

  $('ollamaUrl').value = s.ollamaUrl;
  $('ollamaUrl').addEventListener('change', async () => {
    save({ ollamaUrl: $('ollamaUrl').value.trim() });
    setTimeout(refreshOllama, 400);
  });
  $('refresh').onclick = refreshOllama;
  $('readerModel').onchange = (e) => save({ readerModel: e.target.value, modelAuto: false }); // picked by hand
  $('solverModel').onchange = (e) => save({ solverModel: e.target.value });
  $('custom-pull').onclick = () => pull($('custom-model').value);

  seg('mode', s.mode, (v) => {
    save({ mode: v });
    $('mode-hint').textContent = MODE_HINTS[v];
  });
  $('mode-hint').textContent = MODE_HINTS[s.mode];

  $('theme').value = a.theme;
  $('theme').onchange = (e) => save({ appearance: { theme: e.target.value } });
  seg('position', a.position, (v) => save({ appearance: { position: v } }));
  ['fontSize', 'opacity', 'markerOpacity'].forEach(bindRange);
  $('autoHideSeconds').value = String(a.autoHideSeconds);
  $('autoHideSeconds').onchange = (e) => save({ appearance: { autoHideSeconds: Number(e.target.value) } });
  $('trimWindows').checked = a.trimWindows;
  $('trimWindows').onchange = (e) => save({ appearance: { trimWindows: e.target.checked } });
  if (IS_MAC) $('trim-row').hidden = true;
  $('showConfidence').checked = a.showConfidence;
  $('showConfidence').onchange = (e) => save({ appearance: { showConfidence: e.target.checked } });

  $('tray-label').textContent = IS_MAC ? 'Show menu bar icon' : 'Show tray icon';
  $('saveHistory').checked = s.saveHistory;
  $('saveHistory').onchange = (e) => save({ saveHistory: e.target.checked });
  $('showTray').checked = s.showTray;
  $('showTray').onchange = (e) => save({ showTray: e.target.checked });
  $('reset-area').onclick = () => speck.invoke('app:reset-area');
  $('speed-run').onclick = runSpeedTest;
  const showShare = (on, urls) => {
    $('share-info').hidden = !on;
    $('share-info').textContent = urls && urls.length
      ? `On your other computer, open Speck Settings and set AI server to: ${urls.join('  or  ')}`
      : 'Sharing is on, but this computer has no network address right now.';
  };
  speck.invoke('share:get').then((sh) => {
    $('shareAi').checked = sh.on;
    showShare(sh.on, sh.urls);
    if (sh.platform === 'linux') $('shareAi').parentElement.hidden = true;
  });
  $('shareAi').onchange = async (e) => {
    const on = e.target.checked;
    $('share-info').hidden = false;
    $('share-info').textContent = 'Restarting Ollama…';
    const r = await speck.invoke('share:set', on);
    if (!r.ok) $('share-info').textContent = r.error;
    else showShare(on, r.urls);
    setTimeout(refreshOllama, 3000);
  };
  $('diag-copy').onclick = async () => {
    await speck.invoke('diag:copy');
    $('diag-copy').textContent = 'Copied. Paste to Claude';
    setTimeout(() => ($('diag-copy').textContent = 'Copy diagnostics'), 2500);
  };
  $('quit').onclick = () => speck.invoke('app:quit');

  renderHotkeys();
  $('footer').textContent = `Speck ${state.version} · Right-click the dot for the menu.`;
  await refreshOllama();
}

init();
