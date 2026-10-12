const fs = require('node:fs');
const path = require('node:path');

class DiskCache {
  constructor(file, ttlMs) {
    this.file = file;
    this.ttlMs = ttlMs;
    this.values = this.load();
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  get(key) {
    const item = this.values[key];
    if (!item || Date.now() - item.savedAt > this.ttlMs) return null;
    return item.value;
  }

  set(key, value) {
    this.values[key] = { savedAt: Date.now(), value };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2), 'utf8');
  }
}

module.exports = { DiskCache };
