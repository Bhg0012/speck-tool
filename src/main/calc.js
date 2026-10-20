'use strict';
// Exact calculator for the model's calculation steps. The model never does arithmetic itself:
// it writes each step as an expression ("cogs = 1250 * 18.40", "gross = sales - cogs") and
// Speck computes them here, exactly. + - * / ^ (whole powers) % and round/floor/ceil/abs/min/max
// use exact fractions (BigInt), so money adds up to the cent with no 0.1 + 0.2 slips; sqrt, log,
// trig etc. fall back to ordinary floating point. No eval(): a fixed recursive-descent grammar.
//
//   expr    = term (('+' | '-') term)*
//   term    = unary (('*' | '/') unary)*
//   unary   = ('-' | '+') unary | power
//   power   = postfix ('^' unary)?
//   postfix = primary ('%' | '!')*
//   primary = number | name | func '(' expr (',' expr)* ')' | '(' expr ')'

const MAX_STEPS = 40;
const MAX_EXPR = 300;

// ---------------------------------------------------------------------------
// Numbers: exact fractions { n, d } (BigInt, d > 0, reduced) or floats { f }

const abs = (a) => (a < 0n ? -a : a);
function gcd(a, b) {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
function frac(n, d = 1n) {
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const flt = (f) => {
  if (!Number.isFinite(f)) throw new Error('not a finite number');
  return { f };
};
const isExact = (x) => x.f === undefined;
const toFloat = (x) => (isExact(x) ? Number(x.n) / Number(x.d) : x.f);
const isInt = (x) => (isExact(x) ? x.d === 1n : Number.isInteger(x.f));

function parseNumber(text) {
  const m = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m) throw new Error(`bad number ${text}`);
  const [, int, dec = '', exp = '0'] = m;
  let n = BigInt((int || '0') + dec);
  let d = 10n ** BigInt(dec.length);
  const e = Number(exp);
  if (Math.abs(e) > 300) throw new Error('number too large');
  if (e > 0) n *= 10n ** BigInt(e);
  else if (e < 0) d *= 10n ** BigInt(-e);
  return frac(n, d);
}

function add(a, b) {
  return isExact(a) && isExact(b) ? frac(a.n * b.d + b.n * a.d, a.d * b.d) : flt(toFloat(a) + toFloat(b));
}
function neg(a) {
  return isExact(a) ? { n: -a.n, d: a.d } : flt(-a.f);
}
function mul(a, b) {
  return isExact(a) && isExact(b) ? frac(a.n * b.n, a.d * b.d) : flt(toFloat(a) * toFloat(b));
}
function div(a, b) {
  if (isExact(b) ? b.n === 0n : b.f === 0) throw new Error('division by zero');
  return isExact(a) && isExact(b) ? frac(a.n * b.d, a.d * b.n) : flt(toFloat(a) / toFloat(b));
}
function pow(a, b) {
  if (isExact(a) && isExact(b) && b.d === 1n && abs(b.n) <= 400n) {
    const e = b.n < 0n ? -b.n : b.n;
    const r = frac(a.n ** e, a.d ** e);
    return b.n < 0n ? div({ n: 1n, d: 1n }, r) : r;
  }
  return flt(Math.pow(toFloat(a), toFloat(b)));
}
function cmp(a, b) {
  if (isExact(a) && isExact(b)) {
    const x = a.n * b.d - b.n * a.d;
    return x < 0n ? -1 : x > 0n ? 1 : 0;
  }
  return Math.sign(toFloat(a) - toFloat(b));
}

// Rounds to `places` decimals, halves away from zero (how money is rounded).
function roundTo(x, places = 0) {
  const p = Math.max(-12, Math.min(12, Math.trunc(places)));
  if (!isExact(x)) {
    const k = 10 ** p;
    return flt((Math.sign(x.f) * Math.round(Math.abs(x.f) * k)) / k);
  }
  const scale = p >= 0 ? { n: 10n ** BigInt(p), d: 1n } : { n: 1n, d: 10n ** BigInt(-p) };
  const s = mul(x, scale);
  const sign = s.n < 0n ? -1n : 1n;
  const q = (abs(s.n) * 2n + s.d) / (2n * s.d); // round half up on the magnitude
  return div(frac(sign * q), scale);
}
function floorOf(x) {
  if (!isExact(x)) return flt(Math.floor(x.f));
  const q = x.n / x.d; // truncates toward zero
  return frac(x.n < 0n && q * x.d !== x.n ? q - 1n : q);
}

const floatFn = (fn) => (...args) => flt(fn(...args.map(toFloat)));
const FUNCS = {
  round: (x, p) => roundTo(x, p === undefined ? 0 : toFloat(p)),
  floor: floorOf,
  ceil: (x) => neg(floorOf(neg(x))),
  abs: (x) => (cmp(x, { n: 0n, d: 1n }) < 0 ? neg(x) : x),
  min: (...xs) => xs.reduce((a, b) => (cmp(b, a) < 0 ? b : a)),
  max: (...xs) => xs.reduce((a, b) => (cmp(b, a) > 0 ? b : a)),
  sqrt: (x) => {
    // exact when it's a perfect square of a fraction (sqrt(2.25) = 1.5)
    if (isExact(x) && x.n >= 0n) {
      const r = (v) => {
        const s = BigInt(Math.round(Math.sqrt(Number(v))));
        for (const c of [s - 1n, s, s + 1n]) if (c >= 0n && c * c === v) return c;
        return null;
      };
      const [a, b] = [r(x.n), r(x.d)];
      if (a !== null && b !== null) return frac(a, b);
    }
    return flt(Math.sqrt(toFloat(x)));
  },
  cbrt: floatFn(Math.cbrt),
  exp: floatFn(Math.exp),
  ln: floatFn(Math.log),
  log: (x, b) => flt(b === undefined ? Math.log10(toFloat(x)) : Math.log(toFloat(x)) / Math.log(toFloat(b))),
  log10: floatFn(Math.log10),
  log2: floatFn(Math.log2),
  sin: floatFn(Math.sin),
  cos: floatFn(Math.cos),
  tan: floatFn(Math.tan),
  asin: floatFn(Math.asin),
  acos: floatFn(Math.acos),
  atan: floatFn(Math.atan),
};
const CONSTS = { pi: flt(Math.PI), e: flt(Math.E) };
// Only these own names count: never "constructor", "__proto__" or anything else built in.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function factorial(x) {
  if (!isInt(x) || toFloat(x) < 0 || toFloat(x) > 500) throw new Error('bad factorial');
  let r = 1n;
  for (let k = 2n; k <= BigInt(toFloat(x)); k++) r *= k;
  return frac(r);
}

