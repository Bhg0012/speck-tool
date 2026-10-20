'use strict';
// Plain-text report for "Copy diagnostics", so problems can be solved remotely.

const GPU_VENDORS = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel', 0x106b: 'Apple', 0x5143: 'Qualcomm', 0x1414: 'Microsoft (software)' };

function gpuLines(gpuInfo) {
  const devices = (gpuInfo && gpuInfo.gpuDevice) || [];
  if (!devices.length) return ['  (unknown)'];
  return devices.map((d) => {
    const vendor = GPU_VENDORS[d.vendorId] || `vendor 0x${(d.vendorId || 0).toString(16)}`;
    const name = d.deviceString || d.driverVendor || '';
    const driver = d.driverVersion ? ` driver ${d.driverVersion}` : '';
    return `  ${vendor} ${name} (device 0x${(d.deviceId || 0).toString(16)})${d.active ? ' [active]' : ''}${driver}`.replace(/\s+/g, ' ');
  });
}

function callLine(c) {
  const tps = c.genS > 0 ? (c.genTokens / c.genS).toFixed(1) : '?';
  return `    ${c.step}: load ${c.loadS}s · read ${c.promptTokens} tok in ${c.promptS}s · write ${c.genTokens} tok in ${c.genS}s (${tps}/s)`;
}

function buildDiagnostics({ app, system, gpu, nvidia, errors = [], ollama, settings, asks }) {
  const out = [];
  out.push(`Speck ${app.version} (${app.commit || '?'}) · ${system.platform} ${system.release} ${system.arch}`);
  out.push(`CPU: ${system.cpu} × ${system.cores} · RAM ${system.ramGb} GB (${system.freeGb} GB free)`);
  out.push('GPU:', ...gpuLines(gpu));
  if (nvidia) out.push(`Best-fit check: ${nvidia.name}${nvidia.vramGb ? `, ${nvidia.vramGb} GB` : ''}`);
  if (ollama.ok) {
    out.push(`Ollama ${ollama.version} at ${settings.ollamaUrl}`);
    out.push(`  installed: ${ollama.models.map((m) => `${m.name} (${(m.size / 1e9).toFixed(1)} GB)`).join(', ') || 'none'}`);
    const loaded = ollama.running.map((m) => {
      const gpuPct = m.size ? Math.round(((m.size_vram || 0) / m.size) * 100) : 0;
      return `${m.name} ${(m.size / 1e9).toFixed(1)} GB, ${gpuPct}% in GPU memory, ctx ${m.context_length || '?'}`;
    });
    out.push(`  loaded: ${loaded.join('; ') || 'none'}`);
  } else {
    out.push(`Ollama: NOT reachable at ${settings.ollamaUrl} (${ollama.error})`);
  }
  out.push(`Settings: model ${settings.readerModel}, solver ${settings.solverModel}, mode ${settings.mode}`);
  out.push(`Recent asks (newest first):`);
  if (!asks.length) out.push('  none yet');
  for (const a of asks.slice(0, 5)) {
    const head = `  ${a.at} · ${a.mode} · total ${(a.totalMs / 1000).toFixed(1)}s (capture ${a.captureMs} ms)`;
    out.push(a.error ? `${head} · ERROR: ${a.error}` : `${head} · answer "${a.answer}" ${a.confidence}/10`);
    for (const c of a.calls || []) out.push(callLine(c));
    for (const t of a.attempts || []) {
      const unused = t.unused && t.unused.length ? ` · never used ${t.unused.join(', ')}` : '';
      out.push(`    attempt ${t.source}: "${t.answer}" · numbers ${t.math || 'n/a'}${unused}`);
    }
  }
  if (errors.length) out.push('Recent errors:', ...errors.map((e) => `  ${e}`));
  return out.join('\n');
}

module.exports = { buildDiagnostics, gpuLines };
