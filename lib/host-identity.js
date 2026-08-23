/**
 * Stable identity for this host, for multi-host fleets (TASKS/multi-host.md).
 *
 * The id is a uuid generated once into ~/.pi/dish/host-id; clients pin a
 * catalog entry to it and fail a (re)connect that lands on a different host.
 * HOME is resolved per call (lib/dish-store.js rules) so a test's temp HOME
 * gets its own identity rather than the real machine's, and the write goes
 * through a temp file + rename so a concurrent reader never sees a partial id.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dishDir } = require('./dish-store');

const memo = new Map(); // resolved host-id path -> uuid

function hostIdFile() {
  return path.join(dishDir(), 'host-id');
}

function readHostIdFile(file) {
  try {
    const id = fs.readFileSync(file, 'utf8').trim();
    return id || null;
  } catch {
    return null;
  }
}

function getHostId() {
  const file = hostIdFile();
  const cached = memo.get(file);
  if (cached) return cached;

  let id = readHostIdFile(file);
  if (!id) {
    id = crypto.randomUUID();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, id + '\n');
      fs.renameSync(tmp, file);
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
function getHostLabel(settings) {
  if (settings === undefined) {
    try { settings = JSON.parse(fs.readFileSync(path.join(dishDir(), 'settings.json'), 'utf8')); } catch { settings = null; }
  }
  const label = settings && typeof settings === 'object' ? settings.hostLabel : null;
  if (typeof label === 'string' && label.trim()) return label.trim();
  return os.hostname();
}

module.exports = { getHostId, getHostLabel };
