// Generated edge from electron/main.ts; edit that source and run npm run build:edges.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_http_1 = require("node:http");
const path = require("node:path");
// Keep reference to prevent GC.
let mainWindow = null;
const PORT = process.env.PORT || 3333;
function createWindow() {
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
    mainWindow.loadURL(`http://localhost:${PORT}`);
    // Open external links in the system browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function startServer() {
    // Root server.js remains unchecked until M7; validate its actual export
    // instead of declaring an ambient contract over the implementation.
    const server = require(path.join(__dirname, '..', 'server.js'));
    if (!(server instanceof node_http_1.Server)) {
        throw new TypeError('server.js must export the listening HTTP server');
    }
    return server;
}
electron_1.app.whenReady().then(() => {
    startServer();
    // Small delay to let Express bind before loading the URL (R7 owns readiness).
    setTimeout(createWindow, 300);
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    // On macOS apps conventionally stay open until Cmd+Q.
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
