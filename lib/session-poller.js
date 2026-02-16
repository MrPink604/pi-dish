// Polls session file for real-time updates during active generation
const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSIONS_DIR = path.join(os.homedir(), '.pi', 'agent', 'sessions');

class SessionPoller {
  constructor(sessionId, onUpdate) {
    this.sessionId = sessionId;
    this.onUpdate = onUpdate;
    this.lastSize = 0;
    this.filePath = null;
    this.interval = null;
    this.partialLine = '';
    this.seenEntries = new Set(); // Track seen entry IDs to avoid duplicates
  }

  findSessionFile() {
    try {
      const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const files = fs
          .readdirSync(path.join(SESSIONS_DIR, dir.name))
          .filter((f) => f.includes(this.sessionId) && f.endsWith('.jsonl'));
        if (files.length) {
          return path.join(SESSIONS_DIR, dir.name, files[0]);
        }
      }
    } catch (e) {}
    return null;
  }

  start() {
    this.filePath = this.findSessionFile();
    if (!this.filePath) {
      console.error('Session file not found for', this.sessionId);
      return false;
    }

    try {
      const stats = fs.statSync(this.filePath);
      this.lastSize = stats.size;
    } catch (e) {
      this.lastSize = 0;
    }

    // Poll every 300ms for updates (faster for real-time feel)
    this.interval = setInterval(() => this.checkForUpdates(), 300);
    return true;
  }

  checkForUpdates() {
    try {
      const stats = fs.statSync(this.filePath);

      // Handle truncation/rotation gracefully
      if (stats.size < this.lastSize) {
        this.lastSize = 0;
        this.partialLine = '';
        this.seenEntries.clear();
      }

      if (stats.size === this.lastSize) return;

      const bytesToRead = stats.size - this.lastSize;
      const buffer = Buffer.alloc(bytesToRead);

      const fd = fs.openSync(this.filePath, 'r');
      try {
        fs.readSync(fd, buffer, 0, bytesToRead, this.lastSize);
      } finally {
        fs.closeSync(fd);
      }

      this.lastSize = stats.size;

      // Parse new lines, preserving partial trailing line
      const chunk = this.partialLine + buffer.toString('utf-8');
      const lines = chunk.split('\n');
      this.partialLine = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const entry = JSON.parse(trimmed);

          // Create a unique ID for this entry to avoid duplicates
          const entryId =
            entry.id || `${entry.type}-${entry.timestamp}-${JSON.stringify(entry).slice(0, 50)}`;

          if (!this.seenEntries.has(entryId)) {
            this.seenEntries.add(entryId);
            this.onUpdate(entry);
          }
        } catch (e) {
          // Ignore parse errors for partial/invalid lines
        }
      }
    } catch (e) {
      // File might be temporarily unavailable
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

module.exports = { SessionPoller };
