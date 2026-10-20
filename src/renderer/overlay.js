'use strict';
/* global speck */
const role = new URLSearchParams(location.search).get('role');
document.body.dataset.role = role;

const $ = (sel) => document.querySelector(sel);
let showConfidence = true;

speck.on('appearance', (a) => {
  const root = document.documentElement.style;
  root.setProperty('--marker-op', String(a.markerOpacity));
  root.setProperty('--op', String(a.opacity));
  root.setProperty('--fs', `${a.fontSize}px`);
  document.body.className = document.body.className.replace(/\btheme-\S+/g, '').trim();
  document.body.classList.add(`theme-${a.theme}`);
  document.body.dataset.pos = a.position;
  showConfidence = a.showConfidence;
});

// ---- dragging (markers and dot). The main process moves the window. ----
if (role === 'tl' || role === 'br' || role === 'dot') {
  let active = false;
  const end = () => {
    if (!active) return;
    active = false;
    document.body.classList.remove('dragging');
    speck.send('drag:end');
  };
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    active = true;
    document.body.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    speck.send('drag:start', role);
  });
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  document.addEventListener('lostpointercapture', end);
  window.addEventListener('blur', end);
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    speck.send('dot:menu');
  });
}

speck.on('pulse', () => {
  const c = $('.corner');
  c.classList.remove('pulse');
  void c.offsetWidth; // restart the animation
  c.classList.add('pulse');
});

speck.on('busy', (on) => $('.dot').classList.toggle('busy', !!on));

speck.on('frame', ({ visible, width, height }) => {
  const f = $('.frame');
  if (width && height) {
    f.style.setProperty('--fw', `${width}px`);
    f.style.setProperty('--fh', `${height}px`);
  }
  if (visible !== undefined) f.classList.toggle('show', visible);
});

// ---- answer bar ----
if (role === 'bar') {
  const pill = $('.pill');
  const text = $('.text');
  const conf = $('.conf');
  const detail = $('.detail');
  const full = $('.full');
  let current = null;
  const PROMPT = 'Hover to see the full answer';
  const isLong = (p) => p && p.kind === 'answer' && ((p.table && p.table.length) || p.full);

  // A filled-in table is drawn as a table, laid out like the one in the capture area.
  const fillFull = (p) => {
    full.textContent = '';
    if (p.table && p.table.length) {
      const t = document.createElement('table');
      p.table.forEach((row, i) => {
        const tr = t.insertRow();
        for (const cell of row) {
          const c = document.createElement(i === 0 ? 'th' : 'td');
          c.textContent = cell;
          tr.append(c);
        }
      });
      full.append(t);
    } else {
      full.textContent = p.full;
    }
  };

  // Tell the main process how big the answer is, so the window is clipped to just that
  // (Windows otherwise paints a faint box over the whole see-through bar).
  const reportShape = () =>
    requestAnimationFrame(() => {
      if (!pill.classList.contains('show')) return speck.send('bar:shape', null);
      const r = pill.getBoundingClientRect();
      const pad = 4;
      speck.send('bar:shape', { x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
    });

  pill.addEventListener('mouseenter', () => {
    speck.send('bar:hover', true);
    if (current && current.kind === 'answer') pill.classList.add('expanded');
    if (isLong(current)) text.textContent = current.answer; // its short summary, above the full answer
    reportShape();
  });
  pill.addEventListener('mouseleave', () => {
    speck.send('bar:hover', false);
    pill.classList.remove('expanded');
    if (isLong(current)) text.textContent = PROMPT;
    reportShape();
  });
  pill.addEventListener('click', () => {
    if (current && current.kind === 'answer' && !getSelection().toString()) speck.send('bar:copy');
  });
  pill.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    speck.send('bar:hover', false);
    speck.send('bar:dismiss');
  });

  speck.on('bar', (p) => {
    if (p.kind === 'copied') {
      const prev = conf.textContent;
      conf.textContent = 'copied';
      reportShape();
      setTimeout(() => {
        if (conf.textContent === 'copied') conf.textContent = prev;
      }, 900);
      return;
    }
    if (p.kind === 'clear') {
      current = null;
      pill.classList.remove('show', 'expanded');
      speck.send('bar:hover', false);
      setTimeout(reportShape, 220); // after the fade-out
      return;
    }
    current = p;
    pill.classList.remove('error', 'answer', 'note', 'long');
    pill.classList.add(p.kind, 'show');
    detail.textContent = '';
    conf.textContent = '';
    full.textContent = '';

    if (p.kind === 'error') {
      text.textContent = `! ${p.text}`;
    } else if (p.kind === 'note') {
      text.textContent = p.text;
    } else if (p.kind === 'answer') {
      // Tables and long answers stay tucked away until hovered: only a short prompt shows.
      const long = isLong(p);
      pill.classList.toggle('long', !!long);
      if (long) fillFull(p);
      text.textContent = long ? (pill.classList.contains('expanded') ? p.answer : PROMPT) : p.answer;
      if (showConfidence) conf.textContent = `${p.confidence}/10`;
      const bits = [];
      if (p.note) bits.push(p.note);
      bits.push(`${p.agreement} agree · ${p.mode}`);
      if (p.fallback) bits.push('your AI computer was unreachable, so this computer answered');
      if (p.slow) bits.push('slow on this computer: Settings > Speed test');
      bits.push('click to copy · right-click to dismiss');
      detail.textContent = bits.join('  ·  ');
    }
    reportShape();
  });
}
