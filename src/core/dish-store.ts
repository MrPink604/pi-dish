/**
 * Shared persistence for the tiny ~/.pi/dish/*.json stores. Files are small,
 * so every call re-reads from disk: the modules stay stateless and a HOME that
 * changes between calls (tests point HOME at a temp dir) is honoured. Writes
 * go through a temp file + rename so a concurrent read never sees a
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
