/**
 * Persistence helpers for ~/.pi/dish. HOME is resolved per call so tests can
 * point it at a temp dir, and every write replaces the file via temp + rename
 * so a concurrent reader never sees a partial file.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import os = require('os');
import { record } from './helper-values';

function dishDir(): string {
  return path.join(os.homedir(), '.pi', 'dish');
}

function replaceFile(file: string, data: string | NodeJS.ArrayBufferView, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, mode === undefined ? undefined : { mode });
  fs.renameSync(tmp, file);
}

function syncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** replaceFile that survives a crash once it returns; the directory must exist. */
function replaceFileDurably(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    syncDirectory(path.dirname(file));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function readStore(name: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(dishDir(), name), 'utf8'));
    return record(data) ? data : {};
  } catch {
    return {};
  }
}

function writeStore(name: string, data: unknown): void {
  replaceFile(path.join(dishDir(), name), JSON.stringify(data, null, 2) + '\n');
}

function readDishSettings(): Record<string, unknown> {
  return readStore('settings.json');
}

function writeDishSettings(settings: Record<string, unknown>): void {
  writeStore('settings.json', settings);
}

export = { dishDir, replaceFile, replaceFileDurably, syncDirectory, readStore, writeStore, readDishSettings, writeDishSettings };
