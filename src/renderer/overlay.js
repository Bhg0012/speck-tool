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

speck.on('frame', ({ visible }) => $('.frame').classList.toggle('show', visible));

// ---- answer bar ----
if (role === 'bar') {
  const pill = $('.pill');
  const text = $('.text');
  const conf = $('.conf');
  const detail = $('.detail');
  let current = null;

  pill.addEventListener('mouseenter', () => {
    speck.send('bar:hover', true);
    if (current && current.kind === 'answer') pill.classList.add('expanded');
  });
  pill.addEventListener('mouseleave', () => {
    speck.send('bar:hover', false);
    pill.classList.remove('expanded');
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
      setTimeout(() => {
        if (conf.textContent === 'copied') conf.textContent = prev;
      }, 900);
      return;
    }
    if (p.kind === 'clear') {
      current = null;
      pill.classList.remove('show', 'expanded');
      speck.send('bar:hover', false);
      return;
    }
    current = p;
    pill.classList.remove('error', 'answer');
    pill.classList.add(p.kind, 'show');
    detail.textContent = '';
    conf.textContent = '';

    if (p.kind === 'error') {
      text.textContent = `! ${p.text}`;
    } else if (p.kind === 'answer') {
      text.textContent = p.answer;
      if (showConfidence) conf.textContent = `${p.confidence}/10`;
      const bits = [];
      if (p.note) bits.push(p.note);
      bits.push(`${p.agreement} agree · ${p.mode}`);
      bits.push('click to copy · right-click to dismiss');
      detail.textContent = bits.join('  ·  ');
    }
  });
}
