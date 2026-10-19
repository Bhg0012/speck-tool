'use strict';
// Turns a speed-test measurement into plain advice + one-click fixes.

const SMALLER = {
  'qwen3-vl:8b': 'qwen3-vl:8b-instruct',
  'qwen3-vl:8b-instruct': 'qwen3-vl:4b-instruct',
  'qwen3-vl:4b-instruct': 'qwen3-vl:2b-instruct',
  'gemma3:12b': 'qwen3-vl:4b-instruct',
};

const secs = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

/**
 * @param {{ model: string, mode: string, fastS: number, carefulS: number, genTps: number, correct: boolean }} m
 */
function recommend(m) {
  const now = m.mode === 'fast' ? m.fastS : m.carefulS;
  const smaller = SMALLER[m.model];
  const actions = [];
  let level;
  let text;
  if (now <= 15) {
    level = 'great';
    text = `Fast: about ${secs(now)} per answer. This PC runs the AI as well as a Mac.`;
  } else if (now <= 35) {
    level = 'ok';
    text = `About ${secs(now)} per answer (${secs(m.fastS)} in Fast mode).`;
    if (m.mode !== 'fast') actions.push({ type: 'mode', value: 'fast', label: `Use Fast mode (~${secs(m.fastS)})` });
    if (smaller) actions.push({ type: 'model', value: smaller, label: `Use ${smaller} (faster)` });
  } else {
    level = 'slow';
    text =
      `Slow: about ${secs(now)} per answer, writing ${m.genTps.toFixed(1)} words/s. ` +
      'This computer is most likely running the AI on its processor (no supported graphics card). ' +
      'For Mac-like speed, use your Mac as the AI server: on the Mac, Settings > "Let my other computers use this computer\'s AI", then enter the address it shows here under AI server.' +
      (smaller ? ' Or pick a smaller model.' : '');
    if (smaller) actions.push({ type: 'model', value: smaller, label: `Use ${smaller} (faster)` });
    if (m.mode !== 'fast') actions.push({ type: 'mode', value: 'fast', label: `Use Fast mode (~${secs(m.fastS)})` });
  }
  if (!m.correct) text += ' (The test answer was wrong: prefer a bigger model if you can.)';
  return { level, text, actions };
}

module.exports = { recommend, SMALLER, secs };
