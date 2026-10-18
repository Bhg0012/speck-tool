'use strict';
// Pure helpers for parsing model output, comparing answers and scoring confidence.
// No Electron or network code here, so it is unit-tested directly (test/answer.test.js).
const { evaluate } = require('./mathcheck');

// "B) ...", "(b) ...", "C. ...", "2) ..." - an option label at the start of an answer.
const LABEL_RE = /^\s*\(?([A-Ha-h]|[1-9])[).:]\s+/;
const NUMBER_RE = /-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/gi;

function parseJsonLoose(text) {
  if (!text) return null;
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' ? v : null;
  } catch {
    // fall through to scanning for the first balanced {...}
  }
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function clampConf(n, fallback = 5) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(10, Math.max(1, v)) : fallback;
}

function str(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(str).join(', ');
  return String(v).trim();
}

function normalizeChoice(c) {
  return str(c)
    .toUpperCase()
    .replace(/[^A-Z0-9,]/g, '')
    .split(',')
    .filter(Boolean)
    .sort()
    .join(',');
}

// Turns a parsed JSON object (or raw text if parsing failed) into a clean result.
function normalizeResult(obj, rawText = '') {
  if (!obj) {
    const firstLine = str(rawText).split('\n').map((l) => l.trim()).find(Boolean) || '';
    return { answer: firstLine.slice(0, 300), choice: '', check: '', confidence: 3, note: '', parsed: false };
  }
  return {
    answer: str(obj.answer),
    choice: normalizeChoice(obj.choice),
    check: str(obj.check),
    confidence: clampConf(obj.confidence),
    note: str(obj.note).slice(0, 140),
    question: str(obj.question).slice(0, 2000),
    parsed: true,
  };
}

function normalizeText(s) {
  return str(s)
    .toLowerCase()
    .replace(/^(final answer|the answer is|answer)\s*[:\-]?\s*/, '')
    .replace(/\\\(|\\\)|\\\[|\\\]|\$/g, '')
    .replace(LABEL_RE, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[\s.!。]+$/, '')
    .trim();
}

// Extracts the single number an answer stands for ("x = 4", "$1,200", "45%", "3/4").
// Returns { value, decimals, percent } or null when the answer isn't a single plain number.
function extractNumber(s) {
  const t = str(s)
    .replace(LABEL_RE, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[−–]/g, '-');
  const matches = [...t.matchAll(NUMBER_RE)];
  if (matches.length !== 1) return null;
  const m = matches[0];
  const before = t[m.index - 1] || '';
  const after = t[m.index + m[0].length] || '';
  if (/[a-z^_]/i.test(before) || /[a-z(]/i.test(after)) return null; // 2x, x^2, 3(...)
  const tok = m[0].replace(/\s+/g, '');
  let value;
  let decimals;
  if (tok.includes('/')) {
    const [a, b] = tok.split('/').map(Number);
    if (!b) return null;
    value = a / b;
    decimals = Infinity;
  } else {
    value = Number(tok);
    const dot = tok.split(/e/i)[0].split('.')[1];
    decimals = dot ? dot.length : 0;
  }
  if (!Number.isFinite(value)) return null;
  const percent = /^\s*%/.test(t.slice(m.index + m[0].length));
  return { value, decimals, percent };
}

function round(x, d) {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

function numbersClose(a, b) {
  const tol = 1e-9 * Math.max(1, Math.abs(a.value), Math.abs(b.value));
  if (Math.abs(a.value - b.value) <= tol) return true;
  // Same number written to different precision (3.14 vs 3.14159, 1/3 vs 0.333).
  const d = Math.min(a.decimals, b.decimals);
  if (a.decimals === b.decimals || !Number.isFinite(d)) return false;
  return round(a.value, d) === round(b.value, d);
}

function labelOf(r) {
  if (r.choice) return r.choice;
  const m = LABEL_RE.exec(str(r.answer));
  return m ? m[1].toUpperCase() : '';
}

function answersEquivalent(a, b) {
  if (!a || !b || !str(a.answer) || !str(b.answer)) return false;
  const la = labelOf(a);
  const lb = labelOf(b);
  if (la && lb) return la === lb;
  const na = extractNumber(a.answer);
  const nb = extractNumber(b.answer);
  if (na && nb) return numbersClose(na, nb);
  const ta = normalizeText(a.answer);
  const tb = normalizeText(b.answer);
  if (!ta || !tb) return false;
  if (ta === tb) return true;
  const bare = (s) => s.replace(/[^\p{L}\p{N}]+/gu, '');
  return bare(ta) !== '' && bare(ta) === bare(tb);
}

// Groups candidate answers that mean the same thing; biggest (then most confident) group first.
function tally(candidates) {
  const groups = [];
  for (const c of candidates) {
    if (!c || !str(c.answer)) continue;
    const g = groups.find((grp) => answersEquivalent(grp.members[0], c));
    if (g) g.members.push(c);
    else groups.push({ members: [c] });
  }
  const sum = (g) => g.members.reduce((s, m) => s + (m.confidence || 0), 0);
  groups.sort((x, y) => y.members.length - x.members.length || sum(y) - sum(x));
  return groups;
}

// Re-computes a numeric answer from the model's own "check" expression.
function mathCheck(result) {
  if (!result || !result.check) return null;
  const n = extractNumber(result.answer);
  const v = evaluate(result.check);
  if (!n || v === null) return null;
  const computed = { value: v, decimals: Infinity };
  if (numbersClose(n, computed)) return 'pass';
  if (n.percent && numbersClose(n, { value: v * 100, decimals: Infinity })) return 'pass';
  return 'fail';
}

// Confidence 1-10 from: model self-ratings, agreement between independent attempts,
// arithmetic re-check, and how legible the captured region was.
function scoreConfidence({ groups, total, math = null, legibility = 'good' }) {
  const win = groups && groups[0];
  if (!win || !total) return 1;
  const agree = win.members.length;
  const mean = win.members.reduce((s, m) => s + clampConf(m.confidence), 0) / agree;
  let c;
  if (total <= 1) {
    c = Math.min(mean, 8); // unverified single pass never claims near-certainty
    if (math === 'pass') c = Math.min(9, c + 1);
  } else if (agree === total) {
    c = Math.min(10, mean + 1);
  } else if (agree / total >= 2 / 3) {
    c = Math.min(mean, 6);
  } else {
    c = Math.min(mean, 3);
  }
  if (math === 'fail') c = Math.min(c, 4);
  if (legibility === 'partial') c = Math.min(c, 7);
  if (legibility === 'poor') c = Math.min(c, 4);
  return clampConf(Math.floor(c));
}

function parseReader(text) {
  const t = str(text);
  const task = /TASK:\s*(.+)/i.exec(t);
  const leg = /LEGIBILITY:\s*(good|partial|poor)/i.exec(t);
  return {
    transcript: t,
    task: task ? task[1].trim() : '',
    legibility: leg ? leg[1].toLowerCase() : 'good',
  };
}

module.exports = {
  parseJsonLoose,
  normalizeResult,
  normalizeText,
  extractNumber,
  answersEquivalent,
  tally,
  mathCheck,
  scoreConfidence,
  parseReader,
  clampConf,
};
