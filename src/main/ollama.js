'use strict';
// Minimal Ollama HTTP client (https://github.com/ollama/ollama/blob/main/docs/api.md).
// Uses the built-in fetch, so there are no npm dependencies.

// Used only when an old Ollama doesn't report model capabilities.
const VISION_NAME_HINT = /(qwen[\d.]*-?vl|llava|vision|gemma3|minicpm-v|moondream|llama4|mistral-small3\.[12]|granite.*vision)/i;

class OllamaError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.kind = kind; // 'offline' | 'timeout' | 'http'
    this.status = status;
  }
}

function abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

class Ollama {
  constructor(baseUrl) {
    this.caps = new Map();
    this.setBaseUrl(baseUrl);
  }

  setBaseUrl(url) {
    const next = String(url || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
    if (next !== this.base) this.caps.clear();
    this.base = next;
  }

  async request(path, { method = 'GET', body, signal, timeoutMs = 10000 } = {}) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    try {
      const res = await fetch(this.base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any(signals),
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text.slice(0, 200) };
      }
      if (!res.ok) throw new OllamaError(data.error || `Ollama error ${res.status}`, 'http', res.status);
      return data;
    } catch (e) {
      if (e instanceof OllamaError) throw e;
      if (signal && signal.aborted) throw abortError();
      if (e.name === 'TimeoutError') throw new OllamaError('Ollama took too long to respond', 'timeout');
      throw new OllamaError("Ollama isn't running", 'offline');
    }
  }

  async version() {
    return (await this.request('/api/version', { timeoutMs: 3000 })).version;
  }

  async list() {
    const data = await this.request('/api/tags', { timeoutMs: 5000 });
    return (data.models || []).map((m) => ({ name: m.name, size: m.size || 0 }));
  }

  // Models currently loaded in memory (size vs size_vram shows GPU use).
  async ps() {
    return (await this.request('/api/ps', { timeoutMs: 5000 })).models || [];
  }

  async capabilities(model) {
    if (this.caps.has(model)) return this.caps.get(model);
    const data = await this.request('/api/show', { method: 'POST', body: { model }, timeoutMs: 10000 });
    let caps = Array.isArray(data.capabilities) ? data.capabilities : null;
    if (!caps) {
      caps = ['completion'];
      const fams = (data.details && data.details.families) || [];
      if (data.projector_info || fams.includes('clip') || VISION_NAME_HINT.test(model)) caps.push('vision');
    }
    this.caps.set(model, caps);
    return caps;
  }

  async isVision(model) {
    try {
      return (await this.capabilities(model)).includes('vision');
    } catch {
      return false;
    }
  }

  // Non-streaming chat. Retries without `think` / `format` if the model rejects them.
  async chat({ model, messages, format, think, options, keepAlive, signal, timeoutMs = 300000 }) {
    const body = { model, messages, stream: false, options };
    if (keepAlive) body.keep_alive = keepAlive;
    if (format) body.format = format;
    if (think !== undefined) body.think = think;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await this.request('/api/chat', { method: 'POST', body, signal, timeoutMs });
        const msg = data.message || {};
        const sec = (ns) => Math.round((ns || 0) / 1e7) / 100;
        return {
          content: msg.content || '',
          thinking: msg.thinking || '',
          // timing from Ollama: loading the model, reading the prompt (incl. the image), writing the answer
          stats: {
            loadS: sec(data.load_duration),
            promptTokens: data.prompt_eval_count || 0,
            promptS: sec(data.prompt_eval_duration),
            genTokens: data.eval_count || 0,
            genS: sec(data.eval_duration),
          },
        };
      } catch (e) {
        if (!(e instanceof OllamaError) || e.status !== 400) throw e;
        if ('think' in body && /think/i.test(e.message)) delete body.think;
        else if ('format' in body && /format|schema|json/i.test(e.message)) delete body.format;
        else throw e;
      }
    }
    throw new OllamaError('Ollama rejected the request', 'http', 400);
  }

  // Loads a model into memory so the first real question is fast.
  // Use the same num_ctx as real calls, otherwise Ollama reloads the model on the first question.
  async warm(model, keepAlive, numCtx) {
    try {
      const body = { model, keep_alive: keepAlive || '2h' };
      if (numCtx) body.options = { num_ctx: numCtx };
      await this.request('/api/generate', { method: 'POST', body, timeoutMs: 180000 });
      return true;
    } catch {
      return false;
    }
  }

  // Streams a model download. onProgress gets { status, completed, total }.
  async pull(model, onProgress, signal) {
    let res;
    try {
      res = await fetch(this.base + '/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal,
      });
    } catch (e) {
      if (signal && signal.aborted) throw abortError();
      throw new OllamaError("Ollama isn't running", 'offline');
    }
    if (!res.ok) throw new OllamaError(`Download failed (${res.status})`, 'http', res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.error) throw new OllamaError(msg.error, 'http');
        if (onProgress) onProgress(msg);
      }
    }
    this.caps.delete(model);
  }
}

module.exports = { Ollama, OllamaError };
