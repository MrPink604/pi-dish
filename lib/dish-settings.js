// Generated from src/core/dish-settings.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDishSettings = readDishSettings;
exports.writeDishSettings = writeDishSettings;
const fs = require("fs");
const path = require("path");
const os = require("os");
function dishSettingsFile() {
    return path.join(os.homedir(), '.pi', 'dish', 'settings.json');
}
function readDishSettings() {
    try {
        const value = JSON.parse(fs.readFileSync(dishSettingsFile(), 'utf8'));
        return value && typeof value === 'object' ? value : {};
    }
    catch {
        return {};
    }
}
function writeDishSettings(settings) {
    const file = dishSettingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmp, file);
}
