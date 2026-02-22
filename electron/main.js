const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Keep reference to prevent GC
let mainWindow = null;
let server = null;

const PORT = process.env.PORT || 3333;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 600,
    minHeight: 400,
    title: 'π-dish',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  // Require the express app — it calls .listen() internally
  return require(path.join(__dirname, '..', 'server.js'));
}

app.whenReady().then(() => {
  server = startServer();

  // Small delay to let Express bind before loading the URL
  setTimeout(createWindow, 300);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS apps conventionally stay open until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
