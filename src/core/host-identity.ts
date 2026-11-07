/**
 * Stable per-host identity: a uuid generated once into ~/.pi/dish/host-id.
 * Clients pin a session to it and fail a (re)connect that lands elsewhere.
 * HOME is resolved per call so a test's temp HOME gets its own identity, and
 * the write goes through a temp file + rename so a concurrent reader never
 * sees a partial id.
 */
import type { HostId } from './contracts';
import { record as isRecord } from './helper-values';
import crypto = require('crypto');
import fs = require('fs');
import os = require('os');
import path = require('path');
import { dishDir, readDishSettings, replaceFile } from './dish-store';

const memo = new Map<string, HostId>(); // resolved host-id path -> uuid

function hostIdFile() {
  return path.join(dishDir(), 'host-id');
}

function readHostIdFile(file: string): HostId | null {
  try {
    const id = fs.readFileSync(file, 'utf8').trim();
    return (id as HostId) || null;
  } catch {
    return null;
  }
}

function getHostId(): HostId {
  const file = hostIdFile();
  const cached = memo.get(file);
  if (cached) return cached;

  let id = readHostIdFile(file);
  if (!id) {
    id = crypto.randomUUID() as HostId;
    try {
      replaceFile(file, id + '\n');
      // Two processes generating at once both rename; the loser must adopt
      // whichever id actually landed on disk, not the one it minted.
      id = readHostIdFile(file) || id;
    } catch {
      // Unwritable dish dir: stay usable for this process rather than 500.
    }
  }
  memo.set(file, id);
  return id;
}

// `hostLabel` in ~/.pi/dish/settings.json, else the machine's hostname.
function getHostLabel(settings: unknown = readDishSettings()): string {
  const label = isRecord(settings) ? settings.hostLabel : null;
  if (typeof label === 'string' && label.trim()) return label.trim();
  return os.hostname();
}

export = { getHostId, getHostLabel };
