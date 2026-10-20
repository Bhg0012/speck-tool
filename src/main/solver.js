'use strict';
// The accuracy pipeline. Every attempt solves the problem independently; answers are
// compared and a tie-breaker runs only when they disagree.
//
//   fast:    1 attempt
//   careful: 2 independent attempts (+ tie-break if they disagree)        <- default
//   max:     3 independent attempts (+ tie-break if there's no majority)
//
// Speed rules (measured against real Ollama, see docs/PERFORMANCE.md):
// - one num_ctx for every call, so Ollama never reloads the model mid-question
// - identical system prompt + screenshot first in every attempt, so the image is processed once
// - instruct (non-thinking) vision model by default; working is short and visible in JSON
const A = require('./answer');
const { applySteps } = require('./calc');
const P = require('./prompts');
const { DEFAULT_READER } = require('../shared/defaults');

const NUM_CTX = 3072; // image (<=1600 tokens) + prompt + answer fit; small = fits 4 GB graphics cards
const MAX_TOKENS = 1000; // bounded output for non-thinking models (room for a table and its calculation steps)
// Generous, so a slow (CPU-only) PC still gets its answer; the speed test explains how to speed it up.
const CALL_TIMEOUT_MS = 240000;
const THINKING_TIMEOUT_MS = 360000;

class SpeckError extends Error {}

function pickInstalled(names, wanted) {
  if (!wanted) return null;
  if (names.includes(wanted)) return wanted;
  if (!wanted.includes(':') && names.includes(`${wanted}:latest`)) return `${wanted}:latest`;
  return null;
}

async function resolveModels(ollama, settings) {
  const names = (await ollama.list()).map((m) => m.name);

  let reader = pickInstalled(names, settings.readerModel);
  if (reader && !(await ollama.isVision(reader))) reader = null;
  if (!reader) {
    for (const n of names) {
      if (await ollama.isVision(n)) {
        reader = n;
        break;
      }
    }
  }
  if (!reader) throw new SpeckError(`No vision model installed. Open Settings and download ${DEFAULT_READER}`);

  let solver;
  if (settings.solverModel === 'auto' || settings.solverModel === 'reader') solver = reader;
  else solver = pickInstalled(names, settings.solverModel) || reader;

  const [readerCaps, solverCaps] = await Promise.all([ollama.capabilities(reader), ollama.capabilities(solver)]);
  return { reader, solver, readerCaps, solverCaps, solverVision: solverCaps.includes('vision') };
}

// gpt-oss takes an effort level; other thinking models take true/false; others get nothing.
function thinkParam(model, caps, level) {
  if (!caps.includes('thinking')) return undefined;
  if (/gpt-oss/i.test(model)) return level === 'off' ? 'low' : level; // gpt-oss can't fully turn it off
  return level === 'medium' || level === 'high'; // fast mode skips thinking entirely
}

function tooSlow(e) {
  if (e && e.kind === 'timeout') {
    return new SpeckError('The model is too slow on this computer. Open Settings and run the Speed test');
  }
  return e;
}

/**
 * @param {object} o
 * @param {string} o.image  base64 PNG of the captured region
 * @param {object} o.settings
 * @param {import('./ollama').Ollama} o.ollama
 * @param {'fast'|'careful'|'max'} o.mode
 * @param {(s: string) => void} [o.onStatus]
 * @param {AbortSignal} [o.signal]
 * @param {number} [o.timeoutScale]  multiplies per-call timeouts (benchmarks on slow machines)
 */