// ---------------------------------------------------------------------------
// Parsing

function clean(src) {
  return String(src)
    .replace(/[×·∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/[$€£¥]/g, '') // currency signs: "$1,250.00"
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1'); // thousands separators
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      tokens.push({ t: 'num', v: parseNumber(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i));
    if (id) {
      tokens.push({ t: 'id', v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ('+-*/^()%!,'.includes(c)) {
      tokens.push({ t: c });
      i++;
      continue;
    }
    throw new Error(`unexpected "${c}"`);
  }
  return tokens;
}

function evaluateExact(source, vars = {}) {
  const tokens = tokenize(clean(source));
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => {
    if (!tokens[pos] || tokens[pos].t !== t) throw new Error(`expected ${t}`);
    return tokens[pos++];
  };
  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[pos++].t;
      const r = term();
      v = op === '+' ? add(v, r) : add(v, neg(r));
    }
    return v;
  }
  function term() {
    let v = unary();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = tokens[pos++].t;
      const r = unary();
      v = op === '*' ? mul(v, r) : div(v, r);
    }
    return v;
  }
  function unary() {
    if (peek() && peek().t === '-') {
      pos++;
      return neg(unary());
    }
    if (peek() && peek().t === '+') {
      pos++;
      return unary();
    }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek() && peek().t === '^') {
      pos++;
      return pow(base, unary());
    }
    return base;
  }
  function postfix() {
    let v = primary();
    while (peek() && (peek().t === '%' || peek().t === '!')) {
      v = tokens[pos++].t === '%' ? div(v, { n: 100n, d: 1n }) : factorial(v);
    }
    return v;
  }
  function primary() {
    const tok = peek();
    if (!tok) throw new Error('unexpected end');
    if (tok.t === 'num') {
      pos++;
      return tok.v;
    }
    if (tok.t === '(') {
      pos++;
      const v = expr();
      eat(')');
      return v;
    }
    if (tok.t === 'id') {
      pos++;
      if (peek() && peek().t === '(') {
        if (!own(FUNCS, tok.v)) throw new Error(`unknown function ${tok.v}`);
        const fn = FUNCS[tok.v];
        eat('(');
        const args = [expr()];
        while (peek() && peek().t === ',') {
          pos++;
          args.push(expr());
        }
        eat(')');
        return fn(...args);
      }
      if (own(vars, tok.v)) return vars[tok.v];
      if (own(CONSTS, tok.v)) return CONSTS[tok.v];
      throw new Error(`unknown name ${tok.v}`);
    }
    throw new Error(`unexpected ${tok.t}`);
  }
  const v = expr();
  if (pos !== tokens.length) throw new Error('trailing input');
  return v;
}

