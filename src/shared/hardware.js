'use strict';
// Picks the best vision model for this computer's graphics hardware, so answers come back in
// seconds wherever possible. Used by the launcher (before downloading) while "auto" is on.
const { spawnSync } = require('child_process');
const os = require('os');

// "NVIDIA GeForce RTX 3050 Ti Laptop GPU, 4096" lines -> [{ name, vramGb }]
function parseNvidiaSmi(out) {
  return String(out || '')
    .split(/\r?\n/)
    .map((l) => l.split(',').map((s) => s.trim()))
    .filter((p) => p.length >= 2 && /^\d+(\.\d+)?$/.test(p[p.length - 1]))
    .map((p) => ({ name: p.slice(0, -1).join(', '), vramGb: Math.round((Number(p[p.length - 1]) / 1024) * 10) / 10 }));
}

function detectGpu(env = process.env) {
  if (env.SPECK_FAKE_GPU) {
    // testing hook: "nvidia:4", "apple:16", "none"
    const [kind, gb] = env.SPECK_FAKE_GPU.split(':');
    return { kind, name: `fake ${kind}`, vramGb: Number(gb) || 0 };
  }
  if (process.platform === 'darwin') {
    const ramGb = Math.round(os.totalmem() / 1e9);
    return process.arch === 'arm64' ? { kind: 'apple', name: 'Apple silicon', vramGb: ramGb } : { kind: 'none', name: 'Intel Mac', vramGb: 0 };
  }
  const r = spawnSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], {
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });
  const gpus = r.status === 0 ? parseNvidiaSmi(r.stdout) : [];
  if (gpus.length) {
    const best = gpus.reduce((a, b) => (b.vramGb > a.vramGb ? b : a));
    return { kind: 'nvidia', name: best.name, vramGb: best.vramGb };
  }
  return { kind: 'none', name: 'no supported graphics card found', vramGb: 0 };
}

// Biggest model that fits fully (or almost fully) in graphics memory.
function pickModel(gpu) {
  if (gpu.kind === 'apple') return gpu.vramGb >= 12 ? 'qwen3-vl:8b-instruct' : 'qwen3-vl:4b-instruct';
  if (gpu.kind === 'nvidia') {
    if (gpu.vramGb >= 7.5) return 'qwen3-vl:8b-instruct';
    if (gpu.vramGb >= 3.5) return 'qwen3-vl:4b-instruct';
    return 'qwen3-vl:2b-instruct';
  }
  return 'qwen3-vl:4b-instruct'; // processor only: best balance (share a Mac's AI for real speed)
}

module.exports = { detectGpu, pickModel, parseNvidiaSmi };
