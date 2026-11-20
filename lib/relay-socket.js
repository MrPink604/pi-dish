// Generated from src/core/relay-socket.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relaySocketPath = relaySocketPath;
exports.relayWrapperVersion = relayWrapperVersion;
/** Helpers shared by the relays that serve pi-dish's bridge protocol from their own pane (agy, bots). */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dish_store_1 = require("./dish-store");
const helper_values_1 = require("./helper-values");
const MAX_SOCKET_PATH_BYTES = 103;
/** The bridge socket for a session: short and hashed, as a Unix socket path must be. */
function relaySocketPath(sessionId) {
    const dir = process.env.PI_DISH_SOCKET_DIR || path.join((0, dish_store_1.dishDir)(), 'sockets');
    const file = path.join(dir, `${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}.sock`);
    const bytes = Buffer.byteLength(file);
    if (bytes > MAX_SOCKET_PATH_BYTES) {
        throw new Error(`Unix socket path is ${bytes} bytes (maximum ${MAX_SOCKET_PATH_BYTES}): ${file}`);
    }
    return file;
}
/** pi-dish's own version, which a relay reports as its wrapper version. */
function relayWrapperVersion() {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        const version = (0, helper_values_1.record)(raw) ? raw.version : undefined;
        return typeof version === 'string' && version ? version : '0';
    }
    catch {
        return '0';
    }
}
