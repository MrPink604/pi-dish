// Generated from src/core/dish-store.ts; edit that source and run npm run build:core.
"use strict";
/**
 * Shared persistence for the tiny ~/.pi/dish/*.json stores. Files are small,
 * so every call re-reads from disk: the modules stay stateless and a HOME that
 * changes between calls (tests point HOME at a temp dir) is honoured. Writes
 * go through a temp file + rename so a concurrent read never sees a
 * half-written JSON.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
function dishDir() {
    return path.join(os.homedir(), '.pi', 'dish');
}
function readStore(name) {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dishDir(), name), 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    }
    catch {
        return {};
    }
}
function writeStore(name, data) {
    fs.mkdirSync(dishDir(), { recursive: true });
    const file = path.join(dishDir(), name);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}
function readDishSettings() {
    return readStore('settings.json');
}
function writeDishSettings(settings) {
    writeStore('settings.json', settings);
}
module.exports = { dishDir, readStore, writeStore, readDishSettings, writeDishSettings };
