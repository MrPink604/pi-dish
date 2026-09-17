import { app, BrowserWindow, dialog, shell } from 'electron';
import { Server } from 'node:http';
import path = require('node:path');
import type * as ServerApp from '../lib/server-app';

// Keep reference to prevent GC.
let mainWindow: BrowserWindow | null = null;

let readyUrl: string | null = null;

function createWindow(url: string): void {
  mainWindow = new BrowserWindow({
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showStartupFailure(error: unknown): void {
  dialog.showErrorBox('pi-dish could not start', error instanceof Error ? error.message : String(error));
}

app.whenReady().then(() => {
  // Require the actual root so other in-process consumers share its native server.
  const server: unknown = require(path.join(__dirname, '..', 'server.js'));
  if (!(server instanceof Server)) {
    throw new TypeError('server.js must export the listening HTTP server');
  }
  const { observeServerStartup } = require('../lib/server-app') as typeof ServerApp;
  observeServerStartup(server, {
    ready(url) {
      readyUrl = url;
      createWindow(url);
    },
    failed: showStartupFailure,
  });

  app.on('activate', () => {
    if (readyUrl !== null && BrowserWindow.getAllWindows().length === 0) {
      createWindow(readyUrl);
    }
  });
}).catch(error => {
  showStartupFailure(error);
  // Preserve the native unhandled-rejection policy for synchronous root failures.
  throw error;
});

app.on('window-all-closed', () => {
  // On macOS apps conventionally stay open until Cmd+Q.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
