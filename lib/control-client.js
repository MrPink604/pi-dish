// Control socket client for pi session-control protocol
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONTROL_DIR = path.join(os.homedir(), '.pi', 'session-control');

class ControlClient {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.socketPath = path.join(CONTROL_DIR, `${sessionId}.sock`);
    this.client = null;
    this.buffer = '';
    this.subscriptions = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnects = 3;
  }

  isActive() {
    return fs.existsSync(this.socketPath);
  }

  async send(type, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isActive()) {
        return reject(new Error('Session not active'));
      }

      const client = net.createConnection(this.socketPath);
      let buffer = '';
      let resolved = false;

      client.on('connect', () => {
        client.write(JSON.stringify({ type, ...data }) + '\n');
      });

      client.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim() || resolved) continue;
          try {
            const response = JSON.parse(line);
            if (response.type === 'response') {
              resolved = true;
              client.end();
              resolve(response);
              return;
            }
          } catch (e) {}
        }
      });

      client.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      client.setTimeout(10000, () => {
        if (!resolved) {
          resolved = true;
          client.destroy();
          reject(new Error('Timeout'));
        }
      });
    });
  }

  subscribe(event, onData, onError) {
    if (!this.isActive()) {
      onError?.(new Error('Session not active'));
      return null;
    }

    const client = net.createConnection(this.socketPath);
    let buffer = '';
    let subscriptionId = null;

    client.on('connect', () => {
      client.write(JSON.stringify({ type: 'subscribe', event }) + '\n');
    });

    client.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'response' && msg.command === 'subscribe' && msg.success) {
            subscriptionId = msg.data?.subscriptionId;
            this.subscriptions.set(subscriptionId, { event, client });
          } else if (msg.type === 'event' && msg.subscriptionId === subscriptionId) {
            onData(msg.data);
          }
        } catch (e) {
          console.error('Parse error:', e.message);
        }
      }
    });

    client.on('error', (err) => {
      onError?.(err);
    });

    client.on('close', () => {
      if (subscriptionId) {
        this.subscriptions.delete(subscriptionId);
      }
    });

    return {
      unsubscribe: () => {
        if (subscriptionId) {
          client.write(JSON.stringify({ type: 'unsubscribe', subscriptionId }) + '\n');
          this.subscriptions.delete(subscriptionId);
        }
        client.end();
      }
    };
  }

  close() {
    for (const [id, { client }] of this.subscriptions) {
      client.end();
    }
    this.subscriptions.clear();
  }
}

module.exports = { ControlClient, CONTROL_DIR };
