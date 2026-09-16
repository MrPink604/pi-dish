import { app, BrowserWindow, shell } from 'electron';
import { Server } from 'node:http';
import path = require('node:path');

// Keep reference to prevent GC.
let mainWindow: BrowserWindow | null = null;

const PORT = process.env.PORT || 3333;

function createWindow(): void {
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

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Open external links in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer(): Server {
  // Root server.js remains unchecked until M7; validate its actual export
  // instead of declaring an ambient contract over the implementation.
  const server: unknown = require(path.join(__dirname, '..', 'server.js'));
  if (!(server instanceof Server)) {
    throw new TypeError('server.js must export the listening HTTP server');
  }
  return server;
}

app.whenReady().then(() => {
  startServer();

  // Small delay to let Express bind before loading the URL (R7 owns readiness).
  setTimeout(createWindow, 300);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS apps conventionally stay open until Cmd+Q.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
