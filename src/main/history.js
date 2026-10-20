'use strict';
// The last few questions and answers, stored as plain text on this computer only
// (no screenshots). About 1 KB per entry, so 30 entries is roughly 30 KB.
const fs = require('fs');
const path = require('path');
const { answerText, normalizeTable } = require('./answer');

const LIMIT = 30;

class History {
  constructor(file, limit = LIMIT) {
    this.file = file;
    this.limit = limit;
    this.items = this.read();
  }

  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(data) ? data.filter((x) => x && typeof x.answer === 'string').slice(0, this.limit) : [];
    } catch {
      return [];
    }
  }

  // Newest first.
  list() {
    return this.items;
  }

  add({ question = '', answer, table = [], full = '', confidence, mode, agreement }) {
    const entry = {
      at: new Date().toISOString(),
      question: String(question).slice(0, 2000),
      answer: String(answer).slice(0, 2000),
      ...(table.length ? { table: normalizeTable(table) } : {}),
      ...(full ? { full: String(full).slice(0, 3000) } : {}),
      confidence,
      mode,
      agreement,
    };
    this.items = [entry, ...this.items].slice(0, this.limit); // anything past the limit is dropped
    this.save();
    return entry;
  }

  clear() {
    this.items = [];
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.items, null, 1));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('Could not save history:', e.message);
    }
  }
}

// What the Copy button puts on the clipboard.
function entryText(e) {
  const conf = e.confidence ? ` (${e.confidence}/10)` : '';
  const a = answerText(e);
  const answer = a.includes('\n') ? `\n${a}` : ` ${a}`; // a table or multi-line answer starts on its own line
  return e.question ? `Question: ${e.question}\nAnswer:${answer}${conf}` : `Answer:${answer}${conf}`;
}

module.exports = { History, entryText, LIMIT };
