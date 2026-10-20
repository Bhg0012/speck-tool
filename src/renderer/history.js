'use strict';
/* global speck */
const $ = (id) => document.getElementById(id);

function when(iso) {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let toastTimer = null;
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('on'), 900);
}

async function render() {
  const { items, enabled } = await speck.invoke('history:list');
  const list = $('list');
  list.innerHTML = '';
  $('count').textContent = `${items.length}/30`;
  if (!items.length) {
    list.append(el('div', 'empty', enabled ? 'No questions yet. Your last 30 answers will show up here.' : 'History is turned off in Settings.'));
    return;
  }
  for (const it of items) {
    const item = el('div', 'item');
    const meta = el('div', 'meta');
    meta.append(el('span', '', when(it.at)), el('span', 'grow'));
    const copy = el('button', '', 'Copy');
    copy.title = 'Copy question and answer';
    copy.onclick = async () => {
      if (await speck.invoke('history:copy', it.at)) toast('Copied');
    };
    meta.append(copy);
    item.append(meta);
    if (it.question) item.append(el('div', 'q', it.question));
    const a = el('div', 'a', it.answer);
    if (it.confidence) a.append(el('span', 'conf', `${it.confidence}/10`));
    item.append(a);
    // A filled-in table is shown as a table; a long answer line by line, like the task.
    if (it.table && it.table.length) {
      const t = el('table', 'tbl');
      it.table.forEach((row, i) => {
        const tr = t.insertRow();
        for (const cell of row) tr.append(el(i === 0 ? 'th' : 'td', '', cell));
      });
      const wrap = el('div', 'full');
      wrap.append(t);
      item.append(wrap);
    } else if (it.full) {
      item.append(el('div', 'full', it.full));
    }
    list.append(item);
  }
}

$('close').onclick = () => speck.invoke('history:close');
$('clear').onclick = async () => {
  if (!confirm('Delete all saved questions and answers?')) return;
  await speck.invoke('history:clear');
  render();
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') speck.invoke('history:close');
});
speck.on('history:changed', render);
render();
