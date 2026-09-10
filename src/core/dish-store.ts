/**
 * Shared persistence for the tiny ~/.pi/dish/*.json stores (shares, pages,
 * comments). The files are small, so every call re-reads from disk — this
 * keeps the modules stateless and, more importantly, correct when HOME
 * changes between calls (the tests point HOME at a temp dir; os.homedir()
 * honours it, so it must be resolved per call, never hoisted). Writes go
 * through a temp file + rename so a concurrent read never sees a
 * half-written JSON.
 */
import fs = require('fs');
import path = require('path');
import os = require('os');

function dishDir() {
  return path.join(os.homedir(), '.pi', 'dish');
}

function readStore(name: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(dishDir(), name), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function writeStore(name: string, data: unknown): void {
  fs.mkdirSync(dishDir(), { recursive: true });
  const file = path.join(dishDir(), name);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export = { dishDir, readStore, writeStore };
