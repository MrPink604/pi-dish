// Generated from src/core/dish-store.ts; edit that source and run npm run build:core.
"use strict";
/**
 * Persistence helpers for ~/.pi/dish. HOME is resolved per call so tests can
 * point it at a temp dir, and every write replaces the file via temp + rename
 * so a concurrent reader never sees a partial file.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const helper_values_1 = require("./helper-values");
function dishDir() {
    return path.join(os.homedir(), '.pi', 'dish');
}
function replaceFile(file, data, mode) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, data, mode === undefined ? undefined : { mode });
    fs.renameSync(tmp, file);
}
function syncDirectory(dir) {
    const fd = fs.openSync(dir, 'r');
    try {
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
}
/** replaceFile that survives a crash once it returns; the directory must exist. */
function replaceFileDurably(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        const fd = fs.openSync(tmp, 'wx', 0o600);
        try {
            fs.writeFileSync(fd, data);
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
        syncDirectory(path.dirname(file));
    }
    finally {
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
    }
}
function readStore(name) {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(dishDir(), name), 'utf8'));
        return (0, helper_values_1.record)(data) ? data : {};
    }
    catch {
        return {};
    }
}
function writeStore(name, data) {
    replaceFile(path.join(dishDir(), name), JSON.stringify(data, null, 2) + '\n');
}
function readDishSettings() {
    return readStore('settings.json');
}
function writeDishSettings(settings) {
    writeStore('settings.json', settings);
}
module.exports = { dishDir, replaceFile, replaceFileDurably, syncDirectory, readStore, writeStore, readDishSettings, writeDishSettings };
