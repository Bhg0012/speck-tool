'use strict';
// Tiny, safe arithmetic evaluator used to re-compute numeric answers.
// No eval(): a hand-written recursive-descent parser over a fixed grammar.
//
//   expr    = term (('+' | '-') term)*
//   term    = unary (('*' | '/') unary)*
//   unary   = ('-' | '+') unary | power
//   power   = postfix ('^' unary)?
//   postfix = primary ('%' | '!')*
//   primary = number | constant | func '(' expr (',' expr)* ')' | '(' expr ')'

const FUNCS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
};
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { tokens.push({ t: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-z][a-z0-9]*/i.exec(src.slice(i));
    if (id) { tokens.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    if ('+-*/^()%!,'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return tokens;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new Error('bad factorial');
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => {
    if (!tokens[pos] || tokens[pos].t !== t) throw new Error(`Expected ${t}`);
    return tokens[pos++];
  };

  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[pos++].t;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = tokens[pos++].t;
      const r = unary();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function unary() {
    if (peek() && peek().t === '-') { pos++; return -unary(); }
    if (peek() && peek().t === '+') { pos++; return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek() && peek().t === '^') { pos++; return Math.pow(base, unary()); }
    return base;
  }
  function postfix() {
    let v = primary();
    while (peek() && (peek().t === '%' || peek().t === '!')) {
      v = tokens[pos++].t === '%' ? v / 100 : factorial(v);
    }
    return v;
  }
  function primary() {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end');
    if (tok.t === 'num') { pos++; return tok.v; }
    if (tok.t === '(') { pos++; const v = expr(); eat(')'); return v; }
    if (tok.t === 'id') {
      pos++;
      const own = (o) => Object.prototype.hasOwnProperty.call(o, tok.v);
      if (own(CONSTS) && !(peek() && peek().t === '(')) return CONSTS[tok.v];
      const fn = own(FUNCS) ? FUNCS[tok.v] : null;
      if (!fn) throw new Error(`Unknown "${tok.v}"`);
      eat('(');
      const args = [expr()];
      while (peek() && peek().t === ',') { pos++; args.push(expr()); }
      eat(')');
      return fn(...args);
    }
    throw new Error(`Unexpected ${tok.t}`);
  }

  const v = expr();
  if (pos !== tokens.length) throw new Error('Trailing input');
  return v;
}

// Returns a finite number, or null if the expression is unsupported/invalid.
function evaluate(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 400) return null;
  let src = input
    .replace(/[×·∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/π/g, 'pi')
    .replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
  // Allow "x = <expr>" and "<expr> = <value>": evaluate the first side that isn't a bare variable.
  if (src.includes('=')) {
    src = src.split('=').map((s) => s.trim()).find((s) => s && !/^[a-z]\w*$/i.test(s)) || '';
  }
  try {
    const v = parse(tokenize(src));
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

module.exports = { evaluate };