// ---------------------------------------------------------------------------
// Formatting

const withCommas = (int) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Exact decimal text: fixed `places` if given, else every digit of a terminating decimal
// (up to 10 places), otherwise rounded to 10 places. Thousands get commas.
function format(x, places) {
  let v = x;
  let fixed = places;
  if (fixed === undefined) {
    if (isExact(v)) {
      let d = v.d;
      for (const p of [2n, 5n]) while (d % p === 0n) d /= p;
      fixed = 10;
      if (d === 1n) {
        // terminating: find how many places it really needs
        for (let k = 0; k <= 10; k++) {
          if ((v.n * 10n ** BigInt(k)) % v.d === 0n) {
            fixed = k;
            break;
          }
        }
      }
    } else {
      fixed = 10;
    }
  }
  v = roundTo(v, fixed);
  let text;
  if (isExact(v)) {
    const neg = v.n < 0n;
    const scaled = (abs(v.n) * 10n ** BigInt(fixed)) / v.d;
    let s = scaled.toString().padStart(fixed + 1, '0');
    const int = s.slice(0, s.length - fixed);
    const dec = fixed ? s.slice(s.length - fixed) : '';
    s = withCommas(int) + (dec ? `.${dec}` : '');
    text = (neg && /[1-9]/.test(s) ? '-' : '') + s;
  } else {
    const [int, dec] = Math.abs(v.f).toFixed(fixed).split('.');
    const s = withCommas(int) + (dec ? `.${dec}` : '');
    text = (v.f < 0 && /[1-9]/.test(s) ? '-' : '') + s;
  }
  // Without fixed places, drop trailing zeros of a rounded value (0.3333333333, not ...30)
  if (places === undefined && text.includes('.')) text = text.replace(/\.?0+$/, '');
  return text;
}

// ---------------------------------------------------------------------------
// Steps and placeholders

const NAME_RE = /^[a-z_][a-z0-9_]*$/i;

// [{ name, expr }] from the model, tidied: valid names only, at most MAX_STEPS.
function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw.slice(0, MAX_STEPS)) {
    if (!s || typeof s !== 'object') continue;
    let name = String(s.name || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (/^\d/.test(name)) name = `v_${name}`;
    const expr = String(s.expr || '').trim().slice(0, MAX_EXPR);
    if (name && NAME_RE.test(name) && expr) out.push({ name, expr });
  }
  return out;
}

