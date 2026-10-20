'use strict';
// Pure helpers for parsing model output, comparing answers and scoring confidence.
// No Electron or network code here, so it is unit-tested directly (test/answer.test.js).
const { evaluate } = require('./mathcheck');
const { normalizeSteps } = require('./calc');

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

// A filled-in table as rows of cell texts, padded to the same width; [] if it isn't one.
function normalizeTable(t) {
  if (!Array.isArray(t)) return [];
  const rows = t
    .filter(Array.isArray)
    .slice(0, 40)
    .map((r) => r.slice(0, 12).map((c) => str(c).slice(0, 120)));
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (rows.length < 2 || !rows.some((r) => r.some(Boolean))) return [];
  return rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
}

// Multi-line answers keep their line breaks; spaces inside a line are tidied.
function normalizeFull(v) {
  return str(v)
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3000);
}

// Turns a parsed JSON object (or raw text if parsing failed) into a clean result.
function normalizeResult(obj, rawText = '') {
  if (!obj) {
    const firstLine = str(rawText).split('\n').map((l) => l.trim()).find(Boolean) || '';
    return { answer: firstLine.slice(0, 300), choice: '', check: '', confidence: 3, note: '', table: [], full: '', parsed: false };
  }
  return {
    answer: str(obj.answer),
    table: normalizeTable(obj.table),
    full: normalizeFull(obj.full),
    choice: normalizeChoice(obj.choice),
    check: str(obj.check),
    confidence: clampConf(obj.confidence),
    note: str(obj.note).slice(0, 140),
    question: str(obj.question).slice(0, 2000),
    calc: normalizeSteps(obj.calc),
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
function cleanNumbers(s) {
  return str(s)
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[−–]/g, '-');
}

function extractNumber(s) {
  const t = cleanNumbers(str(s).replace(LABEL_RE, ''));
  const matches = [...t.matchAll(NUMBER_RE)];
  if (matches.length !== 1) return null;
  const m = matches[0];
  const before = t[m.index - 1] || '';
  const after = t[m.index + m[0].length] || '';
  if (/[a-z^_]/i.test(before) || /[a-z(]/i.test(after)) return null; // 2x, x^2, 3(...)
  const n = parseNumberToken(m[0]);
  if (!n) return null;
  const percent = /^\s*%/.test(t.slice(m.index + m[0].length));
  return { ...n, percent };
}

function parseNumberToken(token) {
  const tok = token.replace(/\s+/g, '');
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
  return { value, decimals };
}

// Every number in a long answer, in order (tables are read row by row).
function allNumbers(s) {
  return [...cleanNumbers(s).matchAll(NUMBER_RE)].map((m) => parseNumberToken(m[0])).filter(Boolean);
}

// The long form of an answer, if it has one: a filled-in table or a multi-line answer.
function longForm(r) {
  if (r.table && r.table.length) return r.table.map((row) => row.join(' | ')).join('\n');
  return str(r.full);
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
  // Tables and multi-part answers: the same numbers in the same order, or the same text.
  const fa = longForm(a);
  const fb = longForm(b);
  if (fa && fb) {
    const xa = allNumbers(fa);
    const xb = allNumbers(fb);
    if (xa.length && xb.length) return xa.length === xb.length && xa.every((x, i) => numbersClose(x, xb[i]));
    if (normalizeText(fa) === normalizeText(fb)) return true;
    // written answers rarely match word for word: their short summaries are compared below
  }
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
  if (math === 'nomatch') c = Math.min(c, 5); // the exact result matches none of the options
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

// Answer options in a question's text: "A) 30 B) 36 C) 40" or "(a) ... (b) ...".
// Returns { A: '30', B: '36', ... } for the longest A, B, C... run, or {} if there isn't one.
function optionsFrom(text) {
  const t = str(text);
  const marks = [...t.matchAll(/(?:^|[\s([])\(?([A-Ha-h])[).:\]]\s+/g)].map((m) => ({
    letter: m[1].toUpperCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
  let best = [];
  let run = [];
  for (const m of marks) {
    if (m.letter === 'A') run = [m];
    else if (run.length && m.letter.charCodeAt(0) === run[run.length - 1].letter.charCodeAt(0) + 1) run.push(m);
    else continue;
    if (run.length > best.length) best = run.slice();
  }
  if (best.length < 2) return {};
  const out = {};
  best.forEach((m, i) => {
    out[m.letter] = t.slice(m.end, i + 1 < best.length ? best[i + 1].start : undefined).trim();
  });
  return out;
}

// Which options show this computed value (allowing the option's own rounding, and percents).
function optionsMatching(options, value) {
  const exact = { value, decimals: Infinity };
  return Object.keys(options).filter((label) => {
    const text = options[label];
    return allNumbers(text).some(
      (n) => numbersClose(exact, n) || (text.includes('%') && numbersClose({ value: value * 100, decimals: Infinity }, n)),
    );
  });
}

// Multiple choice: the option is picked by the exactly computed result, not the model's guess.
// - one option matches the result: that's the choice (corrected if the model picked another)
// - none matches: the setup or the reading is probably wrong ('nomatch' lowers confidence)
function checkChoice(c, question) {
  if (!c.choice || c.choice.includes(',') || c.finalValue === null || c.finalValue === undefined) return c;
  const options = optionsFrom(question);
  if (Object.keys(options).length < 2) return c;
  const hits = optionsMatching(options, c.finalValue);
  if (!hits.length) return { ...c, math: 'nomatch' };
  if (hits.length > 1 || hits[0] === c.choice) return c;
  const label = hits[0];
  return { ...c, choice: label, answer: `${label}) ${options[label]}`, corrected: `picked ${label}: it matches the exact calculation` };
}

// True when a multi-line answer only lists the calculation steps ("gross_profit: 33,512"), i.e.
// the model showed its working although a single result was asked for.
function stepsEcho(full, steps) {
  const lines = str(full).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || !steps || !steps.length) return false;
  const key = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const names = new Set(steps.map((s) => s.name));
  return lines.every((l) => {
    const m = /^([^:=]+)[:=]/.exec(l);
    return m && names.has(key(m[1]));
  });
}

// What gets copied: a table as tab-separated rows (pastes into a spreadsheet as a table),
// a multi-line answer as is, otherwise the short answer.
function answerText(r) {
  if (!r) return '';
  if (r.table && r.table.length) return r.table.map((row) => row.join('\t')).join('\n');
  return str(r.full) || str(r.answer);
}

module.exports = {
  parseJsonLoose,
  optionsFrom,
  optionsMatching,
  checkChoice,
  stepsEcho,
  numbersClose,
  normalizeTable,
  normalizeFull,
  answerText,
  allNumbers,
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
