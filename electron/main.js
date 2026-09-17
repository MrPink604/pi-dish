// Generated edge from electron/main.ts; edit that source and run npm run build:edges.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_http_1 = require("node:http");
const path = require("node:path");
// Keep reference to prevent GC.
let mainWindow = null;
let readyUrl = null;
function createWindow(url) {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 600,
        minHeight: 400,
        title: 'π-dish',
        backgroundColor: '#002b36', // --bg-dark in public/style.css — avoids an off-theme flash before the page paints
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    mainWindow.loadURL(url);
    // Open external links in the system browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function showStartupFailure(error) {
    electron_1.dialog.showErrorBox('pi-dish could not start', error instanceof Error ? error.message : String(error));
}
electron_1.app.whenReady().then(() => {
    // Require the actual root so other in-process consumers share its native server.
    const server = require(path.join(__dirname, '..', 'server.js'));
    if (!(server instanceof node_http_1.Server)) {
        throw new TypeError('server.js must export the listening HTTP server');
    }
    const { observeServerStartup } = require('../lib/server-app');
    observeServerStartup(server, {
        ready(url) {
            readyUrl = url;
            createWindow(url);
        },
        failed: showStartupFailure,
    });
    electron_1.app.on('activate', () => {
        if (readyUrl !== null && electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow(readyUrl);
        }
    });
}).catch(error => {
    showStartupFailure(error);
    // Preserve the native unhandled-rejection policy for synchronous root failures.
    throw error;
});
electron_1.app.on('window-all-closed', () => {
    // On macOS apps conventionally stay open until Cmd+Q.
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