// Computes every step in order. Returns { values: {name: value}, errors: [text] }.
function runSteps(steps) {
  const values = Object.create(null);
  const errors = [];
  for (const { name, expr } of steps) {
    // "x = 3 * 4" written inside expr: use the right-hand side
    const src = /^[a-z_][a-z0-9_]*\s*=(?!=)/i.test(expr) ? expr.replace(/^[^=]*=/, '') : expr;
    try {
      values[name] = evaluateExact(src, values);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { values, errors };
}

const PLACEHOLDER_RE = /\{\{?\s*([a-z_][a-z0-9_]*)\s*(?::\s*(\d{1,2}))?\s*\}?\}/gi;

// Places a value needs to be shown exactly (up to 10).
function placesNeeded(x) {
  const text = format(x);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

// Replaces {name} / {name:2} with the computed value. Unknown names become "?".
// Without a rounding instruction in the question, cents are never dropped ({x:0} on 10500.68
// still shows 10,500.68): models like to round on their own.
function fill(text, values, used, missing, mayRound) {
  return String(text || '').replace(PLACEHOLDER_RE, (_m, name, places) => {
    const key = name.toLowerCase();
    if (!own(values, key)) {
      missing.push(key);
      return '?';
    }
    used.push(key);
    let p = places === undefined ? undefined : Number(places);
    if (p !== undefined && p < 2 && !mayRound && placesNeeded(values[key]) > p) p = Math.min(2, placesNeeded(values[key]));
    return format(values[key], p);
  });
}

// Numbers written out in a text: "$1,250.50", "-3", "0.25" -> [{ value, places, start, end }]
function literals(text) {
  return [...String(text || '').matchAll(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|-?\.\d+/g)].map((m) => ({
    value: Number(m[0].replace(/,/g, '')),
    places: m[0].includes('.') ? m[0].split('.')[1].length : 0,
    start: m.index,
    end: m.index + m[0].length,
  }));
}

// A typed number is accounted for if it's a computed value or a number from the question
// (compared at the typed number's own precision), or a small label like "1" or "a) 2".
function accountedFor(lit, known) {
  if (Number.isInteger(lit.value) && Math.abs(lit.value) <= 20) return true;
  const k = 10 ** Math.min(lit.places, 10);
  return known.some((v) => Math.abs(Math.round(v * k) / k - lit.value) < 1e-9 * Math.max(1, Math.abs(v)));
}

/**
 * Applies a candidate's calculation steps: fills its answer, full answer and table with the
 * exactly computed values.
 * Returns the filled fields plus
 *   math: 'pass' (numbers came from the calculator), 'fail' (a step or placeholder broke) or null
 *   finalValue: the number the answer shows (its first placeholder, else the last step)
 */
function applySteps(c) {
  const steps = c.calc || [];
  const hasPlaceholders = [c.answer, c.full, ...(c.table || []).flat()].some((t) => PLACEHOLDER_RE.test(String(t || '')));
  PLACEHOLDER_RE.lastIndex = 0;
  if (!steps.length && !hasPlaceholders) return { ...c, math: null, finalValue: null };
  const { values, errors } = runSteps(steps);
  const mayRound = /\bround|nearest|whole (dollar|number|percent|cent)|decimal place|significant/i.test(String(c.question || ''));
  const used = [];
  const missing = [];
  let answer = fill(c.answer, values, used, missing, mayRound);
  const answerUsed = used.slice();
  const full = fill(c.full, values, used, missing, mayRound);
  const table = (c.table || []).map((row) => row.map((cell) => fill(cell, values, used, missing, mayRound)));
  const finalName = answerUsed[0] || (steps.length ? steps[steps.length - 1].name : null);
  const final = finalName && values[finalName] ? values[finalName] : null;
  let math = errors.length || missing.length ? 'fail' : used.length || final ? 'pass' : null;

  // Numbers the model typed itself instead of {name} are head math: check every one.
  let corrected = '';
  if (steps.length && math === 'pass') {
    const known = [...Object.values(values).map(toFloat), ...literals(c.question).map((l) => l.value)];
    const typed = (t) => literals(String(t || '').replace(PLACEHOLDER_RE, ''));
    PLACEHOLDER_RE.lastIndex = 0;
    const stray = typed(c.answer).filter((l) => !accountedFor(l, known));
    if (!c.choice && !answerUsed.length && stray.length === 1 && literals(answer).length === 1 && final) {
      // The one number in the answer isn't any computed value: show the exact final result instead.
      const lit = literals(answer)[0];
      const shown = format(final, lit.places > 0 ? Math.max(2, lit.places) : undefined);
      answer = answer.slice(0, lit.start) + shown + answer.slice(lit.end);
      corrected = 'number replaced by the exact calculation';
    } else if (stray.length) {
      math = 'unverified';
    }
    const cells = [...(c.table || []).slice(1).flat(), c.full];
    if (math === 'pass' && cells.some((t) => typed(t).some((l) => !accountedFor(l, known)))) math = 'unverified';
  }
  return {
    ...c,
    answer,
    full,
    table,
    math,
    ...(corrected ? { corrected } : {}),
    finalValue: final ? toFloat(final) : null,
    calcErrors: [...errors, ...missing.map((m) => `${m}: not calculated`)],
  };
}

module.exports = { evaluateExact, format, normalizeSteps, runSteps, applySteps, toFloat, isExact, roundTo, parseNumber };
