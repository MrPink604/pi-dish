// Generated from src/core/host-identity.ts; edit that source and run npm run build:core.
"use strict";
const helper_values_1 = require("./helper-values");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const dish_store_1 = require("./dish-store");
const memo = new Map(); // resolved host-id path -> uuid
function hostIdFile() {
    return path.join((0, dish_store_1.dishDir)(), 'host-id');
}
function readHostIdFile(file) {
    try {
        const id = fs.readFileSync(file, 'utf8').trim();
        return id || null;
    }
    catch {
        return null;
    }
}
function getHostId() {
    const file = hostIdFile();
    const cached = memo.get(file);
    if (cached)
        return cached;
    let id = readHostIdFile(file);
    if (!id) {
        id = crypto.randomUUID();
        try {
            (0, dish_store_1.replaceFile)(file, id + '\n');
            // Two processes generating at once both rename; the loser must adopt
            // whichever id actually landed on disk, not the one it minted.
            id = readHostIdFile(file) || id;
        }
        catch {
            // Unwritable dish dir: stay usable for this process rather than 500.
        }
    }
    memo.set(file, id);
    return id;
}
// `hostLabel` in ~/.pi/dish/settings.json, else the machine's hostname.
function getHostLabel(settings = (0, dish_store_1.readDishSettings)()) {
    const label = (0, helper_values_1.record)(settings) ? settings.hostLabel : null;
    if (typeof label === 'string' && label.trim())
        return label.trim();
    return os.hostname();
}
module.exports = { getHostId, getHostLabel };