async function solve({ image, settings, ollama, mode = 'careful', onStatus = () => {}, signal, timeoutScale = 1 }) {
  const m = await resolveModels(ollama, settings);
  const keepAlive = settings.keepAlive;
  const effort = mode === 'fast' ? 'low' : mode === 'max' ? 'high' : 'medium';
  const solverThinks = m.solverCaps.includes('thinking');
  const calls = []; // per-call timing, for diagnostics and the speed test

  // Text-only solver: a vision model transcribes the region first.
  let transcript = null;
  let legibility = 'good';
  if (!m.solverVision) {
    onStatus('reading');
    try {
      const r = await ollama.chat({
        model: m.reader,
        messages: [
          { role: 'system', content: P.READER },
          { role: 'user', content: 'Transcribe this screen region.', images: [image] },
        ],
        think: thinkParam(m.reader, m.readerCaps, 'off'),
        options: { temperature: 0, num_ctx: NUM_CTX, num_predict: MAX_TOKENS },
        keepAlive,
        signal,
        timeoutMs: CALL_TIMEOUT_MS * timeoutScale,
      });
      calls.push({ step: 'read', model: m.reader, ...r.stats });
      const reading = A.parseReader(r.content || r.thinking);
      transcript = reading.transcript;
      legibility = reading.legibility;
    } catch (e) {
      throw tooSlow(e);
    }
  }

  async function attempt(instruction, { temperature, seed, source }) {
    const user = m.solverVision
      ? { role: 'user', content: instruction, images: [image] }
      : { role: 'user', content: `${instruction.replace('in this screenshot', 'below')}\n\nSCREEN CONTENT:\n${transcript}` };
    let r;
    try {
      r = await ollama.chat({
        model: m.solver,
        messages: [{ role: 'system', content: P.SOLVER }, user],
        // Constrained JSON fights with hidden reasoning, so thinking models get prompt-only JSON.
        format: solverThinks ? undefined : P.SOLVE_SCHEMA,
        think: thinkParam(m.solver, m.solverCaps, effort),
        options: { temperature, seed, num_ctx: NUM_CTX, num_predict: solverThinks ? undefined : MAX_TOKENS },
        keepAlive,
        signal,
        timeoutMs: (solverThinks ? THINKING_TIMEOUT_MS : CALL_TIMEOUT_MS) * timeoutScale,
      });
    } catch (e) {
      throw tooSlow(e);
    }
    calls.push({ step: source, model: m.solver, ...r.stats });
    const obj = A.parseJsonLoose(r.content) || A.parseJsonLoose(r.thinking);
    // The model only sets up the calculations; Speck computes them exactly and fills in the numbers.
    // Multiple choice is then checked against the computed result.
    const c = applySteps(A.normalizeResult(obj, r.content));
    return { ...A.checkChoice(c, c.question), source };
  }

  onStatus('solving');
  const candidates = [await attempt(P.FIRST, { temperature: 0, seed: 1, source: 'first' })];

  if (mode !== 'fast') {
    onStatus('checking');
    candidates.push(await attempt(P.SECOND, { temperature: 0.4, seed: 7, source: 'second' }));
    if (mode === 'max') candidates.push(await attempt(P.SECOND, { temperature: 0.7, seed: 21, source: 'third' }));

    const groups = A.tally(candidates);
    const counted = candidates.filter((c) => c.answer).length;
    const majority = groups[0] && groups[0].members.length > counted / 2;
    const unanimous = groups.length === 1 && groups[0].members.length === counted;
    if (mode === 'max' ? !majority : !unanimous) {
      onStatus('tie-break');
      const seen = groups.map((g) => g.members[0].answer).slice(0, 3);
      candidates.push(await attempt(P.tiebreak(seen), { temperature: 0.2, seed: 13, source: 'tiebreak' }));
    }
  }

  const groups = A.tally(candidates);
  const total = candidates.filter((c) => c.answer).length;
  const models = { reader: m.reader, solver: m.solver };
  if (!groups[0]) return { answer: '?', note: "Couldn't find an answer", confidence: 1, agreement: `0/${total}`, mode, models, calls };

  const winners = groups[0].members;
  const best = winners[0];
  // Exact-calculation status of the winning answer: any broken step or option mismatch counts.
  const statuses = winners.map((c) => c.math).filter(Boolean);
  const checked = winners.find((c) => c.check) || best;
  const math = ['fail', 'nomatch', 'unverified', 'pass'].find((m) => statuses.includes(m)) || A.mathCheck(checked);
  const confidence = A.scoreConfidence({ groups, total, math, legibility });

  // Multiple choice: always show the letter, e.g. "C) 75".
  let answer = best.answer;
  if (best.choice && !/^\(?[A-Za-z0-9]{1,2}[).:\s]/.test(answer) && answer.toUpperCase() !== best.choice) {
    answer = `${best.choice}) ${answer}`;
  }

  // Tables and long answers are shown on hover, laid out like the task (never for multiple choice).
  // Models sometimes fill "full" with a one-liner like "x = 5", or with just their calculation
  // steps ("gross_profit: 33,512" ...) when one number was asked for: those still show directly.
  const long = (s) => !!s && (/\n/.test(s) || s.length > 90);
  const table = best.choice ? [] : best.table || [];
  const full = best.choice || table.length ? '' : [A.stepsEcho(best.full, best.calc) ? '' : best.full, best.answer].find(long) || '';

  return {
    answer,
    table,
    full,
    choice: best.choice || '',
    note: winners.map((c) => c.corrected).find(Boolean) || best.note || winners.map((c) => c.note).find(Boolean) || '',
    question: best.question || candidates.map((c) => c.question).find(Boolean) || '',
    confidence,
    agreement: `${winners.length}/${total}`,
    math,
    calc: best.calc || [],
    mode,
    models,
    calls,
  };
}

module.exports = { solve, resolveModels, thinkParam, SpeckError, NUM_CTX };
