/** Helpers shared by the relays that serve pi-dish's bridge protocol from their own pane (agy, bots). */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import { dishDir } from './dish-store';
import { record as isRecord } from './helper-values';

const MAX_SOCKET_PATH_BYTES = 103;

/** The bridge socket for a session: short and hashed, as a Unix socket path must be. */
export function relaySocketPath(sessionId: string): string {
  const dir = process.env.PI_DISH_SOCKET_DIR || path.join(dishDir(), 'sockets');
  const file = path.join(dir, `${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}.sock`);
  const bytes = Buffer.byteLength(file);
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    throw new Error(`Unix socket path is ${bytes} bytes (maximum ${MAX_SOCKET_PATH_BYTES}): ${file}`);
  }
  return file;
}

/** pi-dish's own version, which a relay reports as its wrapper version. */
export function relayWrapperVersion(): string {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const version = isRecord(raw) ? raw.version : undefined;
    return typeof version === 'string' && version ? version : '0';
  } catch { return '0'; }
}
