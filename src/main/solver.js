'use strict';
// The accuracy pipeline: read -> solve -> verify (-> tie-break) -> confidence.
const A = require('./answer');
const P = require('./prompts');
const { DEFAULT_READER } = require('../shared/defaults');

class SpeckError extends Error {}

const STATUS = { reading: 'reading', solving: 'solving', second: 'double-checking', verifying: 'verifying', tiebreak: 're-checking' };

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
      if (await ollama.isVision(n)) { reader = n; break; }
    }
  }
  if (!reader) throw new SpeckError(`No vision model installed. Open Settings and download ${DEFAULT_READER}`);

  let solver;
  if (settings.solverModel === 'auto') {
    solver = names.find((n) => /^gpt-oss:20b/.test(n)) || names.find((n) => /^gpt-oss/.test(n)) || reader;
  } else if (settings.solverModel === 'reader') {
    solver = reader;
  } else {
    solver = pickInstalled(names, settings.solverModel) || reader;
  }

  const [readerCaps, solverCaps] = await Promise.all([ollama.capabilities(reader), ollama.capabilities(solver)]);
  return { reader, solver, readerCaps, solverCaps, solverVision: solverCaps.includes('vision') };
}

// gpt-oss takes an effort level; other thinking models take true/false; others get nothing.
function thinkParam(model, caps, level) {
  if (!caps.includes('thinking')) return undefined;
  if (/gpt-oss/i.test(model)) return level === 'off' ? 'low' : level;
  return level !== 'off';
}

function resultFrom(r) {
  const obj = A.parseJsonLoose(r.content) || A.parseJsonLoose(r.thinking);
  return A.normalizeResult(obj, r.content);
}

/**
 * @param {object} o
 * @param {string} o.image  base64 PNG of the captured region
 * @param {object} o.settings
 * @param {import('./ollama').Ollama} o.ollama
 * @param {'fast'|'careful'|'max'} o.mode
 * @param {(s: string) => void} [o.onStatus]
 * @param {AbortSignal} [o.signal]
 */
async function solve({ image, settings, ollama, mode = 'careful', onStatus = () => {}, signal }) {
  const m = await resolveModels(ollama, settings);
  const keepAlive = settings.keepAlive;
  const effort = mode === 'fast' ? 'low' : mode === 'max' ? 'high' : 'medium';

  // 1. READ: the vision model transcribes the region exactly.
  let reading = null;
  if (mode !== 'fast' || !m.solverVision) {
    onStatus(STATUS.reading);
    const r = await ollama.chat({
      model: m.reader,
      messages: [
        { role: 'system', content: P.READER },
        { role: 'user', content: 'Transcribe this screen region.', images: [image] },
      ],
      think: thinkParam(m.reader, m.readerCaps, 'off'),
      options: { temperature: 0, num_ctx: 12288 },
      keepAlive,
      signal,
    });
    reading = A.parseReader(r.content || r.thinking);
  }

  // Constrained JSON decoding fights with hidden reasoning, so thinking models get prompt-only JSON.
  const solverThinks = m.solverCaps.includes('thinking');
  const problemText = reading ? `SCREEN CONTENT:\n${reading.transcript}` : 'The problem is in the attached screenshot.';
  const images = m.solverVision ? [image] : undefined;

  async function solveOnce({ temperature, seed, independent = false, level = effort }) {
    const content = `${problemText}\n\n${independent ? P.INDEPENDENT + '\n\n' : ''}Give the final answer.`;
    const r = await ollama.chat({
      model: m.solver,
      messages: [
        { role: 'system', content: P.SOLVER },
        { role: 'user', content, images },
      ],
      format: solverThinks ? undefined : P.SOLVE_SCHEMA,
      think: thinkParam(m.solver, m.solverCaps, level),
      options: { temperature, seed, num_ctx: 16384 },
      keepAlive,
      signal,
    });
    return resultFrom(r);
  }

  async function verifyOnce(candidate) {
    const content = `${problemText}\n\nCANDIDATE ANSWER: ${candidate.answer}\n\nCheck it.`;
    const r = await ollama.chat({
      model: m.solver,
      messages: [
        { role: 'system', content: P.VERIFIER },
        { role: 'user', content, images },
      ],
      format: solverThinks ? undefined : P.VERIFY_SCHEMA,
      think: thinkParam(m.solver, m.solverCaps, effort),
      options: { temperature: 0.2, seed: 42, num_ctx: 16384 },
      keepAlive,
      signal,
    });
    const obj = A.parseJsonLoose(r.content) || A.parseJsonLoose(r.thinking);
    if (!obj) return null;
    const v = A.normalizeResult(obj, r.content);
    // A "correct" verdict is a vote for the candidate, whatever formatting the checker used.
    if (obj.correct === true) return { ...candidate, confidence: v.confidence, source: 'verify' };
    return { ...v, source: 'verify' };
  }

  // 2. SOLVE
  onStatus(STATUS.solving);
  const primary = { ...(await solveOnce({ temperature: 0, seed: 1 })), source: 'solve' };
  const candidates = [primary];

  if (mode === 'max') {
    onStatus(STATUS.second);
    candidates.push({ ...(await solveOnce({ temperature: 0.6, seed: 7, independent: true })), source: 'independent' });
  }

  // 3. VERIFY, then 4. TIE-BREAK on any disagreement.
  if (mode !== 'fast') {
    onStatus(STATUS.verifying);
    const v = await verifyOnce(primary);
    if (v) candidates.push(v);
    const groups = A.tally(candidates);
    const counted = candidates.filter((c) => c.answer).length;
    if (groups.length > 1 || !groups[0] || groups[0].members.length < counted) {
      onStatus(STATUS.tiebreak);
      candidates.push({ ...(await solveOnce({ temperature: 0.3, seed: 13, independent: true, level: 'high' })), source: 'tiebreak' });
    }
  }

  const groups = A.tally(candidates);
  const total = candidates.filter((c) => c.answer).length;
  if (!groups[0]) {
    return { answer: '?', note: "Couldn't find an answer", confidence: 1, mode, models: m, transcript: reading && reading.transcript };
  }
  const winners = groups[0].members;
  // Prefer the member that carries the richest output (note/check) for display.
  const best = winners.find((c) => c.source === 'solve') || winners.find((c) => c.check || c.note) || winners[0];
  const checked = winners.find((c) => c.check) || best;
  const math = A.mathCheck(checked);
  const confidence = A.scoreConfidence({ groups, total, math, legibility: reading ? reading.legibility : 'good' });

  return {
    answer: best.answer,
    choice: best.choice || '',
    note: best.note || winners.map((c) => c.note).find(Boolean) || '',
    confidence,
    agreement: `${winners.length}/${total}`,
    math,
    mode,
    models: { reader: m.reader, solver: m.solver },
    transcript: reading ? reading.transcript : '',
  };
}

module.exports = { solve, resolveModels, thinkParam, SpeckError };
