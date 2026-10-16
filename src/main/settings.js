'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULTS, merge } = require('../shared/defaults');

class Settings {
  constructor(file) {
    this.file = file;
    this.data = merge(DEFAULTS, this.read(), true);
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  get() {
    return this.data;
  }

  update(patch) {
    this.data = merge(this.data, patch, true);
    this.save();
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('Could not save settings:', e.message);
    }
  }
}

module.exports = { Settings };
